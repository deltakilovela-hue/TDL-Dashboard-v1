// api/sync.js — GET /api/sync
import { cacheGet, cacheSet, cacheDel } from "./_lib.js";

export const config = { maxDuration: 60 };

const GHL_BASE    = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

const PRIORITY_PIPELINES  = ["01 - Desarrollos", "02 - Cierre", "Rentas Vacacionales"];
const ALLOWED_STATUSES    = new Set(["open", "won", "abandoned"]);
const SKIP_PIPELINE_NAMES = ["seguimiento ia", "recepción", "recepcion"];

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

// GHL necesita AMBOS: startAfterId + startAfter (timestamp ms) para paginar
function extractCursor(data, batch) {
  const id = data.meta?.startAfterId;
  const ts = data.meta?.startAfter;
  if (id) return { startAfterId: id, startAfter: ts ?? null };
  if (data.meta?.nextPageUrl) {
    try {
      const u   = new URL(data.meta.nextPageUrl);
      const sid = u.searchParams.get("startAfterId");
      const sts = u.searchParams.get("startAfter");
      if (sid) return { startAfterId: sid, startAfter: sts ? Number(sts) : null };
    } catch {}
  }
  return null;
}

function cursorParams(cursor) {
  if (!cursor) return {};
  return { startAfterId: cursor.startAfterId, ...(cursor.startAfter != null ? { startAfter: cursor.startAfter } : {}) };
}

function sameCursor(a, b) {
  if (!a || !b) return false;
  return a.startAfterId === b.startAfterId && a.startAfter === b.startAfter;
}

// ── Usuarios ──────────────────────────────────────────────────────────────────
async function fetchUsers(locationId) {
  try {
    const data = await ghlGet("/users/", { locationId });
    return data.users || [];
  } catch (e) { console.warn("fetchUsers:", e.message); return []; }
}

function buildUserMap(users) {
  const map = {};
  users.forEach(u => {
    if (!u.id) return;
    map[u.id] = u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim() || "(Sin nombre)";
  });
  return map;
}

// ── Custom fields ─────────────────────────────────────────────────────────────
async function fetchCustomFieldMap(locationId) {
  try {
    const data = await ghlGet(`/locations/${locationId}/customFields`);
    const map  = {};
    (data.customFields || []).forEach(f => {
      if (!f.name) return;
      if (f.id)       map[f.id] = f.name;
      if (f.fieldKey) { map[f.fieldKey] = f.name; map[f.fieldKey.replace(/^contact\./, "")] = f.name; }
    });
    return map;
  } catch (e) { console.warn("fetchCustomFieldMap:", e.message); return {}; }
}

// ── Contactos paginados ───────────────────────────────────────────────────────
async function fetchContacts(locationId) {
  const all = []; const seen = new Set(); let cursor = null;
  for (let p = 0; p < 20; p++) {
    try {
      const data = await ghlGet("/contacts/", { locationId, limit: "100", ...cursorParams(cursor) });
      const raw  = data.contacts || [];
      const batch = raw.filter(c => { if (!c.id || seen.has(c.id)) return false; seen.add(c.id); return true; });
      all.push(...batch);
      console.log(`contacts p${p+1}: ${raw.length} → total ${all.length}`);
      const next = extractCursor(data, raw);
      if (raw.length < 100 || !next || sameCursor(cursor, next)) break;
      cursor = next;
    } catch (e) { console.warn("fetchContacts p" + p, e.message); break; }
  }
  return all;
}

// ── Oportunidades paginadas ───────────────────────────────────────────────────
function oppScore(status, pipeline) {
  const s = status === "open" ? 0 : status === "abandoned" ? 1 : 2;
  const p = PRIORITY_PIPELINES.findIndex(n => n.toLowerCase() === pipeline.toLowerCase());
  return s * 10 + (p === -1 ? 99 : p);
}

