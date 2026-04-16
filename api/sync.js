// api/sync.js — GET /api/sync
// Descarga contactos, conversaciones, usuarios, oportunidades y tareas de GHL.
// Cachea el resultado en Upstash Redis por 30 min.
// ?force=true omite el caché y re-sincroniza.

import { cacheGet, cacheSet, cacheDel } from "./_lib.js";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const PRIORITY_PIPELINES = ["01 - Desarrollos", "02 - Cierre", "Rentas Vacacionales"];

const headers = () => ({
  Authorization: `Bearer ${process.env.GHL_API_KEY}`,
  "Content-Type": "application/json",
  Version: GHL_VERSION,
});

// ── Fetch helper ──────────────────────────────────────────────────────────────
async function ghlGet(path, params = {}) {
  const url = new URL(`${GHL_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const r = await fetch(url.toString(), { headers: headers() });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(`GHL ${path} → ${r.status}: ${JSON.stringify(err)}`);
  }
  return r.json();
}

// ── Usuarios ──────────────────────────────────────────────────────────────────
async function fetchUsers(locationId) {
  try {
    const data = await ghlGet("/users/", { locationId });
    return data.users || [];
  } catch (e) {
    console.warn("⚠️ fetchUsers:", e.message);
    return [];
  }
}

function buildUserMap(rawUsers) {
  const map = {};
  rawUsers.forEach(u => {
    if (!u.id) return;
    map[u.id] = u.name ||
      `${u.firstName || ""}${u.lastName ? " " + u.lastName : ""}`.trim() ||
      "(Sin nombre)";
  });
  return map;
}

// ── Custom fields ─────────────────────────────────────────────────────────────
async function fetchCustomFieldMap(locationId) {
  try {
    const data = await ghlGet(`/locations/${locationId}/customFields`);
    const map = {};
    (data.customFields || []).forEach(f => {
      const name = f.name || "";
      if (!name) return;
      if (f.id)       map[f.id] = name;
      if (f.fieldKey) {
        map[f.fieldKey] = name;
        map[f.fieldKey.replace(/^contact\./, "")] = name;
      }
    });
    return map;
  } catch (e) {
    console.warn("⚠️ fetchCustomFieldMap:", e.message);
    return {};
  }
}

// ── Contactos (paginado, máx 2000) ───────────────────────────────────────────
async function fetchContacts(locationId) {
  const all  = [];
  const seen = new Set();
  let startAfterId = null;

  for (let page = 0; page < 20; page++) {
    try {
      const data  = await ghlGet("/contacts/", { locationId, limit: "100", startAfterId });
      const raw   = data.contacts || [];
      const batch = raw.filter(c => {
        if (!c.id || seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
      all.push(...batch);

      // GHL puede devolver startAfterId en meta, o usar el último ID del batch
      const nextId = data.meta?.startAfterId
        || (raw.length === 100 ? raw[raw.length - 1].id : null);

      if (raw.length < 100 || !nextId) break;
      startAfterId = nextId;
    } catch (e) {
      console.warn("⚠️ fetchContacts page", page, e.message);
      break;
    }
  }
  return all;
}

// ── Oportunidades ─────────────────────────────────────────────────────────────
// Statuses permitidos: open, won, abandoned  (lost = excluido)
const ALLOWED_STATUSES = new Set(["open", "won", "abandoned"]);
const SKIP_PIPELINE_NAMES = ["seguimiento ia", "recepción", "recepcion"];

// Puntuación para elegir la "mejor" oportunidad por contacto
// Menor = mejor prioridad
function oppScore(status, pipeline) {
  const statusScore   = status === "open" ? 0 : status === "abandoned" ? 1 : 2; // won=2
  const pipelineScore = PRIORITY_PIPELINES.findIndex(
    p => p.toLowerCase() === pipeline.toLowerCase()
  );
  return statusScore * 10 + (pipelineScore === -1 ? 99 : pipelineScore);
}

async function fetchOpportunityMap(locationId) {
  const map = {};
  let startAfterId = null;

  for (let page = 0; page < 20; page++) {
    try {
      const data = await ghlGet("/opportunities/search", {
        location_id: locationId,
        limit: "100",
        startAfterId,
      });
      const opps = data.opportunities || [];

      opps.forEach(opp => {
        const contactId    = opp.contactId || opp.contact?.id;
        if (!contactId) return;

        const pipelineName = opp.pipeline?.name || opp.pipelineName || "";
        const stageName    = opp.pipelineStage?.name || opp.pipelineStageName || "(No hay datos)";
        const status       = (opp.status || "open").toLowerCase();

        // Excluir pipelines de skip y status "lost"
        const pipelineLower = pipelineName.toLowerCase();
        if (SKIP_PIPELINE_NAMES.some(s => pipelineLower.includes(s))) return;
        if (!ALLOWED_STATUSES.has(status)) return; // descarta "lost"

        // Solo pipelines principales
        const isMain = PRIORITY_PIPELINES.some(
          p => p.toLowerCase() === pipelineLower
        );
        if (!isMain) return;

        const current = map[contactId];
        const newScore = oppScore(status, pipelineName);
        const curScore = current ? oppScore(current.status, current.pipeline) : 999;

        if (newScore < curScore) {
          map[contactId] = { pipeline: pipelineName, stage: stageName, status };
        }
      });

      // Fix paginación: GHL no siempre devuelve startAfterId en meta
      const nextId = data.meta?.startAfterId
        || (opps.length === 100 ? opps[opps.length - 1].id : null);
      if (opps.length < 100 || !nextId) break;
      startAfterId = nextId;
    } catch (e) {
      console.warn("⚠️ fetchOpportunityMap page", page, e.message);
      break;
    }
  }
  return map;
}

// ── Conversaciones (paginado, máx 2000) ──────────────────────────────────────
async function fetchConversations(locationId) {
  const all  = [];
  let startAfterId = null;

  for (let page = 0; page < 20; page++) {
    try {
      const data  = await ghlGet("/conversations/search", { locationId, limit: "100", startAfterId });
      const batch = data.conversations || [];
      all.push(...batch);
      if (batch.length < 100) break;
      startAfterId = batch[batch.length - 1].id;
    } catch { break; }
  }
  return all;
}

// ── Tareas pendientes (intenta endpoint de localización) ──────────────────────
async function fetchTasksMap(locationId, userMap) {
  const map = {};
  try {
    const data  = await ghlGet("/tasks/search", { locationId, status: "pending", limit: "100" });
    const tasks = data.tasks || data.items || [];
    tasks.forEach(t => {
      const agentId   = t.assignedTo || t.userId || t.assignedUserId;
      const agentName = agentId ? (userMap[agentId] || agentId) : "Sin asignar";
      map[agentName]  = (map[agentName] || 0) + 1;
    });
  } catch (e) {
    console.warn("⚠️ fetchTasksMap (no disponible en este plan):", e.message);
  }
  return map;
}

// ── Detecta si una conversación es llamada ────────────────────────────────────
function isCallConv(c) {
  const type    = String(c.type || "").toLowerCase();
  const channel = String(c.lastMessageChannel || c.lastMessageType || "").toLowerCase();
  return type === "type_phone" || type === "phone" || type === "6" ||
         channel === "call" || channel === "phone_call" ||
         channel.includes("call") || channel.includes("phone");
}

// ── Detalles de llamadas para obtener callStatus ──────────────────────────────
async function fetchCallDetails(callConvs) {
  // Máx 40 en paralelo para no superar timeouts
  const toFetch = callConvs.slice(0, 40);
  const results = await Promise.allSettled(
    toFetch.map(async c => {
      try {
        const data = await ghlGet(`/conversations/${c.id}/messages`, { limit: "10" });
        const msgs = Array.isArray(data.messages) ? data.messages
                   : Array.isArray(data.messages?.messages) ? data.messages.messages : [];
        const callMsg = msgs.find(m => m.meta?.callDuration !== undefined) ||
                        msgs.find(m => m.messageType === "TYPE_CALL" || m.type === 10);
        return { convId: c.id, callStatus: callMsg?.meta?.callStatus || null };
      } catch { return { convId: c.id, callStatus: null }; }
    })
  );
  const statusMap = {};
  results.forEach(r => {
    if (r.status === "fulfilled" && r.value) {
      statusMap[r.value.convId] = r.value.callStatus;
    }
  });
  return statusMap;
}

// ── Construir statsAgentes desde conversaciones + contactos + tareas ──────────
function buildStatsAgentes(rawConversations, rawContacts, userMap, callStatusMap, tasksMap) {
  const stats = {};

  const ensure = name => {
    if (!stats[name]) {
      stats[name] = {
        llamadasRealizadas:   0,
        llamadasContestadas:  0,
        llamadasPerdidas:     0,
        mensajesEnviados:     0,
        mensajesNoLeidos:     0,
        tareasPendientes:     0,
        contactosAsignados:   0,
      };
    }
  };

  // Conversaciones
  rawConversations.forEach(c => {
    const agentId   = c.assignedTo || c.assignedUserId;
    const agentName = agentId ? (userMap[agentId] || agentId) : "Sin asignar";
    ensure(agentName);

    if (isCallConv(c)) {
      stats[agentName].llamadasRealizadas++;
      const callStatus = callStatusMap[c.id];
      if (callStatus === "completed" || callStatus === "answered") {
        stats[agentName].llamadasContestadas++;
      } else if (callStatus === "missed" || callStatus === "no-answer" || callStatus === "busy") {
        stats[agentName].llamadasPerdidas++;
      }
    } else {
      const dir = String(c.lastMessageDirection || "").toLowerCase();
      if (dir === "outbound") stats[agentName].mensajesEnviados++;
      stats[agentName].mensajesNoLeidos += Number(c.unreadCount) || 0;
    }
  });

  // Contactos asignados por agente
  rawContacts.forEach(c => {
    const agentId   = c.assignedTo;
    const agentName = agentId ? (userMap[agentId] || agentId) : "Sin asignar";
    ensure(agentName);
    stats[agentName].contactosAsignados++;
  });

  // Tareas pendientes
  Object.entries(tasksMap).forEach(([agentName, count]) => {
    ensure(agentName);
    stats[agentName].tareasPendientes = count;
  });

  return stats;
}

// ── Normalizar contacto ───────────────────────────────────────────────────────
function normalizeContact(c, userMap, oppMap, cfMap) {
  const custom = {};
  (c.customField || []).forEach(f => {
    const val = f.value ?? "";
    if (f.id)       custom[f.id] = val;
    if (f.fieldKey) {
      custom[f.fieldKey] = val;
      const short = f.fieldKey.replace(/^contact\./, "");
      custom[short] = val;
    }
    const displayName =
      (f.id && cfMap[f.id]) ||
      (f.fieldKey && cfMap[f.fieldKey]) ||
      (f.fieldKey && cfMap[f.fieldKey.replace(/^contact\./, "")]) || "";
    if (displayName) custom[displayName] = val;
  });

  const opp           = oppMap[c.id] || {};
  const pipelineName  = opp.pipeline || "(No hay datos)";
  const pipelineStage = opp.stage    || "(No hay datos)";

  const get = (...keys) => {
    for (const k of keys) { const v = custom[k]; if (v && v !== "") return v; }
    return "(No hay datos)";
  };

  return {
    id:           c.id,
    firstName:    c.firstName   || "",
    lastName:     c.lastName    || "",
    phone:        c.phone       || "(No hay datos)",
    email:        c.email       || "(No hay datos)",
    source:       c.source      || "(No hay datos)",
    status:       c.status      || "(No hay datos)",
    dateAdded:    c.dateAdded   || "(No hay datos)",
    dateUpdated:  c.dateUpdated || "(No hay datos)",
    lastActivity: c.lastActivityDate || "(No hay datos)",
    assignedTo:   c.assignedTo ? (userMap[c.assignedTo] || c.assignedTo) : "(No hay datos)",
    tags:         Array.isArray(c.tags) ? c.tags.join(", ") || "(No hay datos)" : (c.tags || "(No hay datos)"),
    unreadCount:  c.unreadCount || 0,
    pipelineName,
    pipelineStage,
    // Encuesta — Primer Contacto
    nivelInteres:    get("_nivel_de_interes_del_prospecto",     "nivel_de_interes_del_prospecto",     "🌡️ Nivel de interés del prospecto"),
    presupuesto:     get("_presupuesto_estimado",               "presupuesto_estimado",               "💸 Presupuesto estimado"),
    financiamiento:  get("_cuenta_con_financiamiento_o_credito","cuenta_con_financiamiento_o_credito","🏦 ¿Cuenta con financiamiento o crédito?"),
    deseaCita:       get("_desea_agendar_una_cita",             "desea_agendar_una_cita",             "📅 ¿Desea agendar una cita?"),
    medioContacto:   get("medio_de_contacto_de_preferencia"),
    funciones:       get("funciones_de_lead"),
    notaPrimerContacto: get("comentario_de_nota_seguimiento_frio_", "comentario_de_nota_primer_contacto"),
    // Encuesta — Cierre Comercial
    sePresentoCita:  get("_el_prospecto_se_presento_a_la_cita",    "¿El prospecto se presentó a la cita?"),
    nivelInteresPost:get("_nivel_de_interes_despues_de_la_cita",   "📊 Nivel de interés después de la cita"),
    queFaltaCerrar:  get("_que_le_hace_falta_para_cerrar_la_operacion"),
    requiereCloser:  get("_requiere_intervencion_de_un_closer_u_otro_equipo"),
    fechaSeguimiento:get("_fecha_tentativa_de_seguimientocierre"),
    notaCierre:      get("comentario_nota_cita_por_confirmar"),
  };
}

// ── Normalizar usuario ────────────────────────────────────────────────────────
function normalizeUser(u) {
  return {
    id:        u.id,
    firstName: u.firstName || "",
    lastName:  u.lastName  || "",
    name:      u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim() || "(Sin nombre)",
    email:     u.email || "",
    role:      u.role  || "",
  };
}

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const API_KEY     = process.env.GHL_API_KEY;
  const LOCATION_ID = process.env.GHL_LOCATION_ID;

  if (!API_KEY || !LOCATION_ID) {
    return res.status(500).json({
      ok: false,
      error: "Faltan GHL_API_KEY y GHL_LOCATION_ID en las variables de entorno.",
    });
  }

  const force = req.query?.force === "true";

  // ── Intentar caché ────────────────────────────────────────────────────────
  if (!force) {
    const cached = await cacheGet();
    if (cached) {
      return res.json({ ...cached, fromCache: true });
    }
  } else {
    await cacheDel();
  }

  try {
    // ── Fetch paralelo inicial ────────────────────────────────────────────
    const [rawContacts, rawConversations, rawUsers, cfMap] = await Promise.all([
      fetchContacts(LOCATION_ID),
      fetchConversations(LOCATION_ID).catch(() => []),
      fetchUsers(LOCATION_ID),
      fetchCustomFieldMap(LOCATION_ID).catch(() => ({})),
    ]);

    const userMap = buildUserMap(rawUsers);

    // ── Fetch secundario (depende de userMap) ─────────────────────────────
    const callConvs = rawConversations.filter(c => isCallConv(c));

    const [oppMap, callStatusMap, tasksMap] = await Promise.all([
      fetchOpportunityMap(LOCATION_ID),
      fetchCallDetails(callConvs),
      fetchTasksMap(LOCATION_ID, userMap),
    ]);

    // ── Normalizar ────────────────────────────────────────────────────────
    const contacts     = rawContacts.map(c => normalizeContact(c, userMap, oppMap, cfMap));
    const usuarios     = rawUsers.map(u => normalizeUser(u));
    const statsAgentes = buildStatsAgentes(rawConversations, rawContacts, userMap, callStatusMap, tasksMap);

    const payload = {
      ok:            true,
      synced:        true,
      updatedAt:     new Date().toISOString(),
      total:         contacts.length,
      totalAgentes:  usuarios.length,
      contacts,
      usuarios,
      statsAgentes,
    };

    // ── Cachear ───────────────────────────────────────────────────────────
    await cacheSet(payload);

    res.json({ ...payload, fromCache: false });
  } catch (err) {
    console.error("sync error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
