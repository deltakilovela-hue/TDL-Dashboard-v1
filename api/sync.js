// Vercel Serverless Function: GET /api/sync
// Descarga contactos, conversaciones, usuarios y oportunidades de GHL.
// Las credenciales van como variables de entorno en Vercel → Settings → Environment Variables.

const GHL_HEADERS = () => ({
  Authorization: `Bearer ${process.env.GHL_API_KEY}`,
  "Content-Type": "application/json",
  Version: "2021-07-28",
});

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function ghlGet(path, params = {}) {
  const url = new URL(`https://services.leadconnectorhq.com${path}`);
  Object.entries(params).forEach(([k, v]) => v && url.searchParams.set(k, v));
  const r = await fetch(url.toString(), { headers: GHL_HEADERS() });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(`GHL ${path} → ${r.status}: ${JSON.stringify(err)}`);
  }
  return r.json();
}

// ── Fetch users → { userId: "Nombre Apellido" } ───────────────────────────────
async function fetchUserMap(locationId) {
  try {
    const data = await ghlGet("/users/", { locationId });
    const map = {};
    (data.users || []).forEach((u) => {
      if (u.id) map[u.id] = u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim();
    });
    return map;
  } catch (e) {
    console.warn("⚠️ fetchUserMap:", e.message);
    return {};
  }
}

// ── Fetch opportunities → { contactId: { pipeline, stage, status } } ──────────
async function fetchOpportunityMap(locationId) {
  const map = {};
  let startAfterId = null;
  const PRIORITY = ["01 - Desarrollos", "02 - Cierre", "Rentas Vacacionales"];

  for (let page = 0; page < 30; page++) {
    try {
      const data = await ghlGet("/opportunities/search", {
        location_id: locationId,
        limit: "100",
        startAfterId,
      });
      const opps = data.opportunities || [];

      opps.forEach((opp) => {
        const contactId = opp.contactId || opp.contact?.id;
        if (!contactId) return;
        const pipelineName = opp.pipeline?.name || opp.pipelineName || "";
        const stageName    = opp.pipelineStage?.name || opp.pipelineStageName || opp.name || "";
        const status       = opp.status || "open";

        // Descartar "Seguimiento IA" — no debe aparecer como oportunidad principal
        if (pipelineName === "Seguimiento IA") return;

        const current = map[contactId];
        const isMainPipeline = PRIORITY.includes(pipelineName);
        const currentIsMain  = current && PRIORITY.includes(current.pipeline);

        if (!current ||
            (isMainPipeline && !currentIsMain) ||
            (isMainPipeline && currentIsMain && status === "open" && current.status !== "open")) {
          map[contactId] = { pipeline: pipelineName, stage: stageName, status };
        }
      });

      const nextId = data.meta?.startAfterId;
      if (opps.length < 100 || !nextId) break;
      startAfterId = opps[opps.length - 1].id;
    } catch (e) {
      console.warn("⚠️ fetchOpportunityMap page", page, e.message);
      break;
    }
  }
  return map;
}

// ── Fetch custom field definitions → { id|fieldKey: displayName } ────────────
// Permite mapear campos personalizados de GHL por su nombre visible real
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

// ── Fetch contacts (paginado) ─────────────────────────────────────────────────
async function fetchContacts(locationId) {
  const all = [];
  let startAfterId = null;

  while (true) {
    const data = await ghlGet("/contacts/", { locationId, limit: "100", startAfterId });
    const batch = data.contacts || [];
    all.push(...batch);
    const nextId = data.meta?.startAfterId;
    if (batch.length < 100 || !nextId || all.length >= (data.meta?.total || Infinity)) break;
    startAfterId = batch[batch.length - 1].id;
  }
  return all;
}

// ── Fetch conversations (paginado, máx 1000) ──────────────────────────────────
async function fetchConversations(locationId) {
  const all = [];
  let startAfterId = null;

  for (let page = 0; page < 10; page++) {
    try {
      const data = await ghlGet("/conversations/search", { locationId, limit: "100", startAfterId });
      const batch = data.conversations || [];
      all.push(...batch);
      if (batch.length < 100) break;
      startAfterId = batch[batch.length - 1].id;
    } catch { break; }
  }
  return all;
}

