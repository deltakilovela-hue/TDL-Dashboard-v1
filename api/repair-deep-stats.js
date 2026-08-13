// api/repair-deep-stats.js — POST /api/repair-deep-stats
// Herramienta de un solo uso: repara entradas de dailyStats que quedaron
// guardadas bajo el userId crudo de GHL en vez del nombre del asesor
// (bug: fetchUsers falló en una corrida y no tenía reintentos — ya corregido
// en scripts/sync-deep.mjs). Fusiona cada bucket con ID crudo hacia su
// nombre correcto y borra el bucket viejo. Se elimina este archivo después
// de usarlo — no es parte del pipeline normal.

export const config = { maxDuration: 30 };

const GHL_BASE       = "https://services.leadconnectorhq.com";
const GHL_VERSION    = "2021-07-28";
const DEEP_CACHE_KEY = "tdl:ghl:deep:v1";

async function ghlGet(path, params = {}) {
  const url = new URL(`${GHL_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, "Content-Type": "application/json", Version: GHL_VERSION },
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`GHL ${r.status} ${path}`);
  return r.json();
}

async function redisCmd(cmd) {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error(`Redis ${r.status}`);
  const { result } = await r.json();
  return result;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Usa POST" });

  try {
    const raw = await redisCmd(["GET", DEEP_CACHE_KEY]);
    if (!raw) return res.json({ ok: false, error: "Sin datos en Redis" });
    const data = JSON.parse(raw);

    const usersData = await ghlGet("/users/", { locationId: process.env.GHL_LOCATION_ID });
    const userMap = {};
    (usersData.users || []).forEach(u => { if (u.id) userMap[u.id] = u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim() || "(Sin nombre)"; });

    if (Object.keys(userMap).length === 0) return res.json({ ok: false, error: "No se pudo obtener el mapa de usuarios, aborta sin tocar nada" });

    const repaired = [];
    for (const key of Object.keys(data.dailyStats)) {
      const correctName = userMap[key];
      if (!correctName || correctName === key) continue; // no es un userId crudo conocido

      if (!data.dailyStats[correctName]) data.dailyStats[correctName] = {};
      let daysMoved = 0;
      for (const [day, stats] of Object.entries(data.dailyStats[key])) {
        data.dailyStats[correctName][day] = stats; // el bucket con ID crudo es el más fresco, gana
        daysMoved++;
      }
      delete data.dailyStats[key];
      repaired.push({ fromId: key, toName: correctName, daysMoved });
    }

    if (repaired.length > 0) {
      await redisCmd(["SET", DEEP_CACHE_KEY, JSON.stringify(data)]);
    }

    res.json({ ok: true, repaired, totalAdvisorsAfter: Object.keys(data.dailyStats).length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
