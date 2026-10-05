#!/usr/bin/env node
/**
 * scripts/sync-deep.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Ejecutado por GitHub Actions cada noche.
 * Sin límite de tiempo de Vercel — puede tardar varios minutos.
 *
 * Qué hace:
 *   1. Descarga todas las conversaciones de GHL (paginadas)
 *   2. Por cada conversación activa en los últimos 90 días, descarga
 *      todos sus mensajes y clasifica: mensaje enviado (+ canal) / llamada
 *      (+ contestada/perdida), y registra qué contactos fueron tocados.
 *   3. Descarga las notas de TODOS los contactos de la ubicación (no solo
 *      los de conversaciones activas) y las cuenta por fecha/asesor.
 *   4. Acumula estadísticas diarias por asesor: { "YYYY-MM-DD": { ... } }
 *      y las FUSIONA con lo que ya había en Redis — no se sobrescribe el
 *      historial, así el dashboard puede ofrecer un filtro de "histórico
 *      completo" que no pierde datos entre corridas.
 *   5. Guarda el resultado en Upstash Redis (clave tdl:ghl:deep:v1)
 *
 * Variables de entorno requeridas (GitHub Secrets):
 *   GHL_API_KEY, GHL_LOCATION_ID,
 *   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 */

import { isAutoMessage, isSystemActivityType } from "../shared/autoMessagePatterns.js";

const GHL_BASE       = "https://services.leadconnectorhq.com";
const GHL_VERSION    = "2021-07-28";
const DEEP_CACHE_KEY = "tdl:ghl:deep:v1";
const DAYS_BACK      = 90;   // mensajes/llamadas: mirar 90 días hacia atrás en cada corrida
const BATCH_SIZE     = 10;   // conversaciones/contactos en paralelo
const DELAY_MS       = 500;  // pausa entre batches (respetar rate limit GHL)

const { GHL_API_KEY, GHL_LOCATION_ID, UPSTASH_REDIS_REST_TOKEN } = process.env;
const RAW_REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;

if (!GHL_API_KEY || !GHL_LOCATION_ID || !RAW_REDIS_URL || !UPSTASH_REDIS_REST_TOKEN) {
  console.error("❌ Faltan variables de entorno. Verifica los GitHub Secrets.");
  process.exit(1);
}

// Limpiar credenciales embebidas en la URL (https://user:pass@host → https://host)
function sanitizeUrl(raw) {
  try {
    const u = new URL(raw);
    u.username = "";
    u.password = "";
    return u.toString();
  } catch { return raw; }
}
const UPSTASH_REDIS_REST_URL = sanitizeUrl(RAW_REDIS_URL);

// ── GHL fetch helper ──────────────────────────────────────────────────────────
async function ghlGet(path, params = {}) {
  const url = new URL(`${GHL_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const r = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${GHL_API_KEY}`,
      "Content-Type": "application/json",
      Version: GHL_VERSION,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(`GHL ${r.status} ${path}: ${JSON.stringify(err)}`);
  }
  return r.json();
}

// ── Paginación GHL ────────────────────────────────────────────────────────────
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
  return a && b && a.startAfterId === b.startAfterId && a.startAfter === b.startAfter;
}

// ── Espera entre batches ───────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Descargar todos los usuarios ──────────────────────────────────────────────
// Con reintentos: si esto falla en silencio (ej. un 401 transitorio de GHL),
// TODA la corrida atribuye la actividad al userId crudo en vez del nombre del
// asesor, partiendo el historial de cada asesor en dos claves distintas.
// Bug real, ya visto en producción — ver commit que agrega este comentario.
async function fetchUsers(retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const data = await ghlGet("/users/", { locationId: GHL_LOCATION_ID });
      const map  = {};
      (data.users || []).forEach(u => {
        if (u.id) map[u.id] = u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim() || "(Sin nombre)";
      });
      if (Object.keys(map).length > 0) return map;
      console.warn(`fetchUsers intento ${attempt}: respuesta vacía`);
    } catch (e) {
      console.warn(`fetchUsers intento ${attempt}:`, e.message);
    }
    if (attempt < retries) await sleep(2000);
  }
  return {};
}

