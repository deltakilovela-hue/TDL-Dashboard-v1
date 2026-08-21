// api/task-create.js — POST /api/task-create
// Crea una tarea en un contacto de GHL.
// Formato verificado contra la API real: POST /contacts/{id}/tasks
// { title, dueDate, completed, body?, assignedTo? } -> { task: {...} }

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

  const { contactId, title, body: taskBody, dueDate, assignedTo } = body || {};
  if (!contactId)               return res.status(400).json({ ok: false, error: "Falta contactId" });
  if (!title || !title.trim())  return res.status(400).json({ ok: false, error: "El título de la tarea no puede estar vacío" });

  try {
    const payload = {
      title:     title.trim(),
      // Sin fecha elegida: mañana por defecto, GHL requiere dueDate.
      dueDate:   dueDate ? new Date(dueDate).toISOString() : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      completed: false,
    };
    if (taskBody && taskBody.trim()) payload.body = taskBody.trim();
    if (assignedTo) payload.assignedTo = assignedTo;

    const r = await fetch(`${GHL_BASE}/contacts/${contactId}/tasks`, {
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
          error: "Sin permiso. Agrega el scope 'contacts.write' en tu API key de GHL.",
          detail: data,
        });
      }
      return res.status(r.status).json({ ok: false, error: `GHL ${r.status}`, detail: data });
    }

    res.json({ ok: true, task: data.task || data });
  } catch (err) {
    console.error("task-create error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
