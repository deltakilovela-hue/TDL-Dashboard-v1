// Vercel Serverless Function: GET /api/sync
// Descarga contactos, conversaciones, usuarios y oportunidades de GHL.
// Plan: Starter. Campos específicos solicitados por usuario.

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
      if (u.id) map[u.id] = u.name || `${u.firstName || ""}${u.lastName ? " " + u.lastName : ""}`.trim() || "(No hay datos)";
    });
    return map;
  } catch (e) {
    console.warn("⚠️ fetchUserMap:", e.message);
    return {};
  }
}

// ── Fetch opportunities → { contactId: { pipeline, stage, status, value } } ────
async function fetchOpportunityMap(locationId) {
  const map = {};
  let startAfterId = null;
  const PRIORITY = ["01 - Desarrollos", "02 - Cierre", "Rentas Vacacionales"];

  for (let page = 0; page < 20; page++) {
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
        const pipelineName = opp.pipeline?.name || opp.pipelineName || "(No hay datos)";
        const stageName    = opp.pipelineStage?.name || opp.pipelineStageName || opp.name || "(No hay datos)";
        const value        = opp.value || "(No hay datos)";
        const status       = opp.status || "open";

        if (pipelineName === "Seguimiento IA") return;

        const current = map[contactId];
        const isMainPipeline = PRIORITY.includes(pipelineName);
        const currentIsMain  = current && PRIORITY.includes(current.pipeline);

        if (!current ||
            (isMainPipeline && !currentIsMain) ||
            (isMainPipeline && currentIsMain && status === "open" && current.status !== "open")) {
          map[contactId] = { pipeline: pipelineName, stage: stageName, value, status };
        }
      });

      const nextId = data.meta?.startAfterId;
      if (opps.length < 100 || !nextId) break;
      startAfterId = nextId;
    } catch (e) {
      console.warn("⚠️ fetchOpportunityMap page", page, e.message);
      break;
    }
  }
  return map;
}

// ── Fetch custom field definitions ─────────────────────────────────────────────
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

// ── Fetch contacts (paginado, máx 20 páginas = 2000 contactos) ────────────────
async function fetchContacts(locationId) {
  const all = [];
  let startAfterId = null;
  const seen = new Set();

  for (let page = 0; page < 20; page++) {
    try {
      const data = await ghlGet("/contacts/", { locationId, limit: "100", startAfterId });
      const batch = (data.contacts || []).filter(c => {
        if (!c.id || seen.has(c.id)) return false;
        seen.add(c.id); return true;
      });
      all.push(...batch);
      const raw = data.contacts || [];
      const nextId = data.meta?.startAfterId;
      if (raw.length < 100 || !nextId || all.length >= (data.meta?.total || Infinity)) break;
      startAfterId = nextId;
    } catch (e) {
      console.warn("⚠️ fetchContacts page", page, e.message);
      break;
    }
  }
  return all;
}

// ── Fetch conversations (paginado, máx 10 páginas = 1000) ────────────────────
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

// ── Detecta si una conversación es una llamada telefónica ──────────────────────
function isCallConversation(c) {
  const type    = String(c.type || "").toLowerCase();
  const channel = String(c.lastMessageChannel || c.lastMessageType || "").toLowerCase();
  return type === "type_phone" || type === "phone" || type === "6" ||
         channel === "call" || channel === "phone_call" || channel === "type_call" ||
         channel.includes("call") || channel.includes("phone");
}

// ── Obtiene detalles reales de una llamada desde sus mensajes ─────────────────
async function fetchCallMessages(convId) {
  try {
    const data = await ghlGet(`/conversations/${convId}/messages`, { limit: "20" });
    const msgs = Array.isArray(data.messages) ? data.messages
               : Array.isArray(data.messages?.messages) ? data.messages.messages : [];

    // Buscar el mensaje de llamada
    const callMsg = msgs.find(m => m.meta?.callDuration !== undefined) ||
                    msgs.find(m => m.messageType === "TYPE_CALL" || m.type === 10);

    if (!callMsg) return null;

    return {
      id: callMsg.id || "",
      body: callMsg.body || "(No hay datos)",
      direction: callMsg.direction || "(No hay datos)",
      type: callMsg.messageType || callMsg.type || "(No hay datos)",
      callDuration: parseInt(callMsg.meta?.callDuration || 0),
      callStatus: callMsg.meta?.callStatus || "(No hay datos)",
      callRecording: callMsg.meta?.callRecording || "(No hay datos)",
    };
  } catch {
    return null;
  }
}