// Tope de seguridad de páginas — solo evita loops infinitos; el corte real
// es cuando GHL devuelve una página incompleta o se pasa la fecha de corte.
const MAX_PAGES = 100;

// ── Descargar todos los contactos (id + asesor asignado) ──────────────────────
async function fetchAllContacts() {
  const all = []; const seen = new Set(); let cursor = null;
  for (let p = 0; p < MAX_PAGES; p++) {
    try {
      const data  = await ghlGet("/contacts/", { locationId: GHL_LOCATION_ID, limit: "100", ...cursorParams(cursor) });
      const raw   = data.contacts || [];
      const batch = raw.filter(c => { if (!c.id || seen.has(c.id)) return false; seen.add(c.id); return true; });
      all.push(...batch);
      const next = extractCursor(data, raw);
      if (raw.length < 100 || !next || sameCursor(cursor, next)) break;
      cursor = next;
    } catch (e) { console.warn("fetchAllContacts p" + p, e.message); break; }
  }
  return all;
}

// ── Descargar las conversaciones activas desde una fecha ──────────────────────
// /conversations/search NO manda meta/cursor (meta: null), así que extractCursor
// cortaba en la primera página: el job solo procesaba 100 de ~730 conversaciones
// activas. Se pagina con startAfterDate = sort[0] (lastMessageDate) de la última.
// Vienen ordenadas de la más reciente a la más vieja, así que se puede parar en
// cuanto se pasa la fecha de corte.
async function fetchAllConversations(since) {
  const all = []; const seen = new Set(); let startAfterDate = null;
  for (let p = 0; p < MAX_PAGES; p++) {
    const data  = await ghlGet("/conversations/search", { locationId: GHL_LOCATION_ID, limit: "100", startAfterDate });
    const batch = data.conversations || [];
    const fresh = batch.filter(c => c.id && !seen.has(c.id) && seen.add(c.id));
    all.push(...fresh);
    console.log(`  convs pág ${p + 1}: ${batch.length} → total ${all.length}`);
    const last = batch.at(-1);
    const next = last?.sort?.[0] ?? last?.lastMessageDate;
    if (batch.length < 100 || !next || next === startAfterDate || fresh.length === 0) break;
    if (since && Number(next) < since.getTime()) break;
    startAfterDate = next;
  }
  return all;
}

// ── Descargar mensajes de una conversación (hasta la fecha de corte) ──────────
// GHL pagina mensajes con lastMessageId + nextPage (no con meta), así que antes
// solo se leían los primeros 100: conversaciones largas perdían llamadas y
// mensajes. Los mensajes vienen del más nuevo al más viejo; se para al pasar
// la fecha de corte.
async function fetchMessages(convId, since) {
  const msgs = [];
  let lastMessageId = null;
  for (let p = 0; p < 50; p++) {  // tope de seguridad: 5,000 mensajes
    try {
      const data  = await ghlGet(`/conversations/${convId}/messages`, { limit: "100", lastMessageId });
      const page  = data.messages || {};
      const raw   = Array.isArray(page) ? page : (page.messages || []);
      msgs.push(...raw);
      const oldest = raw.at(-1)?.dateAdded;
      if (!page.nextPage || !page.lastMessageId || page.lastMessageId === lastMessageId) break;
      if (since && oldest && new Date(oldest) < since) break;
      lastMessageId = page.lastMessageId;
    } catch (e) {
      // Silenciar errores de mensajes individuales
      break;
    }
  }
  return msgs;
}