// ── Normaliza contacto con nombres de columna del CSV de GHL ─────────────────
function normalizeContact(c, userMap, oppMap, cfMap = {}) {
  const custom = {};
  (c.customField || []).forEach((f) => {
    const val = f.value ?? "";
    // Guardar por ID y fieldKey (para backward compat)
    if (f.id)       custom[f.id] = val;
    if (f.fieldKey) {
      custom[f.fieldKey] = val;
      custom[f.fieldKey.replace(/^contact\./, "")] = val;
    }
    // Guardar por nombre visible usando cfMap (fuente de verdad de GHL)
    const displayName = (f.id && cfMap[f.id]) || (f.fieldKey && cfMap[f.fieldKey]) ||
                        (f.fieldKey && cfMap[f.fieldKey.replace(/^contact\./, "")]) || "";
    if (displayName) custom[displayName] = val;
  });

  const fullName = c.contactName || `${c.firstName || ""} ${c.lastName || ""}`.trim();
  // Resuelve ID de usuario → nombre real
  const ownerName = c.ownerName || userMap[c.assignedTo] || c.assignedTo || "";
  const created   = c.dateAdded || c.createdAt || "";
  const tags      = Array.isArray(c.tags) ? c.tags.join(", ") : (c.tags || "");

  // Pipeline/Stage: del mapa de oportunidades (más completo que el campo de contacto)
  const opp       = oppMap[c.id] || {};
  const pipeline  = opp.pipeline || c.pipelineName || "";
  const stage     = opp.stage    || c.pipelineStage || c.pipelineStageName || "";
  const oppStatus = opp.status   || "open";

  return {
    "Contact Id":    c.id || "",
    "First Name":    c.firstName || "",
    "Last Name":     c.lastName || "",
    "Phone":         c.phone || "",
    "Email":         c.email || "",
    "Business Name": c.companyName || "",
    "Created":       created,
    "Last Activity": c.lastActivityDate || "",
    "Tags":          tags,
    "Source":        c.source || "",
    "Contact Type":  c.type || "lead",
    "Assigned To":   ownerName,
    "Updated":       c.dateUpdated || "",
    "Opportunities": pipeline && stage ? `${oppStatus}: ${pipeline} - ${stage}` : "",
    "Días Asignado": created ? Math.floor((Date.now() - new Date(typeof created === "number" ? (created > 1e10 ? created : created * 1000) : created).getTime()) / 86400000) : "",
    "Last Note":     c.lastNote || "",
    // Custom fields con nombres del CSV
    "🌡️ Nivel de interés del prospecto":        custom["nivel_de_interes_del_prospecto"] || custom["nivel_interes"] || "",
    "💸 Presupuesto estimado":                  custom["presupuesto_estimado"] || custom["presupuesto"] || "",
    "🏦 ¿Cuenta con financiamiento o crédito?": custom["cuenta_con_financiamiento_o_credito"] || custom["financiamiento"] || "",
    "¿Dónde te gustaria invertir?":             custom["donde_te_gustaria_invertir"] || custom["donde_invertir"] || "",
    "¿En que te gustaria invertir?":            custom["en_que_te_gustaria_invertir"] || custom["en_que_invertir"] || "",
    "Comentario de NOTA primer contacto":       custom["comentario_de_nota_primer_contacto"] || "",
    "Historial de NOTAS para clientes":         custom["historial_de_notas_para_clientes"] || "",
    "Turno de asignación":                      custom["turno_de_asignacion"] || "",
    "Propiedad seleccionada":                   custom["propiedad_seleccionada"] || custom["propiedad"] || "",
    "Fecha de visita":                          custom["fecha_de_visita"] || "",
    // Columnas compatibles con el dashboard
    "Nombre del Contacto": fullName,
    "Número de teléfono":  c.phone || "",
    "Usuario asignado":    ownerName,
    "Created On":          created,
    "Pipeline":            pipeline,
    "Pipeline Name":       pipeline,
    "Stage":               stage,
    "{{contact.suma_de_notas_de_agente}}": custom["suma_de_notas_de_agente"] || "0",
    ...custom,
  };
}

// ── Detecta si una conversación es una llamada telefónica ─────────────────────
function isCallConversation(c) {
  const type    = String(c.type || "").toLowerCase();
  const channel = String(c.lastMessageChannel || c.lastMessageType || "").toLowerCase();
  // GHL usa TYPE_PHONE (6), "phone", "call", "TYPE_CALL", etc.
  return type === "type_phone" || type === "phone" || type === "6" ||
         channel === "call" || channel === "phone_call" || channel === "type_call" ||
         channel.includes("call") || channel.includes("phone");
}

// ── Obtiene detalles reales de una llamada desde sus mensajes ─────────────────
async function fetchCallMessages(convId) {
  try {
    const data = await ghlGet(`/conversations/${convId}/messages`, { limit: "20" });
    // GHL puede devolver { messages: [...] } o { messages: { messages: [...] } }
    const msgs = Array.isArray(data.messages) ? data.messages
               : Array.isArray(data.messages?.messages) ? data.messages.messages : [];
    const callMsg = msgs.find(m => m.meta?.callDuration !== undefined) ||
                    msgs.find(m => m.messageType === "TYPE_CALL" || m.type === 10);
    if (!callMsg) return null;
    return {
      duration: parseInt(callMsg.meta?.callDuration || 0),
      status:   callMsg.meta?.callStatus || callMsg.meta?.status || null,
    };
  } catch {
    return null;
  }
}