async function fetchOpportunityMap(locationId) {
  const map = {}; let cursor = null;
  for (let p = 0; p < 20; p++) {
    try {
      const data = await ghlGet("/opportunities/search", { location_id: locationId, limit: "100", ...cursorParams(cursor) });
      const opps = data.opportunities || [];
      console.log(`opps p${p+1}: ${opps.length}`);
      opps.forEach(opp => {
        const contactId = opp.contactId || opp.contact?.id; if (!contactId) return;
        const pipelineName = opp.pipeline?.name || ""; const stageName = opp.pipelineStage?.name || "(No hay datos)";
        const status = (opp.status || "open").toLowerCase();
        const pl = pipelineName.toLowerCase();
        if (SKIP_PIPELINE_NAMES.some(s => pl.includes(s))) return;
        if (!ALLOWED_STATUSES.has(status)) return;
        if (!PRIORITY_PIPELINES.some(p => p.toLowerCase() === pl)) return;
        const cur = map[contactId]; const ns = oppScore(status, pipelineName); const cs = cur ? oppScore(cur.status, cur.pipeline) : 999;
        if (ns < cs) map[contactId] = { pipeline: pipelineName, stage: stageName, status };
      });
      const next = extractCursor(data, opps);
      if (opps.length < 100 || !next || sameCursor(cursor, next)) break;
      cursor = next;
    } catch (e) { console.warn("fetchOpps p" + p, e.message); break; }
  }
  return map;
}

// ── Conversaciones paginadas (máx 1000 para stats semanales) ─────────────────
function isCallConv(c) {
  const t = String(c.type || "").toLowerCase();
  const ch = String(c.lastMessageChannel || c.lastMessageType || "").toLowerCase();
  return t === "type_phone" || t === "phone" || t === "6" || ch === "call" || ch === "phone_call" || ch.includes("call") || ch.includes("phone");
}

async function fetchConversations(locationId) {
  const all = []; let cursor = null;
  for (let p = 0; p < 10; p++) {
    try {
      const data  = await ghlGet("/conversations/search", { locationId, limit: "100", ...cursorParams(cursor) });
      const batch = data.conversations || [];
      all.push(...batch);
      console.log(`convs p${p+1}: ${batch.length}`);
      const next = extractCursor(data, batch);
      if (batch.length < 100 || !next || sameCursor(cursor, next)) break;
      cursor = next;
    } catch (e) { console.warn("fetchConvs p" + p, e.message); break; }
  }
  return all;
}