// ── Descargar notas de un contacto (GHL no pagina este endpoint) ──────────────
async function fetchNotes(contactId) {
  try {
    const data = await ghlGet(`/contacts/${contactId}/notes`);
    return data.notes || [];
  } catch (e) {
    return [];
  }
}

// ── Fecha de corte (90 días atrás) — solo aplica a mensajes/llamadas ──────────
const cutoff = new Date(Date.now() - DAYS_BACK * 86_400_000);

// ── Canal de un mensaje (correo / SMS / WhatsApp QR / otros) ──────────────────
// Confirmado contra la API real de GHL: en esta ubicación NO hay SMS de operador
// real — "SMS" y "WhatsApp QR" son dos integraciones de WhatsApp distintas,
// identificadas por su messageType (que a su vez mapea a un conversationProviderId
// fijo). Se respeta esa nomenclatura porque es la que ya usa el equipo.
function classifyChannel(type) {
  if (type === "TYPE_EMAIL")              return "correo";
  if (type === "TYPE_CUSTOM_SMS")         return "sms";
  if (type === "TYPE_CUSTOM_PROVIDER_SMS") return "whatsappQr";
  return "otros";
}

// ── Clasificar un mensaje ─────────────────────────────────────────────────────
// "mensaje enviado" solo cuenta si hay un asesor humano detrás:
//   - excluye logs de sistema (TYPE_ACTIVITY_*: "Opportunity updated", etc.)
//   - excluye mensajes sin userId (automatización pura, sin asesor asociado)
//   - excluye plantillas de bot conocidas (NancyBot, Wayak, etc. — mismo filtro
//     que usa el dashboard en vivo, aunque vengan firmadas con el userId del asesor)
function classifyMessage(msg) {
  const type = String(msg.messageType || msg.type || "").toUpperCase();
  const dir  = String(msg.direction || msg.messageDirection || "").toLowerCase();
  const date = msg.dateAdded ? new Date(msg.dateAdded) : null;

  if (!date || date < cutoff) return null;
  if (isSystemActivityType(type)) return null; // no es comunicación real

  const dayKey    = date.toISOString().split("T")[0]; // "YYYY-MM-DD"
  const isCall    = type === "TYPE_CALL" || type === "CALL" || type === "10";
  const contactId = msg.contactId || null;

  if (isCall) {
    // GHL anida el status real en meta.call.status (o lo repite en msg.status);
    // meta.callStatus (plano) no existe y siempre daba undefined — bug confirmado
    // contra la API real: "completed" / "no-answer" / "busy".
    const callStatus = (msg.status || msg.meta?.call?.status || "").toLowerCase();
    const isOutbound  = dir === "outbound" || dir === "1";
    const answered    = callStatus === "completed" || callStatus === "answered" || callStatus === "connected";
    const missed      = callStatus === "missed"    || callStatus === "no-answer" || callStatus === "busy";
    return { dayKey, kind: "call", isOutbound, answered, missed, contactId };
  } else {
    const isOutbound = dir === "outbound" || dir === "1";
    if (!isOutbound) return null;       // solo contamos mensajes enviados
    if (!msg.userId) return null;       // sin asesor asociado → automatización pura
    if (isAutoMessage(msg.body)) return null; // plantilla de bot conocida
    return { dayKey, kind: "message", channel: classifyChannel(type), contactId };
  }
}

// ── Día vacío por defecto ──────────────────────────────────────────────────────
function emptyDay() {
  return {
    mensajesEnviados:    0,
    mensajesPorCanal:    { correo: 0, sms: 0, whatsappQr: 0, otros: 0 },
    llamadas:            0,
    llamadasSalientes:   0,
    llamadasContestadas: 0,
    llamadasPerdidas:    0,
    notas:               0,
    contactosTocados:    new Set(), // se convierte a array antes de guardar
  };
}

function ensureDay(dailyStats, advisorName, dayKey) {
  if (!dailyStats[advisorName]) dailyStats[advisorName] = {};
  if (!dailyStats[advisorName][dayKey]) dailyStats[advisorName][dayKey] = emptyDay();
  return dailyStats[advisorName][dayKey];
}

