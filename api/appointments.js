// api/appointments.js — GET /api/appointments?from=ISO&to=ISO
// Devuelve todas las citas del rango de fechas, agrupadas por asesor.

export const config = { maxDuration: 30 };

const GHL_BASE    = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

async function ghlGet(path, params = {}) {
  const url = new URL(`${GHL_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const r = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${process.env.GHL_API_KEY}`,
      "Content-Type": "application/json",
      Version: GHL_VERSION,
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(`GHL ${r.status} ${path}: ${JSON.stringify(err)}`);
  }
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const API_KEY     = process.env.GHL_API_KEY;
  const LOCATION_ID = process.env.GHL_LOCATION_ID;
  if (!API_KEY || !LOCATION_ID) return res.status(500).json({ ok: false, error: "Faltan env vars" });

  const { from, to } = req.query || {};
  if (!from || !to) return res.status(400).json({ ok: false, error: "Faltan from/to" });

  try {
    // Obtener usuarios para resolver nombres
    const usersData = await ghlGet("/users/", { locationId: LOCATION_ID }).catch(() => ({ users: [] }));
    const userMap = {};
    (usersData.users || []).forEach(u => {
      if (u.id) userMap[u.id] = u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim() || "(Sin nombre)";
    });

    // Obtener calendarios disponibles
    const calsData = await ghlGet("/calendars/", { locationId: LOCATION_ID }).catch(() => ({ calendars: [] }));
    const calMap = {};
    const calendars = calsData.calendars || calsData.data || [];
    calendars.forEach(c => { if (c.id) calMap[c.id] = c.name || "(Sin nombre)"; });

    // Obtener eventos/citas del rango
    // GHL acepta startTime/endTime como Unix ms o ISO
    const fromMs = new Date(from).getTime();
    const toMs   = new Date(to).getTime();

    const eventsData = await ghlGet("/calendars/events", {
      locationId: LOCATION_ID,
      startTime:  fromMs,
      endTime:    toMs,
    }).catch(() => null);

    // También intentar con appointments
    const apptsData = await ghlGet("/calendars/appointments", {
      locationId: LOCATION_ID,
      startTime:  new Date(from).toISOString(),
      endTime:    new Date(to).toISOString(),
    }).catch(() => null);

    // Unir resultados de ambos endpoints
    const rawEvents = [
      ...(eventsData?.events  || eventsData?.appointments || []),
      ...(apptsData?.events   || apptsData?.appointments  || []),
    ];

    // Deduplicar por id
    const seen = new Set();
    const events = rawEvents.filter(e => {
      if (!e.id || seen.has(e.id)) return false;
      seen.add(e.id); return true;
    });

    // Normalizar cada cita
    const normalized = events.map(e => {
      const assignedId   = e.assignedUserId || e.userId || e.assignedTo;
      const assignedName = assignedId ? (userMap[assignedId] || assignedId) : "(Sin asignar)";
      const calName      = e.calendarId ? (calMap[e.calendarId] || e.calendarId) : null;
      const status       = (e.appointmentStatus || e.status || "confirmed").toLowerCase();

      return {
        id:            e.id,
        title:         e.title || e.name || "(Sin título)",
        contactId:     e.contactId || null,
        contactName:   e.contact?.name || e.contactName || null,
        contactPhone:  e.contact?.phone || null,
        assignedId,
        assignedName,
        calendarId:    e.calendarId || null,
        calendarName:  calName,
        startTime:     e.startTime,
        endTime:       e.endTime,
        status,        // confirmed | cancelled | showed | no-show | new
        notes:         e.notes || null,
      };
    }).sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    // Agrupar por asesor
    const byAdvisor = {};
    normalized.forEach(ev => {
      const name = ev.assignedName;
      if (!byAdvisor[name]) byAdvisor[name] = [];
      byAdvisor[name].push(ev);
    });

    // Estadísticas globales
    const stats = {
      total:      normalized.length,
      confirmed:  normalized.filter(e => e.status === "confirmed" || e.status === "new").length,
      showed:     normalized.filter(e => e.status === "showed").length,
      noShow:     normalized.filter(e => e.status === "no-show" || e.status === "noshow").length,
      cancelled:  normalized.filter(e => e.status === "cancelled").length,
    };

    res.json({
      ok: true,
      from, to,
      stats,
      appointments: normalized,
      byAdvisor,
      calendars: calendars.map(c => ({ id: c.id, name: c.name })),
      _debug: { eventsEndpoint: !!eventsData, apptsEndpoint: !!apptsData, rawCount: rawEvents.length },
    });
  } catch (err) {
    console.error("appointments error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