// ── NORMALIZAR: Contacto (campos solicitados) ──────────────────────────────────
function normalizeContact(c, userMap, oppMap, cfMap = {}) {
  const custom = {};
  (c.customField || []).forEach((f) => {
    const val = f.value ?? "";
    if (f.id)       custom[f.id] = val;
    if (f.fieldKey) {
      custom[f.fieldKey] = val;
      custom[f.fieldKey.replace(/^contact\./, "")] = val;
    }
    const displayName = (f.id && cfMap[f.id]) || (f.fieldKey && cfMap[f.fieldKey]) ||
                        (f.fieldKey && cfMap[f.fieldKey.replace(/^contact\./, "")]) || "";
    if (displayName) custom[displayName] = val;
  });

  const opp = oppMap[c.id] || {};
  const pipelineName = opp.pipeline || "(No hay datos)";
  const pipelineStage = opp.stage || "(No hay datos)";

  return {
    // CAMPOS SOLICITADOS
    "ID": c.id || "(No hay datos)",
    "First Name": c.firstName || "(No hay datos)",
    "Last Name": c.lastName || "(No hay datos)",
    "Phone": c.phone || "(No hay datos)",
    "Source": c.source || "(No hay datos)",
    "Status": c.status || "(No hay datos)",
    "Date Added": c.dateAdded || "(No hay datos)",
    "Date Updated": c.dateUpdated || "(No hay datos)",
    "Last Activity Date": c.lastActivityDate || "(No hay datos)",
    "Assigned To": c.assignedTo ? (userMap[c.assignedTo] || c.assignedTo) : "(No hay datos)",
    "Owner Name": c.ownerName || userMap[c.assignedTo] || "(No hay datos)",
    "Tags": Array.isArray(c.tags) ? (c.tags.join(", ") || "(No hay datos)") : (c.tags || "(No hay datos)"),
    "Unread Count": c.unreadCount || "0",
    "Pipeline Name": pipelineName,
    "Pipeline Stage": pipelineStage,

    // CUSTOM FIELDS (encuestas)
    "🌡️ Nivel de interés del prospecto": custom["_nivel_de_interes_del_prospecto"] || custom["nivel_de_interes_del_prospecto"] || "(No hay datos)",
    "💸 Presupuesto estimado": custom["_presupuesto_estimado"] || custom["presupuesto_estimado"] || "(No hay datos)",
    "🏦 ¿Cuenta con financiamiento o crédito?": custom["_cuenta_con_financiamiento_o_credito"] || custom["cuenta_con_financiamiento_o_credito"] || "(No hay datos)",
    "📅 ¿Desea agendar una cita?": custom["_desea_agendar_una_cita"] || custom["desea_agendar_una_cita"] || "(No hay datos)",
    "Comentario de NOTA primer contacto": custom["comentario_de_nota_seguimiento_frio_"] || custom["comentario_de_nota_primer_contacto"] || "(No hay datos)",
    "Medio de contacto de preferencia": custom["medio_de_contacto_de_preferencia"] || "(No hay datos)",
    "Requiero más tiempo para responder": custom["requiero_mas_tiempo_para_responder"] || "(No hay datos)",
    "Funciones de LEAD": custom["funciones_de_lead"] || "(No hay datos)",
    "Comentario de seguimiento externo": custom["comentario_de_seguimiento_externo"] || "(No hay datos)",

    // CIERRE COMERCIAL
    "¿El prospecto se presentó a la cita?": custom["_el_prospecto_se_presento_a_la_cita"] || "(No hay datos)",
    "📊 Nivel de interés después de la cita": custom["_nivel_de_interes_despues_de_la_cita"] || "(No hay datos)",
    "¿Qué le hace falta para cerrar?": custom["_que_le_hace_falta_para_cerrar_la_operacion"] || "(No hay datos)",
    "¿Requiere closer u otro equipo?": custom["_requiere_intervencion_de_un_closer_u_otro_equipo"] || "(No hay datos)",
    "📅 Fecha tentativa seguimiento/cierre": custom["_fecha_tentativa_de_seguimientocierre"] || "(No hay datos)",
    "Comentario NOTA Cierre Comercial": custom["comentario_nota_cita_por_confirmar"] || "(No hay datos)",
    "Necesito más tiempo con el prospecto": custom["necesito_mas_tiempo_con_el_prospecto"] || "(No hay datos)",
    "Descartado": custom["descartado_"] || "(No hay datos)",

    // RENTAS VACACIONALES
    "Agente de rentas": custom["agente_de_rentas"] || "(No hay datos)",
    "¿Necesitas algo especial?": custom["necesidad_especial_rentasvacionales"] || "(No hay datos)",
    "Número de personas (total)": custom["numero_de_personas_total_rentasvacionales"] || custom["numero_de_personas_total"] || "(No hay datos)",
    "¿Cuántos días estarás con nosotros?": custom["numero_dias_estadia_rentasvacionales"] || "(No hay datos)",
    "Fecha de visita (rentas)": custom["fecha_de_visita_rentasvacionales"] || "(No hay datos)",
    "Propiedad seleccionada": custom["propiedad_seleccionada"] || custom["propiedad"] || "(No hay datos)",

    // COMPATIBILIDAD LEGACY (para App.jsx y dashboard)
    "Contact Id": c.id || "(No hay datos)",
    "Nombre del Contacto": `${c.firstName || ""} ${c.lastName || ""}`.trim() || "(No hay datos)",
    "Número de teléfono": c.phone || "(No hay datos)",
    "Usuario asignado": c.ownerName || userMap[c.assignedTo] || "(No hay datos)",
    "Assigned To": c.ownerName || userMap[c.assignedTo] || "(No hay datos)",
    "Pipeline": pipelineName,
    "Pipeline Name": pipelineName,
    "Stage": pipelineStage,
    "Primary Contact Name": `${c.firstName || ""} ${c.lastName || ""}`.trim() || "(No hay datos)",
    "Assigned User": c.ownerName || userMap[c.assignedTo] || "(No hay datos)",
    "Email": c.email || "(No hay datos)",
    "Created On": c.dateAdded || "(No hay datos)",
    "Updated": c.dateUpdated || "(No hay datos)",
    "Last Activity": c.lastActivityDate || "(No hay datos)",
    "Days Assigned": Math.floor((Date.now() - new Date(c.dateAdded || Date.now()).getTime()) / 86400000),
    "Opportunities": opp.pipeline && opp.stage ? `${opp.status}: ${opp.pipeline} - ${opp.stage}` : "(No hay datos)",
    ...custom,
  };
}