// ── Acumular evento de mensaje/llamada en dailyStats ───────────────────────────
function accumulate(dailyStats, advisorName, event) {
  if (!event) return;
  const d = ensureDay(dailyStats, advisorName, event.dayKey);
  if (event.kind === "message") {
    d.mensajesEnviados++;
    d.mensajesPorCanal[event.channel] = (d.mensajesPorCanal[event.channel] || 0) + 1;
    if (event.contactId) d.contactosTocados.add(event.contactId);
  } else if (event.kind === "call") {
    d.llamadas++;
    if (event.isOutbound)  d.llamadasSalientes++;
    if (event.answered)    d.llamadasContestadas++;
    if (event.missed)      d.llamadasPerdidas++;
    if (event.contactId)   d.contactosTocados.add(event.contactId);
  }
}

// ── Acumular una nota en dailyStats ────────────────────────────────────────────
function accumulateNote(dailyStats, advisorName, dateAdded) {
  const date = dateAdded ? new Date(dateAdded) : null;
  if (!date || isNaN(date)) return;
  const dayKey = date.toISOString().split("T")[0];
  const d = ensureDay(dailyStats, advisorName, dayKey);
  d.notas++;
}

// ── Fusionar con lo que ya había en Redis ──────────────────────────────────────
// Un día recalculado en esta corrida REEMPLAZA por completo al día viejo (ya
// viene completo). Los días que esta corrida no tocó se conservan tal cual —
// así el historial se acumula en vez de perderse cada vez que corre el job.
function mergeDailyStats(oldStats, newStats) {
  const merged = JSON.parse(JSON.stringify(oldStats || {}));
  for (const [advisor, days] of Object.entries(newStats)) {
    if (!merged[advisor]) merged[advisor] = {};
    for (const [day, stats] of Object.entries(days)) {
      merged[advisor][day] = stats;
    }
  }
  return merged;
}

