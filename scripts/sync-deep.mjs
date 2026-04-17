#!/usr/bin/env node
/**
 * scripts/sync-deep.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Ejecutado por GitHub Actions cada noche.
 * Sin límite de tiempo de Vercel — puede tardar 5-10 minutos.
 *
 * Qué hace:
 *   1. Descarga todas las conversaciones de GHL (paginadas)
 *   2. Por cada conversación activa en los últimos 90 días, descarga
 *      todos sus mensajes y clasifica: mensaje enviado / llamada / contestada
 *   3. Acumula estadísticas diarias por asesor: { "YYYY-MM-DD": { ... } }
 *   4. Guarda el resultado en Upstash Redis (clave tdl:ghl:deep:v1)
 *
 * Variables de entorno requeridas (GitHub Secrets):
 *   GHL_API_KEY, GHL_LOCATION_ID,
 *   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 */

const GHL_BASE       = "https://services.leadconnectorhq.com";
const GHL_VERSION    = "2021-07-28";
const DEEP_CACHE_KEY = "tdl:ghl:deep:v1";
const DAYS_BACK      = 90;   // mirar 90 días hacia atrás
const BATCH_SIZE     = 10;   // conversaciones en paralelo
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
async function fetchUsers() {
  try {
    const data = await ghlGet("/users/", { locationId: GHL_LOCATION_ID });
    const map  = {};
    (data.users || []).forEach(u => {
      if (u.id) map[u.id] = u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim() || "(Sin nombre)";
    });
    return map;
  } catch (e) { console.warn("fetchUsers:", e.message); return {}; }
}

// ── Descargar todas las conversaciones ────────────────────────────────────────
async function fetchAllConversations() {
  const all  = [];
  let cursor = null;
  for (let p = 0; p < 30; p++) {
    const data  = await ghlGet("/conversations/search", { locationId: GHL_LOCATION_ID, limit: "100", ...cursorParams(cursor) });
    const batch = data.conversations || [];
    all.push(...batch);
    console.log(`  convs pág ${p + 1}: ${batch.length} → total ${all.length}`);
    const next = extractCursor(data, batch);
    if (batch.length < 100 || !next || sameCursor(cursor, next)) break;
    cursor = next;
  }
  return all;
}

// ── Descargar mensajes de una conversación ────────────────────────────────────
async function fetchMessages(convId) {
  const msgs = [];
  let cursor = null;
  for (let p = 0; p < 5; p++) {  // máx 5 páginas = 500 mensajes
    try {
      const data  = await ghlGet(`/conversations/${convId}/messages`, { limit: "100", ...cursorParams(cursor) });
      // GHL devuelve mensajes en data.messages.messages o data.messages
      const raw   = Array.isArray(data.messages) ? data.messages
                  : Array.isArray(data.messages?.messages) ? data.messages.messages : [];
      msgs.push(...raw);
      const next = extractCursor(data.messages || data, raw);
      if (raw.length < 100 || !next || sameCursor(cursor, next)) break;
      cursor = next;
    } catch (e) {
      // Silenciar errores de mensajes individuales
      break;
    }
  }
  return msgs;
}

// ── Fecha de corte (90 días atrás) ────────────────────────────────────────────
const cutoff = new Date(Date.now() - DAYS_BACK * 86_400_000);

// ── Clasificar un mensaje ─────────────────────────────────────────────────────
function classifyMessage(msg) {
  const type = String(msg.messageType || msg.type || "").toUpperCase();
  const dir  = String(msg.direction || msg.messageDirection || "").toLowerCase();
  const date = msg.dateAdded ? new Date(msg.dateAdded) : null;

  if (!date || date < cutoff) return null;

  const dayKey = date.toISOString().split("T")[0]; // "YYYY-MM-DD"
  const isCall = type === "TYPE_CALL" || type === "CALL" || type === "10";

  if (isCall) {
    const callStatus = (msg.meta?.callStatus || "").toLowerCase();
    const isOutbound = dir === "outbound" || dir === "1";
    const answered   = callStatus === "completed" || callStatus === "answered" || callStatus === "connected";
    const missed     = callStatus === "missed"    || callStatus === "no-answer" || callStatus === "busy";
    return { dayKey, kind: "call", isOutbound, answered, missed };
  } else {
    const isOutbound = dir === "outbound" || dir === "1";
    if (!isOutbound) return null; // solo contamos mensajes enviados
    return { dayKey, kind: "message" };
  }
}

