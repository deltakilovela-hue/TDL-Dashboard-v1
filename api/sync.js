// Vercel Serverless Function: GET /api/sync
// Descarga contactos y conversaciones de GHL directamente desde el servidor de Vercel.
// Las credenciales van como variables de entorno en el proyecto Vercel (Settings → Environment Variables).

const GHL_HEADERS = () => ({
  Authorization: `Bearer ${process.env.GHL_API_KEY}`,
  "Content-Type": "application/json",
  Version: "2021-07-28",
});

// ── Fetch contacts (paginado) ─────────────────────────────────────────────────
async function fetchContacts(locationId) {
  const all = [];
  let startAfterId = null;

  while (true) {
    const url = new URL("https://services.leadconnectorhq.com/contacts/");
    url.searchParams.set("locationId", locationId);
    url.searchParams.set("limit", "100");
    if (startAfterId) url.searchParams.set("startAfterId", startAfterId);

    const r = await fetch(url.toString(), { headers: GHL_HEADERS() });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(`GHL Contacts API ${r.status}: ${JSON.stringify(err)}`);
    }
    const data = await r.json();
    const batch = data.contacts || [];
    all.push(...batch);

    const nextId = data.meta?.startAfterId;
    if (batch.length < 100 || !nextId || all.length >= (data.meta?.total || Infinity)) break;
    startAfterId = batch[batch.length - 1].id;
  }
  return all;
}

// ── Fetch conversations (paginado, máx 1000) ──────────────────────────────────
async function fetchConversations(locationId) {
  const all = [];
  let startAfterId = null;

  for (let page = 0; page < 10; page++) {
    const url = new URL("https://services.leadconnectorhq.com/conversations/search");
    url.searchParams.set("locationId", locationId);
    url.searchParams.set("limit", "100");
    if (startAfterId) url.searchParams.set("startAfterId", startAfterId);

    const r = await fetch(url.toString(), { headers: GHL_HEADERS() });
    if (!r.ok) break; // No detiene el proceso, solo omite conversaciones
    const data = await r.json();
    const batch = data.conversations || [];
    all.push(...batch);

    if (batch.length < 100) break;
    startAfterId = batch[batch.length - 1].id;
  }
  return all;
}

// ── Normaliza contacto al formato CSV de GHL ──────────────────────────────────
function normalizeContact(c) {
  const custom = {};
  (c.customField || []).forEach((f) => {
    if (f.id) custom[f.id] = f.value;
    if (f.fieldKey) {
      custom[f.fieldKey] = f.value;
      custom[f.fieldKey.replace(/^contact\./, "")] = f.value;
    }
  });

  const fullName = c.contactName || `${c.firstName || ""} ${c.lastName || ""}`.trim();
  const owner    = c.ownerName || c.assignedTo || "";
  const created  = c.dateAdded || c.createdAt || "";
  const pipeline = c.pipelineName || "";
  const stage    = c.pipelineStage || c.pipelineStageName || "";
  const tags     = Array.isArray(c.tags) ? c.tags.join(", ") : (c.tags || "");

  return {
    "Contact Id":   c.id || "",
    "First Name":   c.firstName || "",
    "Last Name":    c.lastName || "",
    "Phone":        c.phone || "",
    "Email":        c.email || "",
    "Business Name": c.companyName || "",
    "Created":      created,
    "Last Activity": c.lastActivityDate || "",
    "Tags":         tags,
    "Source":       c.source || "",
    "Contact Type": c.type || "lead",
    "Assigned To":  owner,
    "Updated":      c.dateUpdated || "",
    "Opportunities": pipeline && stage ? `open ${pipeline} ${stage}` : "",
    "Last Note":    c.lastNote || "",
    // Custom fields con nombre de CSV
    "🌡️ Nivel de interés del prospecto":          custom["nivel_de_interes_del_prospecto"] || custom["nivel_interes"] || "",
    "💸 Presupuesto estimado":                    custom["presupuesto_estimado"] || custom["presupuesto"] || "",
    "🏦 ¿Cuenta con financiamiento o crédito?":   custom["cuenta_con_financiamiento_o_credito"] || custom["financiamiento"] || "",
    "¿Dónde te gustaria invertir?":               custom["donde_te_gustaria_invertir"] || custom["donde_invertir"] || "",
    "¿En que te gustaria invertir?":              custom["en_que_te_gustaria_invertir"] || custom["en_que_invertir"] || "",
    "Comentario de NOTA primer contacto":         custom["comentario_de_nota_primer_contacto"] || "",
    "Historial de NOTAS para clientes":           custom["historial_de_notas_para_clientes"] || "",
    "Turno de asignación":                        custom["turno_de_asignacion"] || "",
    "Propiedad seleccionada":                     custom["propiedad_seleccionada"] || custom["propiedad"] || "",
    "Fecha de visita":                            custom["fecha_de_visita"] || "",
    // Nombres compatibles con el dashboard
    "Nombre del Contacto": fullName,
    "Número de teléfono":  c.phone || "",
    "Usuario asignado":    owner,
    "Created On":          created,
    "Pipeline":            pipeline,
    "Pipeline Name":       pipeline,
    "Stage":               stage,
    "{{contact.suma_de_notas_de_agente}}": custom["suma_de_notas_de_agente"] || "0",
    // Todos los custom fields crudos
    ...custom,
  };
}

// ── Normaliza conversación al formato CSV de mensajes ─────────────────────────
function normalizeConversation(c) {
  return {
    "Nombre del Contacto":          c.contactName || c.fullName || "",
    "Mensajes no leídos":           String(c.unreadCount || 0),
    "Asignado a":                   c.assignedTo || c.ownerName || "",
    "Tipo":                         (c.unreadCount || 0) > 0 ? "Unread" : "Read",
    "Dirección del último mensaje": c.lastMessageDirection || "",
    "Canal del último Mensaje":     c.lastMessageChannel || c.lastMessageType || c.type || "",
    "Creada Activado":              c.dateCreated || c.dateUpdated || "",
    "Contact Id":                   c.contactId || "",
  };
}

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const API_KEY     = process.env.GHL_API_KEY;
  const LOCATION_ID = process.env.GHL_LOCATION_ID;

  if (!API_KEY || !LOCATION_ID) {
    return res.status(500).json({
      ok: false,
      error: "Faltan variables de entorno GHL_API_KEY y GHL_LOCATION_ID. Configúralas en Vercel → Settings → Environment Variables.",
    });
  }

  try {
    // Descarga contactos y conversaciones en paralelo
    const [rawContacts, rawConversations] = await Promise.all([
      fetchContacts(LOCATION_ID),
      fetchConversations(LOCATION_ID).catch(() => []), // conversaciones opcionales
    ]);

    const contacts = rawContacts.map(normalizeContact);
    const mensajes = rawConversations.map(normalizeConversation);

    res.json({
      ok:        true,
      synced:    true,
      contacts,
      mensajes,
      total:     contacts.length,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