// ── NORMALIZAR: Conversación (campos solicitados) ────────────────────────────────
function normalizeConversation(c, userMap) {
  return {
    // CAMPOS SOLICITADOS
    "ID": c.id || "(No hay datos)",
    "Contact ID": c.contactId || "(No hay datos)",
    "Last Message Date": c.lastMessageDate || c.dateUpdated || "(No hay datos)",
    "Unread Count": c.unreadCount || "0",
    "Date Updated": c.dateUpdated || "(No hay datos)",

    // COMPATIBILIDAD LEGACY (para App.jsx)
    "Contact Id": c.contactId || "(No hay datos)",
    "Nombre del Contacto": c.contactName || c.fullName || "(No hay datos)",
    "Mensajes no leídos": String(c.unreadCount || 0),
    "Asignado a": c.assignedTo ? (userMap[c.assignedTo] || c.assignedTo) : "(No hay datos)",
    "Tipo": (c.unreadCount || 0) > 0 ? "Unread" : "Read",
    "Dirección del último mensaje": c.lastMessageDirection || "(No hay datos)",
    "Canal del último Mensaje": c.lastMessageChannel || c.lastMessageType || c.type || "(No hay datos)",
    "Creada Activado": c.dateCreated || c.dateUpdated || "(No hay datos)",
  };
}

// ── NORMALIZAR: Mensaje Individual / Llamada (campos solicitados) ────────────────
function normalizeCallMessage(msg, contact) {
  return {
    // CAMPOS SOLICITADOS
    "ID": msg.id || "(No hay datos)",
    "Body": msg.body || "(No hay datos)",
    "Direction": msg.direction || "(No hay datos)",
    "Type": msg.type || "(No hay datos)",
    "Call Duration": msg.callDuration || "0",
    "Call Status": msg.callStatus || "(No hay datos)",
    "Call Recording": msg.callRecording || "(No hay datos)",

    // COMPATIBILIDAD LEGACY (para App.jsx)
    "Nombre del Contacto": contact.contactName || "(No hay datos)",
    "Llamar realizada Vía": contact.ownerName || "(No hay datos)",
    "Duración (in segundos)": msg.callDuration || "0",
    "Estado de la llamada": msg.callStatus === "completed" ? "Answered" : msg.callStatus === "no-answer" || msg.callStatus === "missed" ? "No Answer" : msg.callStatus || "Answered",
    "Creada Activado": contact.dateCreated || "(No hay datos)",
    "Contact Id": contact.contactId || "(No hay datos)",
  };
}

