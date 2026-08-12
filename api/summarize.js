// api/summarize.js — POST /api/summarize
// Genera un resumen con IA (OpenAI) de la transcripción de llamada y/o
// notas de un contacto. No toca GHL: recibe el texto ya cargado por el
// frontend (ContactModal ya tiene transcripción + notas via /api/contact-detail).

export const config = { maxDuration: 30 };

const OPENAI_URL   = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_CHARS     = 6000; // límite por bloque de texto para controlar costo/tokens

const SYSTEM_PROMPT = `Eres un asistente que ayuda a asesores de ventas inmobiliarias de Taller del Ladrillo a retomar el contexto de un prospecto rápidamente.

Recibirás la transcripción de una llamada telefónica y/o notas registradas sobre el prospecto. Genera un resumen breve y accionable EN ESPAÑOL con este formato exacto (usa viñetas "-"):

**Interés del prospecto:** qué busca, presupuesto o preferencias mencionadas.
**Puntos clave de la conversación:** lo más relevante que se habló.
**Objeciones o dudas:** si las hubo.
**Próximo paso sugerido:** una acción concreta para el asesor.

Sé conciso (máximo 120 palabras en total). Si falta información para alguna sección, omite esa sección en vez de inventar contenido. No agregues texto antes ni después del resumen.`;

function truncate(text, max = MAX_CHARS) {
  if (!text) return "";
  const s = String(text).trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

  const API_KEY = process.env.OPENAI_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ ok: false, error: "Falta OPENAI_API_KEY en las variables de entorno de Vercel." });
  }

  const { contactName, transcript, notes } = req.body || {};

  const transcriptText = truncate(transcript);
  const notesText      = truncate(notes);

  if (!transcriptText && !notesText) {
    return res.status(400).json({ ok: false, error: "Sin transcripción ni notas para resumir." });
  }

  const parts = [`Prospecto: ${contactName || "(sin nombre)"}`];
  if (transcriptText) parts.push(`--- Transcripción de llamada ---\n${transcriptText}`);
  if (notesText)      parts.push(`--- Notas registradas ---\n${notesText}`);
  const userContent = parts.join("\n\n");

  try {
    const r = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        temperature: 0.3,
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err?.error?.message || `OpenAI ${r.status}`);
    }

    const data    = await r.json();
    const summary = data?.choices?.[0]?.message?.content?.trim();
    if (!summary) throw new Error("OpenAI no devolvió contenido.");

    res.json({ ok: true, summary, model: OPENAI_MODEL, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("summarize error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
