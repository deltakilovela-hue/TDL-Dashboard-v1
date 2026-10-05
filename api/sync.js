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

// Tope de seguridad de páginas (100 × 100 = 10,000 registros) — solo evita
// loops infinitos; el corte real es cuando GHL devuelve menos de 100.
const MAX_PAGES = 100;

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
  for (let p = 0; p < MAX_PAGES; p++) {
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

// /opportunities/search solo devuelve pipelineId y pipelineStageId (no los
// nombres) — se resuelven contra el catálogo de pipelines de la ubicación.
async function fetchPipelineMaps(locationId) {
  const pipelines = {}, stages = {};
  try {
    const data = await ghlGet("/opportunities/pipelines", { locationId });
    (data.pipelines || []).forEach(p => {
      pipelines[p.id] = p.name;
      (p.stages || []).forEach(s => { stages[s.id] = s.name; });
    });
  } catch (e) { console.warn("fetchPipelineMaps:", e.message); }
  return { pipelines, stages };
}

async function fetchOpportunityMap(locationId) {
  const map = {}; let cursor = null;
  const { pipelines, stages } = await fetchPipelineMaps(locationId);
  for (let p = 0; p < MAX_PAGES; p++) {
    try {
      const data = await ghlGet("/opportunities/search", { location_id: locationId, limit: "100", ...cursorParams(cursor) });
      const opps = data.opportunities || [];
      console.log(`opps p${p+1}: ${opps.length}`);
      opps.forEach(opp => {
        const contactId = opp.contactId || opp.contact?.id; if (!contactId) return;
        const pipelineName = pipelines[opp.pipelineId] || opp.pipeline?.name || "";
        const stageName    = stages[opp.pipelineStageId] || opp.pipelineStage?.name || "(No hay datos)";
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

// ── Conversaciones paginadas ──────────────────────────────────────────────────
// /conversations/search NO manda meta/cursor (meta: null), por eso extractCursor
// cortaba en la primera página y solo se leían 100 de ~1,300. Se pagina con
// startAfterDate = sort[0] (lastMessageDate) de la última conversación.
async function fetchConversations(locationId) {
  const all = []; const seen = new Set(); let startAfterDate = null;
  for (let p = 0; p < MAX_PAGES; p++) {
    try {
      const data  = await ghlGet("/conversations/search", { locationId, limit: "100", startAfterDate });
      const batch = data.conversations || [];
      const fresh = batch.filter(c => c.id && !seen.has(c.id) && seen.add(c.id));
      all.push(...fresh);
      console.log(`convs p${p+1}: ${batch.length} → total ${all.length}`);
      const next = batch.at(-1)?.sort?.[0] ?? batch.at(-1)?.lastMessageDate;
      if (batch.length < 100 || !next || next === startAfterDate || fresh.length === 0) break;
      startAfterDate = next;
    } catch (e) { console.warn("fetchConvs p" + p, e.message); break; }
  }
  return all;
}

// ── Normalizar contacto ───────────────────────────────────────────────────────
// Nota: antes había un paso que volvía a pedir cada contacto con GET individual
// para "enriquecer" los custom fields. Se quitó: el listado masivo ya los trae
// completos (verificado: 20/20 contactos iguales bulk vs individual) y esas
// ~300 peticiones extra disparaban el rate limit de GHL (143/300 fallaban),
// haciendo fallar otras pantallas como la ficha de contacto.
// Helper: aplica una lista de campos personalizados al objeto custom
function applyCustomFields(fields, cfMap, custom) {
  fields.forEach(f => {
    const val = f.value ?? "";
    if (!val) return;
    if (f.id) custom[f.id] = val;
    if (f.fieldKey) {
      custom[f.fieldKey] = val;
      custom[f.fieldKey.replace(/^contact\./, "")] = val;
    }
    const dn = (f.id && cfMap[f.id]) || (f.fieldKey && cfMap[f.fieldKey]) || (f.fieldKey && cfMap[f.fieldKey.replace(/^contact\./, "")]) || "";
    if (dn) custom[dn] = val;
  });
}

function normalizeContact(c, userMap, oppMap, cfMap) {
  const custom = {};
  applyCustomFields(c.customField || c.customFields || [], cfMap, custom);
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
    // ── Encuesta Primer Contacto (10 campos) ─────────────────────────────────
    // El ID es siempre el primer argumento → lookup más confiable que fieldKey
    capturasPantalla:   get("CisBGAZP5eeeciBWuQ6H", "capturas_de_pantalla_seguimiento_externo"),
    requieroMasTiempo:  get("gxdgjNTOijNFjiV3BY1U", "requiero_mas_tiempo_para_responder"),
    medioContacto:      get("D1bAtBu1yhE3aigqdLCj", "medio_de_contacto_de_preferencia"),
    nivelInteres:       get("IVDOKjoJDMtoCcYqzlPH", "_nivel_de_interes_del_prospecto",      "nivel_de_interes_del_prospecto"),
    deseaCita:          get("GhEmwRVvGcPSap7NnZsP", "_desea_agendar_una_cita",              "desea_agendar_una_cita"),
    presupuesto:        get("XPJiJOI5nVLNXzEXlrDp", "_presupuesto_estimado",                "presupuesto_estimado"),
    financiamiento:     get("oLYtW2bv1h8HO11fyJ86", "_cuenta_con_financiamiento_o_credito", "cuenta_con_financiamiento_o_credito"),
    notaPrimerContacto: get("UaloobEyDQTsCu41WUnU", "comentario_de_nota_seguimiento_frio_"),
    funciones:          get("w5UHR3yXRimaT1wTYpyb", "funciones_de_lead"),
    notaSeguimiento:    get("pJ7gXNsKRQaTz6DjICcz", "comentario_de_seguimiento_externo"),
    // ── Encuesta Cierre Comercial (9 campos) ─────────────────────────────────
    necesitaMasTiempo:  get("2W96VabNVt3fAX4f4kl7", "necesito_mas_tiempo_con_el_prospecto"),
    descartado:         get("e50h3LU2xsG03FxQYAEN", "descartado_"),
    sePresentoCita:     get("mXKBwOYrchFLnzyllrwf", "_el_prospecto_se_presento_a_la_cita"),
    tipoCita:           get("Kfx8xOs1NC9hIuTXAFor", "_tipo_de_cita"),
    nivelInteresPost:   get("x1bW12U6t73E4Xh9RiI2", "_nivel_de_interes_despues_de_la_cita"),
    queFaltaCerrar:     get("H8SyacUea1rwdbx8JzEU", "_que_le_hace_falta_para_cerrar_la_operacion"),
    requiereCloser:     get("mPBM192trmYBC5ZY0xxo", "_requiere_intervencion_de_un_closer_u_otro_equipo"),
    fechaSeguimiento:   get("TFPJmo94s7rXwhYmJNQb", "_fecha_tentativa_de_seguimientocierre"),
    notaCierre:         get("KARIFTmgIzdlCPBYX0IL", "comentario_nota_cita_por_confirmar"),
    // ── Historial y contador de notas ─────────────────────────────────────────
    sumaNotas:          get("yxFLpVaQpgBtldW2fpet", "suma_de_notas_de_agente"),          // ID confirmado por debug
    historialNotas:     get("JchVLh13uAo6SdV6hYRg", "historial_de_notas_para_clientes"), // ID confirmado por debug
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

    const userMap = buildUserMap(rawUsers);

    const contacts = rawContacts.map(c => normalizeContact(c, userMap, oppMap, cfMap));
    const usuarios = rawUsers.map(u => ({
      id: u.id,
      name: u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim() || "(Sin nombre)",
      email: u.email || "",
      role:  u.role  || "",
    }));

    // Conversaciones normalizadas
    // GHL unifica todos los canales de un contacto en UNA conversación con
    // type "TYPE_PHONE" (100% de los casos en esta ubicación), así que el type
    // no distingue llamada de mensaje. Se usa lastMessageType: la conversación
    // cuenta como llamada si su última actividad fue una llamada.
    const conversations = rawConversations.map(c => {
      const channelType = String(c.lastMessageType || c.type || "").toLowerCase();
      const isCall = channelType === "type_call";

      // GHL NO devuelve lastMessageDirection en conversaciones de WhatsApp/SMS.
      // Fallback: si hay mensajes sin leer → el último fue del cliente (inbound).
      //           si unreadCount === 0    → el asesor respondió (outbound).
      const rawDir    = c.lastMessageDirection ?? c.direction ?? c.lastMessage?.direction;
      const unread    = Number(c.unreadCount) || 0;
      const direction = rawDir != null
        ? String(rawDir)
        : (unread > 0 ? "inbound" : "outbound");

      return {
        id:                   c.id,
        contactId:            c.contactId,
        assignedToName:       c.assignedTo ? (userMap[c.assignedTo] || "(Sin asignar)") : "(Sin asignar)",
        lastMessageDate:      c.lastMessageDate || c.dateUpdated || null,
        lastMessageDirection: direction,
        lastMessageBody:      c.lastMessageBody ? String(c.lastMessageBody).substring(0, 300) : null,
        unreadCount:          unread,
        isCall,
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
