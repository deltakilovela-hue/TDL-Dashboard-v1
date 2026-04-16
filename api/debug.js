// api/debug.js — Diagnóstico de la conexión GHL
// /api/debug          → info general
// /api/debug?convs=true → muestra campos raw de las primeras 5 conversaciones

export const config = { maxDuration: 30 };

const GHL_BASE    = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

async function ghlGet(path, params = {}, apiKey) {
  const url = new URL(`${GHL_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Version: GHL_VERSION },
    signal: AbortSignal.timeout(12000),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, body };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const API_KEY     = process.env.GHL_API_KEY;
  const LOCATION_ID = process.env.GHL_LOCATION_ID;
  if (!API_KEY || !LOCATION_ID) return res.json({ error: "Faltan env vars" });

  // Modo conversaciones: muestra los campos raw reales de GHL
  if (req.query?.convs === "true") {
    const r = await ghlGet("/conversations/search", { locationId: LOCATION_ID, limit: "10" }, API_KEY);
    const convs = r.body?.conversations || [];
    return res.json({
      total: convs.length,
      // Mostrar TODOS los campos del primer objeto para saber qué existe
      firstRaw: convs[0] || null,
      // Muestra los campos más importantes de los primeros 10
      sample: convs.slice(0, 10).map(c => ({
        id: c.id,
        type: c.type,
        lastMessageType:       c.lastMessageType,
        lastMessageDate:       c.lastMessageDate,
        lastMessageDateMs:     typeof c.lastMessageDate === "number" ? new Date(c.lastMessageDate).toISOString() : null,
        lastMessageDirection:  c.lastMessageDirection,
        lastMessageChannel:    c.lastMessageChannel,
        unreadCount:           c.unreadCount,
        assignedTo:            c.assignedTo,
        dateUpdated:           c.dateUpdated,
        contactId:             c.contactId,
      })),
    });
  }

  // Modo normal
  const [c1, o1, loc] = await Promise.all([
    ghlGet("/contacts/",           { locationId: LOCATION_ID, limit: "5" }, API_KEY),
    ghlGet("/opportunities/search",{ location_id: LOCATION_ID, limit: "5" }, API_KEY),
    ghlGet(`/locations/${LOCATION_ID}`, {}, API_KEY),
  ]);

  res.json({
    location:  { status: loc.status, name: loc.body?.location?.name || loc.body?.name },
    contacts:  { status: c1.status, total: c1.body?.meta?.total, page1: c1.body?.contacts?.length },
    opps:      { status: o1.status, total: o1.body?.meta?.total, page1: o1.body?.opportunities?.length },
  });
}
