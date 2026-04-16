// api/sync.js — GET /api/sync
// Descarga contactos, conversaciones, usuarios y oportunidades de GHL.
// Cachea el resultado en Upstash Redis por 30 min.
// ?force=true  → omite caché y re-sincroniza
// ?debug=true  → incluye meta de paginación en la respuesta

import { cacheGet, cacheSet, cacheDel } from "./_lib.js";

export const config = { maxDuration: 60 };

const GHL_BASE    = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

const PRIORITY_PIPELINES = ["01 - Desarrollos", "02 - Cierre", "Rentas Vacacionales"];
const ALLOWED_STATUSES   = new Set(["open", "won", "abandoned"]); // excluye "lost"
const SKIP_PIPELINE_NAMES = ["seguimiento ia", "recepción", "recepcion"];

// ── Fetch helper con timeout de 15 s por llamada ──────────────────────────────
const headers = () => ({
  Authorization: `Bearer ${process.env.GHL_API_KEY}`,
  "Content-Type": "application/json",
  Version: GHL_VERSION,
});

async function ghlGet(path, params = {}) {
  const url = new URL(`${GHL_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const r = await fetch(url.toString(), {
    headers: headers(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(`GHL ${path} → ${r.status}: ${JSON.stringify(err)}`);
  }
  return r.json();
}

// ── Extraer cursor de la respuesta GHL ─────────────────────────────────────
// GHL requiere AMBOS startAfterId (string) y startAfter (timestamp ms) para paginar.
// Sin startAfter, el API devuelve la misma página infinitamente.
function extractCursor(data, batch) {
  const id = data.meta?.startAfterId;
  const ts = data.meta?.startAfter;          // número Unix ms
  if (id) return { startAfterId: id, startAfter: ts ?? null };

  // Fallback: parsear nextPageUrl si existe
  if (data.meta?.nextPageUrl) {
    try {
      const u   = new URL(data.meta.nextPageUrl);
      const sid = u.searchParams.get("startAfterId");
      const sts = u.searchParams.get("startAfter");
      if (sid) return { startAfterId: sid, startAfter: sts ? Number(sts) : null };
    } catch {}
  }

  // Último recurso: sin timestamp, no hay paginación confiable
  return null;
}

// Convierte cursor → params para ghlGet
function cursorParams(cursor) {
  if (!cursor) return {};
  return {
    startAfterId: cursor.startAfterId,
    ...(cursor.startAfter != null ? { startAfter: cursor.startAfter } : {}),
  };
}

// True si el cursor nuevo es igual al anterior (loop infinito)
function samecursor(a, b) {
  if (!a || !b) return false;
  return a.startAfterId === b.startAfterId && a.startAfter === b.startAfter;
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
    const map  = {};
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

// ── Contactos (paginado, máx 2 000) ──────────────────────────────────────────
async function fetchContacts(locationId) {
  const all    = [];
  const seen   = new Set();
  let cursor   = null;                        // { startAfterId, startAfter }
  const meta   = { pages: 0, totalReported: null };

  for (let page = 0; page < 20; page++) {
    try {
      const data  = await ghlGet("/contacts/", {
        locationId,
        limit: "100",
        ...cursorParams(cursor),
      });
      const raw   = data.contacts || [];
      if (page === 0) meta.totalReported = data.meta?.total ?? null;
      meta.pages++;

      const batch = raw.filter(c => {
        if (!c.id || seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
      all.push(...batch);
      console.log(`contacts page ${page + 1}: ${raw.length} raw, ${all.length} acumulados`);

      const next = extractCursor(data, raw);
      if (raw.length < 100 || !next || samecursor(cursor, next)) break;
      cursor = next;
    } catch (e) {
      console.warn("⚠️ fetchContacts page", page, e.message);
      break;
    }
  }
  return { contacts: all, meta };
}

// ── Oportunidades (paginado, máx 2 000) ──────────────────────────────────────
function oppScore(status, pipeline) {
  const s = status === "open" ? 0 : status === "abandoned" ? 1 : 2; // won=2
  const p = PRIORITY_PIPELINES.findIndex(
    n => n.toLowerCase() === pipeline.toLowerCase()
  );
  return s * 10 + (p === -1 ? 99 : p);
}

async function fetchOpportunityMap(locationId) {
  const map  = {};
  let cursor = null;

  for (let page = 0; page < 20; page++) {
    try {
      const data = await ghlGet("/opportunities/search", {
        location_id: locationId,
        limit: "100",
        ...cursorParams(cursor),
      });
      const opps = data.opportunities || [];
      console.log(`opps page ${page + 1}: ${opps.length}`);

      opps.forEach(opp => {
        const contactId = opp.contactId || opp.contact?.id;
        if (!contactId) return;

        const pipelineName = opp.pipeline?.name || opp.pipelineName || "";
        const stageName    = opp.pipelineStage?.name || opp.pipelineStageName || "(No hay datos)";
        const status       = (opp.status || "open").toLowerCase();

        const pl = pipelineName.toLowerCase();
        if (SKIP_PIPELINE_NAMES.some(s => pl.includes(s))) return;
        if (!ALLOWED_STATUSES.has(status)) return;
        const isMain = PRIORITY_PIPELINES.some(p => p.toLowerCase() === pl);
        if (!isMain) return;

        const current  = map[contactId];
        const newScore = oppScore(status, pipelineName);
        const curScore = current ? oppScore(current.status, current.pipeline) : 999;
        if (newScore < curScore) {
          map[contactId] = { pipeline: pipelineName, stage: stageName, status };
        }
      });

      const next = extractCursor(data, opps);
      if (opps.length < 100 || !next || samecursor(cursor, next)) break;
      cursor = next;
    } catch (e) {
      console.warn("⚠️ fetchOpportunityMap page", page, e.message);
      break;
    }
  }
  return map;
}

// ── Conversaciones (paginado, máx 2 000) ──────────────────────────────────────
async function fetchConversations(locationId) {
  const all  = [];
  let cursor = null;

  for (let page = 0; page < 20; page++) {
    try {
      const data  = await ghlGet("/conversations/search", {
        locationId,
        limit: "100",
        ...cursorParams(cursor),
      });
      const batch = data.conversations || [];
      all.push(...batch);
      console.log(`convs page ${page + 1}: ${batch.length}`);
      const next = extractCursor(data, batch);
      if (batch.length < 100 || !next || samecursor(cursor, next)) break;
      cursor = next;
    } catch (e) {
      console.warn("⚠️ fetchConversations page", page, e.message);
      break;
    }
  }
  return all;
}

// ── Tareas ────────────────────────────────────────────────────────────────────
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
    console.warn("⚠️ fetchTasksMap:", e.message);
  }
  return map;
}

// ── Stats por agente ──────────────────────────────────────────────────────────
function isCallConv(c) {
  const type    = String(c.type || "").toLowerCase();
  const channel = String(c.lastMessageChannel || c.lastMessageType || "").toLowerCase();
  return type === "type_phone" || type === "phone" || type === "6" ||
         channel === "call" || channel === "phone_call" ||
         channel.includes("call") || channel.includes("phone");
}

function buildStatsAgentes(rawConversations, rawContacts, userMap, tasksMap) {
  const stats = {};

  const ensure = name => {
    if (!stats[name]) stats[name] = {
      llamadasRealizadas: 0, llamadasContestadas: 0, llamadasPerdidas: 0,
      mensajesEnviados: 0,   mensajesNoLeidos:    0,
      tareasPendientes: 0,   contactosAsignados:  0,
    };
  };

  rawConversations.forEach(c => {
    const agentId   = c.assignedTo || c.assignedUserId;
    const agentName = agentId ? (userMap[agentId] || agentId) : "Sin asignar";
    ensure(agentName);

    if (isCallConv(c)) {
      stats[agentName].llamadasRealizadas++;
    } else {
      const dir = String(c.lastMessageDirection || "").toLowerCase();
      if (dir === "outbound") stats[agentName].mensajesEnviados++;
      stats[agentName].mensajesNoLeidos += Number(c.unreadCount) || 0;
    }
  });

  rawContacts.forEach(c => {
    const agentId   = c.assignedTo;
    const agentName = agentId ? (userMap[agentId] || agentId) : "Sin asignar";
    ensure(agentName);
    stats[agentName].contactosAsignados++;
  });

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

  const force     = req.query?.force === "true";
  const debugMode = req.query?.debug === "true";

  // ── Intentar caché ────────────────────────────────────────────────────────
  if (!force) {
    const cached = await cacheGet();
    if (cached) return res.json({ ...cached, fromCache: true });
  } else {
    await cacheDel();
  }

  try {
    console.log("🔄 Iniciando sync GHL...");
    const t0 = Date.now();

    // ── Fetch paralelo inicial ────────────────────────────────────────────
    const [{ contacts: rawContacts, meta: contactsMeta }, rawConversations, rawUsers, cfMap] =
      await Promise.all([
        fetchContacts(LOCATION_ID),
        fetchConversations(LOCATION_ID).catch(e => { console.warn("convs failed:", e.message); return []; }),
        fetchUsers(LOCATION_ID),
        fetchCustomFieldMap(LOCATION_ID).catch(() => ({})),
      ]);

    console.log(`✅ Contactos: ${rawContacts.length} (${contactsMeta.pages} páginas, total GHL reportado: ${contactsMeta.totalReported})`);
    console.log(`✅ Conversaciones: ${rawConversations.length}`);
    console.log(`✅ Usuarios: ${rawUsers.length}`);

    const userMap = buildUserMap(rawUsers);

    // ── Fetch secundario ──────────────────────────────────────────────────
    const [oppMap, tasksMap] = await Promise.all([
      fetchOpportunityMap(LOCATION_ID),
      fetchTasksMap(LOCATION_ID, userMap),
    ]);

    console.log(`✅ Oportunidades mapeadas: ${Object.keys(oppMap).length}`);
    console.log(`⏱️ Sync completado en ${Date.now() - t0}ms`);

    // ── Normalizar ────────────────────────────────────────────────────────
    const contacts     = rawContacts.map(c => normalizeContact(c, userMap, oppMap, cfMap));
    const usuarios     = rawUsers.map(u => normalizeUser(u));
    const statsAgentes = buildStatsAgentes(rawConversations, rawContacts, userMap, tasksMap);

    const payload = {
      ok:           true,
      synced:       true,
      updatedAt:    new Date().toISOString(),
      total:        contacts.length,
      totalAgentes: usuarios.length,
      contacts,
      usuarios,
      statsAgentes,
      ...(debugMode ? { _debug: { contactsMeta, oppsCount: Object.keys(oppMap).length } } : {}),
    };

    await cacheSet(payload);
    res.json({ ...payload, fromCache: false });
  } catch (err) {
    console.error("❌ sync error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