// ── Normaliza llamada (conversación de tipo llamada) ─────────────────────────
function normalizeLlamada(c, userMap, detail = null) {
  const agentName = userMap[c.assignedTo] || c.ownerName || c.assignedTo || "";
  // Intentar inferir estado: si hay mensajes sin leer de entrada → posiblemente perdida
  const direction = String(c.lastMessageDirection || "").toLowerCase();
  const unread    = c.unreadCount || 0;
  let status = "Answered";
  if (unread > 0 && direction === "inbound") status = "No Answer";
  else if (direction === "inbound") status = "Answered";
  // Si el lastMessageBody contiene "missed" o "no answer"
  const body = String(c.lastMessageBody || "").toLowerCase();
  if (body.includes("missed") || body.includes("no answer") || body.includes("no contestada")) {
    status = "No Answer";
  } else if (body.includes("answered") || body.includes("completed") || body.includes("contestada")) {
    status = "Answered";
  }

  // Duración: intentar extraer del body si contiene número de segundos
  let duration = "0";
  const durMatch = body.match(/(\d+)\s*(seg|sec|s\b|second)/i) ||
                   body.match(/duration[:\s]+(\d+)/i);
  if (durMatch) duration = durMatch[1];

  // Sobreescribir con datos reales de los mensajes de la conversación (si disponibles)
  if (detail) {
    if (detail.duration > 0) duration = String(detail.duration);
    if (detail.status) {
      const st = detail.status.toLowerCase();
      if (st === "completed" || st === "answered") status = "Answered";
      else if (st === "no-answer" || st === "busy" || st === "failed" || st === "canceled") status = "No Answer";
    }
  }

  return {
    "Nombre del Contacto":    c.contactName || c.fullName || "",
    "Llamar realizada Vía":   agentName,
    "Duración (in segundos)": duration,
    "Estado de la llamada":   status,
    "Creada Activado":        c.dateCreated || c.dateUpdated || "",
    "Contact Id":             c.contactId || "",
  };
}

// ── Normaliza conversación con nombres de usuario resueltos ──────────────────
function normalizeConversation(c, userMap) {
  const ownerName = userMap[c.assignedTo] || c.ownerName || c.assignedTo || "";
  return {
    "Nombre del Contacto":          c.contactName || c.fullName || "",
    "Mensajes no leídos":           String(c.unreadCount || 0),
    "Asignado a":                   ownerName,
    "Tipo":                         (c.unreadCount || 0) > 0 ? "Unread" : "Read",
    "Dirección del último mensaje": c.lastMessageDirection || "",
    "Canal del último Mensaje":     c.lastMessageChannel || c.lastMessageType || c.type || "",
    "Creada Activado":              c.dateCreated || c.dateUpdated || "",
    "Contact Id":                   c.contactId || "",
  };
}

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const API_KEY     = process.env.GHL_API_KEY;
  const LOCATION_ID = process.env.GHL_LOCATION_ID;

  if (!API_KEY || !LOCATION_ID) {
    return res.status(500).json({
      ok: false,
      error: "Faltan GHL_API_KEY y GHL_LOCATION_ID en las variables de entorno de Vercel.",
    });
  }

  try {
    // Descarga en paralelo: contactos, conversaciones, usuarios, oportunidades y campos personalizados
    const [rawContacts, rawConversations, userMap, oppMap, cfMap] = await Promise.all([
      fetchContacts(LOCATION_ID),
      fetchConversations(LOCATION_ID).catch(() => []),
      fetchUserMap(LOCATION_ID).catch(() => ({})),
      fetchOpportunityMap(LOCATION_ID).catch(() => ({})),
      fetchCustomFieldMap(LOCATION_ID).catch(() => ({})),
    ]);

    const contacts = rawContacts.map((c) => normalizeContact(c, userMap, oppMap, cfMap));

    // Separar conversaciones de tipo llamada vs mensajes
    const callConvs = rawConversations.filter(c => isCallConversation(c));
    const msgConvs  = rawConversations.filter(c => !isCallConversation(c));

    // Obtener duración + estado reales de las llamadas más recientes (máx 20, paralelo)
    const callDetailMap = {};
    const toDetail = callConvs.slice(0, 20);
    const detailResults = await Promise.allSettled(toDetail.map(c => fetchCallMessages(c.id)));
    toDetail.forEach((c, i) => {
      const r = detailResults[i];
      if (r.status === "fulfilled" && r.value) callDetailMap[c.id] = r.value;
    });

    const llamadas = callConvs.map((c) => normalizeLlamada(c, userMap, callDetailMap[c.id] || null));
    const mensajes = msgConvs.map((c)  => normalizeConversation(c, userMap));

    res.json({
      ok:        true,
      synced:    true,
      contacts,
      mensajes,
      llamadas,
      total:         contacts.length,
      totalMensajes: mensajes.length,
      totalLlamadas: llamadas.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}