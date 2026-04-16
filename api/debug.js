// api/debug.js — Diagnóstico de la conexión GHL (no cachea, solo GET)
// Visitar: /api/debug  o  /api/debug?full=true

export const config = { maxDuration: 30 };

const GHL_BASE    = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

async function ghlGet(path, params = {}, apiKey) {
  const url = new URL(`${GHL_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const r = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Version: GHL_VERSION,
    },
    signal: AbortSignal.timeout(12000),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, body };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const API_KEY     = process.env.GHL_API_KEY;
  const LOCATION_ID = process.env.GHL_LOCATION_ID;

  if (!API_KEY || !LOCATION_ID) {
    return res.json({ error: "Faltan GHL_API_KEY y GHL_LOCATION_ID" });
  }

  const full = req.query?.full === "true";

  // ── Test 1: Contacts page 1 ─────────────────────────────────────────────────
  const c1 = await ghlGet("/contacts/", { locationId: LOCATION_ID, limit: "100" }, API_KEY);
  const contacts1 = c1.body?.contacts || [];
  const meta1     = c1.body?.meta || {};

  // ── Test 2: Contacts page 2 (si hay más) ───────────────────────────────────
  let contacts2 = null;
  let meta2     = null;
  if (c1.ok && (meta1.startAfterId || contacts1.length === 100)) {
    const cursor = meta1.startAfterId || contacts1[contacts1.length - 1]?.id;
    if (cursor) {
      const c2 = await ghlGet("/contacts/", {
        locationId: LOCATION_ID, limit: "100", startAfterId: cursor,
      }, API_KEY);
      contacts2 = c2.body?.contacts?.length ?? "error";
      meta2     = c2.body?.meta || null;
    }
  }

  // ── Test 3: Opportunities page 1 ───────────────────────────────────────────
  const o1  = await ghlGet("/opportunities/search", { location_id: LOCATION_ID, limit: "100" }, API_KEY);
  const opps1 = o1.body?.opportunities || [];
  const metaO = o1.body?.meta || {};

  // ── Test 4: Location info ───────────────────────────────────────────────────
  const loc = await ghlGet(`/locations/${LOCATION_ID}`, {}, API_KEY);

  const result = {
    env: {
      GHL_API_KEY:     API_KEY ? `...${API_KEY.slice(-6)}` : "MISSING",
      GHL_LOCATION_ID: LOCATION_ID || "MISSING",
    },
    location: {
      status:    loc.status,
      name:      loc.body?.location?.name || loc.body?.name || "(no disponible)",
      id:        loc.body?.location?.id   || loc.body?.id,
    },
    contacts: {
      httpStatus:    c1.status,
      page1Count:    contacts1.length,
      meta:          meta1,
      page2Count:    contacts2,
      meta2,
      sample: full ? contacts1.slice(0, 3).map(c => ({
        id: c.id, firstName: c.firstName, lastName: c.lastName,
        dateAdded: c.dateAdded, assignedTo: c.assignedTo,
      })) : contacts1.slice(0, 3).map(c => ({ id: c.id, firstName: c.firstName })),
    },
    opportunities: {
      httpStatus:  o1.status,
      page1Count:  opps1.length,
      meta:        metaO,
      sample: opps1.slice(0, 3).map(o => ({
        id: o.id, contactId: o.contactId || o.contact?.id,
        pipeline: o.pipeline?.name, stage: o.pipelineStage?.name, status: o.status,
      })),
    },
  };

  res.json(result);
}