// ── NORMALIZAR: Usuario (campos solicitados) ───────────────────────────────────
function normalizeUser(u) {
  return {
    "ID": u.id || "(No hay datos)",
    "First Name": u.firstName || "(No hay datos)",
    "Last Name": u.lastName || "(No hay datos)",
  };
}

// ── NORMALIZAR: Oportunidad (campos solicitados) ────────────────────────────────
function normalizeOpportunity(opp) {
  return {
    "ID": opp.id || "(No hay datos)",
    "Pipeline": opp.pipeline?.name || opp.pipelineName || "(No hay datos)",
    "Pipeline Stage": opp.pipelineStage?.name || opp.pipelineStageName || "(No hay datos)",
    "Value": opp.value || "(No hay datos)",
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
    // Descargas en paralelo
    const [rawContacts, rawConversations, rawUsers, rawOpps, cfMap] = await Promise.all([
      fetchContacts(LOCATION_ID),
      fetchConversations(LOCATION_ID).catch(() => []),
      ghlGet("/users/", { locationId: LOCATION_ID }).then(d => d.users || []).catch(() => []),
      ghlGet("/opportunities/search", { location_id: LOCATION_ID, limit: "100" }).then(d => d.opportunities || []).catch(() => []),
      fetchCustomFieldMap(LOCATION_ID).catch(() => ({})),
    ]);

    // Construir mapas
    const userMap = {};
    rawUsers.forEach(u => {
      if (u.id) userMap[u.id] = `${u.firstName || ""}${u.lastName ? " " + u.lastName : ""}`.trim() || "(No hay datos)";
    });

    const oppMap = {};
    const PRIORITY = ["01 - Desarrollos", "02 - Cierre", "Rentas Vacacionales"];
    rawOpps.forEach(opp => {
      const contactId = opp.contactId;
      if (!contactId) return;
      const pipelineName = opp.pipeline?.name || "(No hay datos)";
      if (pipelineName === "Seguimiento IA") return;
      const stageName = opp.pipelineStage?.name || "(No hay datos)";
      const current = oppMap[contactId];
      const isMainPipeline = PRIORITY.includes(pipelineName);
      const currentIsMain = current && PRIORITY.includes(current.pipeline);
      if (!current || (isMainPipeline && !currentIsMain)) {
        oppMap[contactId] = { pipeline: pipelineName, stage: stageName, status: opp.status || "open" };
      }
    });

    // Normalizar
    const contacts = rawContacts.map(c => normalizeContact(c, userMap, oppMap, cfMap));

    // Separar llamadas de mensajes
    const callConvs = rawConversations.filter(c => isCallConversation(c));
    const msgConvs  = rawConversations.filter(c => !isCallConversation(c));

    // Detalles de llamadas (máx 8)
    const callDetailMap = {};
    const toDetail = callConvs.slice(0, 8);
    const detailResults = await Promise.allSettled(toDetail.map(c => fetchCallMessages(c.id)));
    toDetail.forEach((c, i) => {
      const r = detailResults[i];
      if (r.status === "fulfilled" && r.value) callDetailMap[c.id] = r.value;
    });

    const mensajes = msgConvs.map(c => normalizeConversation(c, userMap));
    const llamadas = callConvs.map(c => callDetailMap[c.id] ? normalizeCallMessage(callDetailMap[c.id], c) : {
      "ID": c.id || "(No hay datos)",
      "Body": "(No hay datos)",
      "Direction": "(No hay datos)",
      "Type": "(No hay datos)",
      "Call Duration": "0",
      "Call Status": "(No hay datos)",
      "Call Recording": "(No hay datos)",
      // LEGACY
      "Nombre del Contacto": c.contactName || "(No hay datos)",
      "Llamar realizada Vía": c.ownerName || "(No hay datos)",
      "Duración (in segundos)": "0",
      "Estado de la llamada": "No Answer",
      "Creada Activado": c.dateCreated || "(No hay datos)",
      "Contact Id": c.contactId || "(No hay datos)",
    });

    const usuarios = rawUsers.map(u => normalizeUser(u));
    const oportunidades = rawOpps.map(o => normalizeOpportunity(o));

    res.json({
      ok: true,
      synced: true,
      contacts,
      mensajes,
      llamadas,
      usuarios,
      oportunidades,
      total: contacts.length,
      totalMensajes: mensajes.length,
      totalLlamadas: llamadas.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
