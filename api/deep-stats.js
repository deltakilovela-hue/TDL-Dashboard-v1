// api/deep-stats.js — GET /api/deep-stats
// Lee las estadísticas históricas diarias guardadas por el job de GitHub Actions.
// No cachea nada — lee directo de Redis.

export const config = { maxDuration: 10 };

const DEEP_CACHE_KEY = "tdl:ghl:deep:v1";

async function redisGet() {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const r = await fetch(url, {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify(["GET", DEEP_CACHE_KEY]),
    });
    if (!r.ok) return null;
    const { result } = await r.json();
    if (!result) return null;
    return JSON.parse(result);
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const data = await redisGet();

  if (!data) {
    return res.json({
      ok: false,
      error: "Sin datos de sync profundo. El job de GitHub Actions no ha corrido todavía.",
      dailyStats: {},
    });
  }

  res.json(data);
}
