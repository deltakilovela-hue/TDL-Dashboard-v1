// api/advisor-notes-detail.js — POST /api/advisor-notes-detail
// Devuelve las notas reales (texto + contacto) de un conjunto de contactos,
// filtradas a un rango de fechas. Se pide bajo demanda (no es parte del job
// nocturno, que solo guarda conteos) porque el texto completo de las notas
// de TODOS los contactos de un asesor por tiempo indefinido sería demasiado
// para guardar en caché — esto se calcula al vuelo cuando el usuario lo pide.

export const config = { maxDuration: 60 };

const GHL_BASE    = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const BATCH_SIZE  = 15;

async function ghlGet(path) {
  const r = await fetch(`${GHL_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.GHL_API_KEY}`,
      "Content-Type": "application/json",
      Version: GHL_VERSION,
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`GHL ${r.status} ${path}`);
  return r.json();
}

async function fetchNotes(contactId) {
  try {
    const data = await ghlGet(`/contacts/${contactId}/notes`);
    return data.notes || [];
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Usa POST" });

  const API_KEY = process.env.GHL_API_KEY;
  if (!API_KEY) return res.status(500).json({ ok: false, error: "Falta GHL_API_KEY" });

  const { contactIds, from, to } = req.body || {};
  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    return res.status(400).json({ ok: false, error: "Falta contactIds" });
  }
  const fromDate = from ? new Date(from) : null;
  const toDate   = to   ? new Date(to)   : null;

  try {
    const byContact = {};
    let totalNotes = 0;

    for (let i = 0; i < contactIds.length; i += BATCH_SIZE) {
      const batch = contactIds.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async contactId => {
        const notes = await fetchNotes(contactId);
        const inRange = notes.filter(n => {
          const d = n.dateAdded || n.createdAt;
          if (!d) return false;
          const date = new Date(d);
          if (isNaN(date)) return false;
          if (fromDate && date < fromDate) return false;
          if (toDate   && date > toDate)   return false;
          return true;
        });
        if (inRange.length > 0) {
          byContact[contactId] = inRange
            .map(n => ({ id: n.id, body: n.body || n.text || "", dateAdded: n.dateAdded || n.createdAt }))
            .sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
          totalNotes += inRange.length;
        }
      }));
    }

    res.json({ ok: true, byContact, contactsWithNotes: Object.keys(byContact).length, totalNotes });
  } catch (err) {
    console.error("advisor-notes-detail error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
