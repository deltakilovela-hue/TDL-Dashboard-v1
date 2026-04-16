// api/_lib.js — Upstash Redis cache helper
// ENV requeridas: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN

const CACHE_KEY = "tdl:ghl:sync:v2";
const CACHE_TTL = 1800; // 30 min

async function redisCmd(cmd) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const r = await fetch(url, {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify(cmd),
    });
    if (!r.ok) return null;
    const { result } = await r.json();
    return result ?? null;
  } catch { return null; }
}

export async function cacheGet() {
  const raw = await redisCmd(["GET", CACHE_KEY]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function cacheSet(data) {
  await redisCmd(["SET", CACHE_KEY, JSON.stringify(data), "EX", CACHE_TTL]);
}

export async function cacheDel() {
  await redisCmd(["DEL", CACHE_KEY]);
}
