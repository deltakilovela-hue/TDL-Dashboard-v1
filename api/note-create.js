// api/note-create.js — POST /api/note-create
// Crea una nota en un contacto de GHL.
// Requiere scope: contacts/notes.write

export const config = { maxDuration: 15 };

const GHL_BASE    = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

  const API_KEY = process.env.GHL_API_KEY;
  if (!API_KEY) return res.status(500).json({ ok: false, error: "Falta GHL_API_KEY" });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ ok: false, error: "Body inválido" }); }

  const { contactId, body: noteBody, userId } = body || {};
  if (!contactId)                        return res.status(400).json({ ok: false, error: "Falta contactId" });
  if (!noteBody || !noteBody.trim())     return res.status(400).json({ ok: false, error: "El cuerpo de la nota no puede estar vacío" });

  try {
    const payload = { body: noteBody.trim() };
    if (userId) payload.userId = userId;

    const r = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        Version: GHL_VERSION,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) {
        return res.status(r.status).json({
          ok: false,
          error: "Sin permiso. Agrega el scope 'contacts/notes.write' en tu API key de GHL.",
          detail: data,
        });
      }
      return res.status(r.status).json({ ok: false, error: `GHL ${r.status}`, detail: data });
    }

    res.json({ ok: true, note: data.note || data });
  } catch (err) {
    console.error("note-create error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
