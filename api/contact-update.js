// api/contact-update.js — PATCH /api/contact-update
// Actualiza campos personalizados de un contacto en GHL.
// Requiere scope: contacts.write

export const config = { maxDuration: 15 };

const GHL_BASE    = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "PATCH") return res.status(405).json({ ok: false, error: "Método no permitido" });

  const API_KEY = process.env.GHL_API_KEY;
  if (!API_KEY) return res.status(500).json({ ok: false, error: "Falta GHL_API_KEY" });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ ok: false, error: "Body inválido" }); }

  const { contactId, fields } = body || {};
  if (!contactId) return res.status(400).json({ ok: false, error: "Falta contactId" });
  if (!fields || typeof fields !== "object") return res.status(400).json({ ok: false, error: "Falta fields" });

  // fields = { fieldId: value, ... }
  const customFields = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([id, value]) => ({ id, field_value: String(value) }));

  if (customFields.length === 0)
    return res.status(400).json({ ok: false, error: "Sin campos para actualizar" });

  try {
    const r = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        Version: GHL_VERSION,
      },
      body: JSON.stringify({ customFields }),
      signal: AbortSignal.timeout(12_000),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      // 401 puede significar falta el scope contacts.write
      if (r.status === 401 || r.status === 403) {
        return res.status(r.status).json({
          ok: false,
          error: "Sin permiso para editar. Agrega el scope 'contacts.write' en tu API key de GHL.",
          detail: data,
        });
      }
      return res.status(r.status).json({ ok: false, error: `GHL ${r.status}`, detail: data });
    }

    res.json({ ok: true, updated: customFields.length });
  } catch (err) {
    console.error("contact-update error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