// ── Normalizar contacto ───────────────────────────────────────────────────────
function normalizeContact(c, userMap, oppMap, cfMap) {
  const custom = {};
  (c.customField || []).forEach(f => {
    const val = f.value ?? "";
    if (f.id) custom[f.id] = val;
    if (f.fieldKey) { custom[f.fieldKey] = val; custom[f.fieldKey.replace(/^contact\./, "")] = val; }
    const dn = (f.id && cfMap[f.id]) || (f.fieldKey && cfMap[f.fieldKey]) || (f.fieldKey && cfMap[f.fieldKey.replace(/^contact\./, "")]) || "";
    if (dn) custom[dn] = val;
  });
  const opp = oppMap[c.id] || {};
  const get = (...keys) => { for (const k of keys) { const v = custom[k]; if (v && v !== "") return v; } return "(No hay datos)"; };
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
    pipelineName:  opp.pipeline || "(No hay datos)",
    pipelineStage: opp.stage    || "(No hay datos)",
    nivelInteres:    get("_nivel_de_interes_del_prospecto",      "nivel_de_interes_del_prospecto"),
    presupuesto:     get("_presupuesto_estimado",                "presupuesto_estimado"),
    financiamiento:  get("_cuenta_con_financiamiento_o_credito", "cuenta_con_financiamiento_o_credito"),
    deseaCita:       get("_desea_agendar_una_cita",              "desea_agendar_una_cita"),
    medioContacto:   get("medio_de_contacto_de_preferencia"),
    funciones:       get("funciones_de_lead"),
    sePresentoCita:  get("_el_prospecto_se_presento_a_la_cita"),
    nivelInteresPost:get("_nivel_de_interes_despues_de_la_cita"),
    queFaltaCerrar:  get("_que_le_hace_falta_para_cerrar_la_operacion"),
    requiereCloser:  get("_requiere_intervencion_de_un_closer_u_otro_equipo"),
    fechaSeguimiento:get("_fecha_tentativa_de_seguimientocierre"),
    // ── Notas de actividad del asesor ──────────────────────────────────────────
    notaPrimerContacto: get(
      "Comentario de NOTA primer contacto",
      "comentario_de_nota_primer_contacto",
      "comentario_nota_primer_contacto",
      "nota_primer_contacto",
    ),
    notaSeguimiento: get(
      "Comentario de seguimiento externo",
      "comentario_de_seguimiento_externo",
      "comentario_seguimiento_externo",
      "seguimiento_externo",
    ),
    notaCierre: get(
      "Comentario NOTA Cierre comercial",
      "Comentario NOTA cierre comercial",
      "Comentario NOTA de cierre",
      "comentario_nota_cierre_comercial",
      "comentario_nota_de_cierre",
      "comentario_nota_cierre",
      "nota_cierre",
    ),
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const API_KEY     = process.env.GHL_API_KEY;
  const LOCATION_ID = process.env.GHL_LOCATION_ID;
  if (!API_KEY || !LOCATION_ID) return res.status(500).json({ ok: false, error: "Faltan env vars GHL." });

  const force = req.query?.force === "true";
  if (!force) { const cached = await cacheGet(); if (cached) return res.json({ ...cached, fromCache: true }); }
  else { await cacheDel(); }

  try {
    console.log("🔄 sync start");
    const t0 = Date.now();

    // Todo en paralelo para no desperdiciar tiempo
    const [rawContacts, rawConversations, rawUsers, cfMap, oppMap] = await Promise.all([
      fetchContacts(LOCATION_ID),
      fetchConversations(LOCATION_ID).catch(() => []),
      fetchUsers(LOCATION_ID),
      fetchCustomFieldMap(LOCATION_ID).catch(() => ({})),
      fetchOpportunityMap(LOCATION_ID),
    ]);

    const userMap  = buildUserMap(rawUsers);
    const contacts = rawContacts.map(c => normalizeContact(c, userMap, oppMap, cfMap));
    const usuarios = rawUsers.map(u => ({
      id: u.id,
      name: u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim() || "(Sin nombre)",
      email: u.email || "",
      role:  u.role  || "",
    }));

    // Conversaciones normalizadas
    // isCall se basa en el TYPE del canal (phone), NO en el último mensaje.
    // Así una conversación de WhatsApp que tuvo una llamada mezclada
    // no pierde su clasificación de "mensaje".
    const conversations = rawConversations.map(c => {
      const channelType = String(c.type || "").toLowerCase();
      const isCall = channelType === "type_phone" || channelType === "phone" ||
                     channelType === "6" || channelType === "call";
      return {
        id:                   c.id,
        contactId:            c.contactId,
        assignedToName:       c.assignedTo ? (userMap[c.assignedTo] || "(Sin asignar)") : "(Sin asignar)",
        lastMessageDate:      c.lastMessageDate || c.dateUpdated || null,
        lastMessageDirection: c.lastMessageDirection || null,
        unreadCount:          Number(c.unreadCount) || 0,
        isCall,
        // pasar channelType crudo para debug
        channelType,
      };
    });

    console.log(`✅ contactos:${contacts.length} opps:${Object.keys(oppMap).length} convs:${conversations.length} en ${Date.now()-t0}ms`);

    const payload = {
      ok: true, synced: true, updatedAt: new Date().toISOString(),
      total: contacts.length, totalAgentes: usuarios.length,
      contacts, usuarios, conversations,
    };

    await cacheSet(payload);
    res.json({ ...payload, fromCache: false });
  } catch (err) {
    console.error("sync error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