// ── Acumular en dailyStats ────────────────────────────────────────────────────
function accumulate(dailyStats, advisorName, event) {
  if (!event) return;
  if (!dailyStats[advisorName])            dailyStats[advisorName] = {};
  if (!dailyStats[advisorName][event.dayKey]) {
    dailyStats[advisorName][event.dayKey] = {
      mensajesEnviados:    0,
      llamadas:            0,
      llamadasSalientes:   0,
      llamadasContestadas: 0,
      llamadasPerdidas:    0,
    };
  }
  const d = dailyStats[advisorName][event.dayKey];
  if (event.kind === "message") {
    d.mensajesEnviados++;
  } else if (event.kind === "call") {
    d.llamadas++;
    if (event.isOutbound)  d.llamadasSalientes++;
    if (event.answered)    d.llamadasContestadas++;
    if (event.missed)      d.llamadasPerdidas++;
  }
}

// ── Guardar en Redis ──────────────────────────────────────────────────────────
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
  console.log(`   Mirando ${DAYS_BACK} días hacia atrás desde ${cutoff.toISOString().split("T")[0]}`);

  // 1. Usuarios
  console.log("\n📋 Descargando usuarios…");
  const userMap = await fetchUsers();
  console.log(`   ${Object.keys(userMap).length} usuarios`);

  // 2. Conversaciones
  console.log("\n💬 Descargando conversaciones…");
  const allConvs = await fetchAllConversations();
  console.log(`   ${allConvs.length} conversaciones totales`);

  // Filtrar solo las activas en los últimos 90 días
  const activeConvs = allConvs.filter(c => {
    const d = c.lastMessageDate
      ? (typeof c.lastMessageDate === "number" ? new Date(c.lastMessageDate) : new Date(c.lastMessageDate))
      : (c.dateUpdated ? new Date(c.dateUpdated) : null);
    return d && d >= cutoff;
  });
  console.log(`   ${activeConvs.length} conversaciones activas (últimos ${DAYS_BACK} días)`);

  // 3. Mensajes por conversación (en batches)
  console.log(`\n📨 Descargando mensajes en batches de ${BATCH_SIZE}…`);
  const dailyStats = {};
  let processed = 0;

  for (let i = 0; i < activeConvs.length; i += BATCH_SIZE) {
    const batch = activeConvs.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async conv => {
      const agentId    = conv.assignedTo;
      const agentName  = agentId ? (userMap[agentId] || agentId) : "(Sin asignar)";

      const messages = await fetchMessages(conv.id);
      messages.forEach(msg => {
        const event = classifyMessage(msg);
        accumulate(dailyStats, agentName, event);
      });
    }));

    processed += batch.length;
    const pct = Math.round(processed / activeConvs.length * 100);
    process.stdout.write(`\r   Progreso: ${processed}/${activeConvs.length} (${pct}%) `);

    if (i + BATCH_SIZE < activeConvs.length) {
      await sleep(DELAY_MS);
    }
  }
  console.log("\n");

  // 4. Guardar en Redis
  const payload = {
    ok:          true,
    updatedAt:   new Date().toISOString(),
    daysBack:    DAYS_BACK,
    convCount:   activeConvs.length,
    dailyStats,
  };

  console.log("💾 Guardando en Redis…");
  await redisSave(payload);

  // Resumen
  const advisors = Object.keys(dailyStats);
  const totalDays = advisors.reduce((s, a) => s + Object.keys(dailyStats[a]).length, 0);
  console.log(`\n✅ sync-deep completado en ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`   ${advisors.length} asesores, ${totalDays} registros diarios`);
}

main().catch(e => {
  console.error("❌ Error:", e);
  process.exit(1);
});
