// api/contact-detail.js — GET /api/contact-detail?contactId=XXX
// Devuelve: notas, conversación y mensajes de un contacto específico.

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

  const { contactId } = req.query || {};
  if (!contactId) return res.status(400).json({ ok: false, error: "Falta contactId" });

  const API_KEY     = process.env.GHL_API_KEY;
  const LOCATION_ID = process.env.GHL_LOCATION_ID;
  if (!API_KEY || !LOCATION_ID) return res.status(500).json({ ok: false, error: "Faltan env vars" });

  try {
    // Fetch en paralelo: datos del contacto + notas + conversaciones
    const [contactRes, notesRes, convsRes] = await Promise.allSettled([
      ghlGet(`/contacts/${contactId}`),
      ghlGet(`/contacts/${contactId}/notes`),
      ghlGet("/conversations/search", { contactId, locationId: LOCATION_ID, limit: "10" }),
    ]);

    // Campos personalizados raw (para debug y enriquecer el modal)
    const rawContact = contactRes.status === "fulfilled" ? (contactRes.value.contact || contactRes.value || {}) : {};
    const rawCustomFields = (rawContact.customField || rawContact.customFields || []).map(f => ({
      id:       f.id       || null,
      fieldKey: f.fieldKey || null,
      value:    f.value    ?? null,
    }));

    const notes = notesRes.status === "fulfilled"
      ? (notesRes.value.notes || []).map(n => ({
          id:          n.id,
          body:        n.body || n.text || "",
          dateAdded:   n.dateAdded || n.createdAt || null,
          createdBy:   n.userId || null,
        }))
      : [];

    const conversations = convsRes.status === "fulfilled"
      ? (convsRes.value.conversations || [])
      : [];

    // Tomar la conversación más reciente y bajar sus mensajes
    const mainConv = conversations[0] || null;
    let messages   = [];

    if (mainConv?.id) {
      try {
        const msgRes = await ghlGet(`/conversations/${mainConv.id}/messages`, { limit: "50" });
        const raw    = Array.isArray(msgRes.messages)
          ? msgRes.messages
          : Array.isArray(msgRes.messages?.messages)
          ? msgRes.messages.messages
          : [];

        messages = raw.map(m => {
          const type = String(m.messageType || m.type || "").toUpperCase();
          const dir  = String(m.direction || m.messageDirection || "").toLowerCase();
          const isCall = type === "TYPE_CALL" || type === "CALL" || type === "10";
          const isOut  = dir === "outbound" || dir === "1";

          return {
            id:          m.id,
            type:        type,
            isCall,
            isOutbound:  isOut,
            dateAdded:   m.dateAdded,
            body:        m.body ? m.body.substring(0, 300) : null,
            status:      m.status,
            // Llamadas
            callStatus:  m.meta?.callStatus || null,
            callDuration:m.meta?.duration   || null,
            attachments: (m.attachments || []).length,
          };
        }).sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded)); // más reciente primero
      } catch (e) {
        console.warn("fetchMessages:", e.message);
      }
    }

    // Estadísticas rápidas de los mensajes
    const sentMessages   = messages.filter(m => !m.isCall && m.isOutbound).length;
    const recvMessages   = messages.filter(m => !m.isCall && !m.isOutbound).length;
    const totalCalls     = messages.filter(m => m.isCall).length;
    const answeredCalls  = messages.filter(m => m.isCall && (m.callStatus === "completed" || m.callStatus === "answered" || m.callStatus === "connected")).length;
    const missedCalls    = messages.filter(m => m.isCall && (m.callStatus === "missed" || m.callStatus === "no-answer")).length;

    res.json({
      ok: true,
      contactId,
      stats: {
        totalMessages:  messages.length,
        sentMessages,
        recvMessages,
        totalCalls,
        answeredCalls,
        missedCalls,
        totalNotes: notes.length,
      },
      notes,
      messages,
      rawCustomFields,   // campos GHL brutos — útil para debug y verificar IDs
      conversation: mainConv ? {
        id:           mainConv.id,
        unreadCount:  mainConv.unreadCount || 0,
        type:         mainConv.type,
        dateCreated:  mainConv.dateCreated || mainConv.dateAdded,
        lastMessage:  mainConv.lastMessageBody,
        lastMessageDate: mainConv.lastMessageDate,
      } : null,
    });
  } catch (err) {
    console.error("contact-detail error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