// ── Redis ───────────────────────────────────────────────────────────────────
async function redisGet() {
  try {
    const r = await fetch(UPSTASH_REDIS_REST_URL, {
      method:  "POST",
      headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`, "Content-Type": "application/json" },
      body:    JSON.stringify(["GET", DEEP_CACHE_KEY]),
    });
    if (!r.ok) return null;
    const { result } = await r.json();
    if (!result) return null;
    return JSON.parse(result);
  } catch { return null; }
}

async function redisSave(data) {
  const r = await fetch(UPSTASH_REDIS_REST_URL, {
    method:  "POST",
    headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`, "Content-Type": "application/json" },
    body:    JSON.stringify(["SET", DEEP_CACHE_KEY, JSON.stringify(data)]),
  });
  if (!r.ok) throw new Error(`Redis SET failed: ${r.status}`);
  console.log("✅ Guardado en Redis.");
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  console.log(`🚀 sync-deep iniciado (${new Date().toISOString()})`);
  console.log(`   Mensajes/llamadas: ${DAYS_BACK} días hacia atrás desde ${cutoff.toISOString().split("T")[0]}`);
  console.log(`   Notas: historial completo (todos los contactos)`);

  // 1. Usuarios
  console.log("\n📋 Descargando usuarios…");
  const userMap = await fetchUsers();
  console.log(`   ${Object.keys(userMap).length} usuarios`);

  // Sin userMap, TODA la actividad de esta corrida se atribuiría al userId
  // crudo en vez del nombre del asesor, corrompiendo el merge con datos mal
  // etiquetados. Mejor abortar y conservar el historial de la corrida anterior.
  if (Object.keys(userMap).length === 0) {
    console.error("❌ No se pudo obtener el mapa de usuarios después de varios intentos. Abortando sin guardar (se conserva el histórico anterior).");
    process.exit(1);
  }

  const dailyStats = {};

  // 2. Conversaciones → mensajes/llamadas (ventana de 90 días)
  console.log("\n💬 Descargando conversaciones…");
  const allConvs = await fetchAllConversations(cutoff);
  console.log(`   ${allConvs.length} conversaciones totales`);

  const activeConvs = allConvs.filter(c => {
    const d = c.lastMessageDate
      ? (typeof c.lastMessageDate === "number" ? new Date(c.lastMessageDate) : new Date(c.lastMessageDate))
      : (c.dateUpdated ? new Date(c.dateUpdated) : null);
    return d && d >= cutoff;
  });
  console.log(`   ${activeConvs.length} conversaciones activas (últimos ${DAYS_BACK} días)`);

  console.log(`\n📨 Descargando mensajes en batches de ${BATCH_SIZE}…`);
  let processed = 0;
  for (let i = 0; i < activeConvs.length; i += BATCH_SIZE) {
    const batch = activeConvs.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async conv => {
      const agentId   = conv.assignedTo;
      const agentName = agentId ? (userMap[agentId] || agentId) : "(Sin asignar)";
      const messages  = await fetchMessages(conv.id, cutoff);
      messages.forEach(msg => accumulate(dailyStats, agentName, classifyMessage(msg)));
    }));
    processed += batch.length;
    process.stdout.write(`\r   Progreso: ${processed}/${activeConvs.length} (${Math.round(processed / activeConvs.length * 100)}%) `);
    if (i + BATCH_SIZE < activeConvs.length) await sleep(DELAY_MS);
  }
  console.log("\n");

  // 3. Notas de TODOS los contactos (historial completo, no solo los 90 días)
  console.log("📝 Descargando contactos para el recorrido de notas…");
  const allContacts = await fetchAllContacts();
  console.log(`   ${allContacts.length} contactos`);

  console.log(`\n📝 Descargando notas en batches de ${BATCH_SIZE}…`);
  let notesProcessed = 0, notesFound = 0;
  for (let i = 0; i < allContacts.length; i += BATCH_SIZE) {
    const batch = allContacts.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async contact => {
      const agentId   = contact.assignedTo;
      const agentName = agentId ? (userMap[agentId] || agentId) : "(Sin asignar)";
      const notes     = await fetchNotes(contact.id);
      notes.forEach(n => {
        accumulateNote(dailyStats, agentName, n.dateAdded || n.createdAt);
        notesFound++;
      });
    }));
    notesProcessed += batch.length;
    process.stdout.write(`\r   Progreso: ${notesProcessed}/${allContacts.length} (${Math.round(notesProcessed / allContacts.length * 100)}%) — ${notesFound} notas `);
    if (i + BATCH_SIZE < allContacts.length) await sleep(DELAY_MS);
  }
  console.log("\n");

  // 4. Convertir Sets → arrays y fusionar con el historial existente en Redis
  Object.values(dailyStats).forEach(days => {
    Object.values(days).forEach(d => { d.contactosTocados = [...d.contactosTocados]; });
  });

  console.log("🔗 Fusionando con historial existente en Redis…");
  const old   = await redisGet();
  const merged = mergeDailyStats(old?.dailyStats, dailyStats);

  const payload = {
    ok:        true,
    updatedAt: new Date().toISOString(),
    daysBack:  DAYS_BACK,
    convCount: activeConvs.length,
    dailyStats: merged,
  };

  console.log("💾 Guardando en Redis…");
  await redisSave(payload);

  // Resumen
  const advisors  = Object.keys(merged);
  const totalDays = advisors.reduce((s, a) => s + Object.keys(merged[a]).length, 0);
  console.log(`\n✅ sync-deep completado en ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`   ${advisors.length} asesores, ${totalDays} registros diarios acumulados (histórico completo)`);
}

main().catch(e => {
  console.error("❌ Error:", e);
  process.exit(1);
});
