// api/audit.js — GET /api/audit
// Barrido completo de todos los datos que GHL devuelve.
// Diseñado para explorar qué información está disponible.

export const config = { maxDuration: 60 };

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
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    return { _error: `${r.status}`, _detail: err };
  }
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  const API_KEY     = process.env.GHL_API_KEY;
  const LOCATION_ID = process.env.GHL_LOCATION_ID;
  if (!API_KEY || !LOCATION_ID)
    return res.status(500).json({ ok: false, error: "Faltan env vars GHL." });

  try {
    // ── Fetch en paralelo ──────────────────────────────────────────────────────
    const [
      locData,
      usersData,
      cfData,
      contactsData,
      oppsData,
      convsData,
      calendarsData,
      tagsData,
    ] = await Promise.allSettled([
      ghlGet(`/locations/${LOCATION_ID}`),
      ghlGet("/users/", { locationId: LOCATION_ID }),
      ghlGet(`/locations/${LOCATION_ID}/customFields`),
      ghlGet("/contacts/", { locationId: LOCATION_ID, limit: "10" }),
      ghlGet("/opportunities/search", { location_id: LOCATION_ID, limit: "10" }),
      ghlGet("/conversations/search", { locationId: LOCATION_ID, limit: "10" }),
      ghlGet("/calendars/", { locationId: LOCATION_ID }).catch(() => null),
      ghlGet(`/locations/${LOCATION_ID}/tags`).catch(() => null),
    ]);

    const safe = (p) => p.status === "fulfilled" ? p.value : { _error: p.reason?.message };

    const rawLoc      = safe(locData);
    const rawUsers    = safe(usersData);
    const rawCF       = safe(cfData);
    const rawContacts = safe(contactsData);
    const rawOpps     = safe(oppsData);
    const rawConvs    = safe(convsData);
    const rawCals     = safe(calendarsData);
    const rawTags     = safe(tagsData);

    // ── Buscar mensajes de la primera conversación ─────────────────────────────
    const firstConvId = (rawConvs.conversations || [])[0]?.id;
    const rawMessages = firstConvId
      ? await ghlGet(`/conversations/${firstConvId}/messages`, { limit: "20" })
      : null;

    // ── Pipelines únicos de oportunidades ────────────────────────────────────
    const pipelines = {};
    for (const opp of (rawOpps.opportunities || [])) {
      const pName = opp.pipeline?.name || "Sin pipeline";
      const pId   = opp.pipeline?.id   || "?";
      if (!pipelines[pId]) pipelines[pId] = { id: pId, name: pName, stages: {} };
      const sName = opp.pipelineStage?.name || "Sin etapa";
      const sId   = opp.pipelineStage?.id   || "?";
      pipelines[pId].stages[sId] = sName;
    }

    // También intenta el endpoint de pipelines directamente
    const rawPipelines = await ghlGet(`/opportunities/pipelines`, { locationId: LOCATION_ID })
      .catch(() => null);

    // ── Calendarios: si hay datos los incluimos ────────────────────────────────
    const rawAppointments = firstConvId
      ? await ghlGet("/calendars/appointments", {
          locationId: LOCATION_ID,
          startTime: new Date(Date.now() - 30 * 86400_000).toISOString(),
          endTime:   new Date().toISOString(),
        }).catch(() => null)
      : null;

    // ── Resumen de campos por entidad ─────────────────────────────────────────
    const firstContact = (rawContacts.contacts || [])[0] || null;
    const firstOpp     = (rawOpps.opportunities || [])[0] || null;
    const firstConv    = (rawConvs.conversations || [])[0] || null;
    const firstUser    = (rawUsers.users || [])[0] || null;
    const firstMsg     = (() => {
      const msgs = rawMessages?.messages;
      if (Array.isArray(msgs)) return msgs[0] || null;
      if (Array.isArray(msgs?.messages)) return msgs.messages[0] || null;
      return null;
    })();

    // Estadísticas de custom fields — GHL puede devolver la lista en distintas claves
    const cfArray = rawCF.customFields || rawCF.fields || rawCF.data || rawCF.customfield || [];
    const customFieldsFlat = (Array.isArray(cfArray) ? cfArray : []).map(f => ({
      id:       f.id,
      name:     f.name,
      fieldKey: f.fieldKey,
      dataType: f.dataType,
      model:    f.model,
    }));

    // Distribución de tipos de conversaciones
    const convTypes = {};
    for (const c of (rawConvs.conversations || [])) {
      const t = c.type || "unknown";
      convTypes[t] = (convTypes[t] || 0) + 1;
    }

    // Tags únicos de los contactos de muestra
    const uniqueTags = [...new Set(
      (rawContacts.contacts || []).flatMap(c => c.tags || [])
    )];

    res.json({
      ok: true,
      fetchedAt: new Date().toISOString(),

      // ── 1. LOCATION ──────────────────────────────────────────────────────────
      location: {
        raw:     rawLoc.location || rawLoc,
        summary: {
          id:      rawLoc.location?.id   || LOCATION_ID,
          name:    rawLoc.location?.name || rawLoc.name,
          email:   rawLoc.location?.email,
          phone:   rawLoc.location?.phone,
          address: rawLoc.location?.address,
          country: rawLoc.location?.country,
          timezone:rawLoc.location?.timezone,
        },
      },

      // ── 2. USUARIOS ──────────────────────────────────────────────────────────
      users: {
        total: (rawUsers.users || []).length,
        fields: firstUser ? Object.keys(firstUser) : [],
        sample: (rawUsers.users || []).map(u => ({
          id:        u.id,
          name:      u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim(),
          email:     u.email,
          phone:     u.phone,
          role:      u.role,
          type:      u.type,
          roles:     u.roles,
          permissions: u.permissions ? Object.keys(u.permissions) : [],
        })),
        firstRaw: firstUser,
      },

      // ── 3. CAMPOS PERSONALIZADOS ─────────────────────────────────────────────
      customFields: {
        total:    customFieldsFlat.length,
        fields:   customFieldsFlat,
        firstRaw: customFieldsFlat[0] || null,
        // Raw completo para diagnóstico — muestra todas las claves que devolvió GHL
        _rawKeys:  Object.keys(rawCF),
        _rawFull:  rawCF,
      },

      // ── 4. CONTACTOS ─────────────────────────────────────────────────────────
      contacts: {
        totalInGHL: rawContacts.meta?.total || rawContacts.total || "?",
        page1Count: (rawContacts.contacts || []).length,
        fields:     firstContact ? Object.keys(firstContact) : [],
        fieldsSample: firstContact,
        customFieldsOnContact: firstContact
          ? (firstContact.customField || []).map(f => ({
              id:       f.id,
              fieldKey: f.fieldKey,
              value:    f.value,
            }))
          : [],
        sample: (rawContacts.contacts || []).slice(0, 5).map(c => ({
          id:           c.id,
          name:         `${c.firstName || ""} ${c.lastName || ""}`.trim(),
          phone:        c.phone,
          email:        c.email,
          source:       c.source,
          status:       c.status,
          type:         c.type,
          dateAdded:    c.dateAdded,
          dateUpdated:  c.dateUpdated,
          assignedTo:   c.assignedTo,
          tags:         c.tags,
          dnd:          c.dnd,
          unreadCount:  c.unreadCount,
          lastActivity: c.lastActivityDate,
          _customFieldCount: (c.customField || []).length,
        })),
      },

      // ── 5. OPORTUNIDADES ─────────────────────────────────────────────────────
      opportunities: {
        totalInGHL: rawOpps.meta?.total || "?",
        page1Count: (rawOpps.opportunities || []).length,
        fields:     firstOpp ? Object.keys(firstOpp) : [],
        fieldsSample: firstOpp,
        pipelines:  Object.values(pipelines).map(p => ({
          ...p,
          stages: Object.entries(p.stages).map(([id, name]) => ({ id, name })),
        })),
        sample: (rawOpps.opportunities || []).slice(0, 5).map(o => ({
          id:            o.id,
          contactId:     o.contactId,
          name:          o.name,
          status:        o.status,
          pipeline:      o.pipeline?.name,
          pipelineId:    o.pipeline?.id,
          stage:         o.pipelineStage?.name,
          stageId:       o.pipelineStage?.id,
          monetaryValue: o.monetaryValue,
          assignedTo:    o.assignedTo,
          contact:       o.contact ? { name: o.contact.name, email: o.contact.email } : null,
          dateAdded:     o.dateAdded,
          dateUpdated:   o.dateUpdated,
          closeDateStr:  o.closeDateStr,
        })),
      },

      // ── 6. PIPELINES (endpoint directo) ──────────────────────────────────────
      pipelines: {
        raw:   rawPipelines,
        total: (rawPipelines?.pipelines || []).length,
        list:  (rawPipelines?.pipelines || []).map(p => ({
          id:     p.id,
          name:   p.name,
          stages: (p.stages || []).map(s => ({ id: s.id, name: s.name, position: s.position })),
        })),
      },

      // ── 7. CONVERSACIONES ─────────────────────────────────────────────────────
      conversations: {
        totalInGHL: rawConvs.meta?.total || "?",
        page1Count: (rawConvs.conversations || []).length,
        typeDistribution: convTypes,
        fields:     firstConv ? Object.keys(firstConv) : [],
        fieldsSample: firstConv,
        sample: (rawConvs.conversations || []).slice(0, 10).map(c => ({
          id:                   c.id,
          contactId:            c.contactId,
          contactName:          c.fullName || c.contactName,
          type:                 c.type,
          lastMessageType:      c.lastMessageType,
          lastMessageDirection: c.lastMessageDirection,
          lastMessageDate:      c.lastMessageDate,
          lastMessageDateISO:   typeof c.lastMessageDate === "number"
            ? new Date(c.lastMessageDate).toISOString() : c.lastMessageDate,
          unreadCount:          c.unreadCount,
          assignedTo:           c.assignedTo,
          starred:              c.starred,
          inbox:                c.inbox,
          channel:              c.channel,
          lastMessageChannel:   c.lastMessageChannel,
          lastMessageBody:      c.lastMessageBody,
          dateCreated:          c.dateCreated,
          dateUpdated:          c.dateUpdated,
        })),
      },

      // ── 8. MENSAJES (muestra de la primera conversación) ──────────────────────
      messages: {
        fromConversationId: firstConvId || null,
        total: (() => {
          const msgs = rawMessages?.messages;
          if (Array.isArray(msgs)) return msgs.length;
          if (Array.isArray(msgs?.messages)) return msgs.messages.length;
          return 0;
        })(),
        fields:     firstMsg ? Object.keys(firstMsg) : [],
        fieldsSample: firstMsg,
        sample: (() => {
          const msgs = rawMessages?.messages;
          const arr = Array.isArray(msgs) ? msgs : Array.isArray(msgs?.messages) ? msgs.messages : [];
          return arr.slice(0, 10).map(m => ({
            id:            m.id,
            type:          m.type,
            messageType:   m.messageType,
            direction:     m.direction,
            messageDirection: m.messageDirection,
            dateAdded:     m.dateAdded,
            body:          m.body ? m.body.substring(0, 100) : null,
            userId:        m.userId,
            conversationId: m.conversationId,
            contactId:     m.contactId,
            status:        m.status,
            meta:          m.meta,
            attachments:   m.attachments?.length || 0,
          }));
        })(),
      },

      // ── 9. CALENDARIOS Y CITAS ────────────────────────────────────────────────
      calendars: {
        raw:   rawCals,
        total: (rawCals?.calendars || rawCals?.data || []).length,
        list:  (rawCals?.calendars || rawCals?.data || []).map(cal => ({
          id:          cal.id,
          name:        cal.name,
          description: cal.description,
          teamMembers: cal.teamMembers,
        })),
        appointments: {
          raw:    rawAppointments,
          total:  (rawAppointments?.appointments || rawAppointments?.events || []).length,
          sample: (rawAppointments?.appointments || rawAppointments?.events || []).slice(0, 5),
        },
      },

      // ── 10. TAGS ─────────────────────────────────────────────────────────────
      tags: {
        rawEndpoint:   rawTags,
        fromContacts:  uniqueTags,
        totalFromContacts: uniqueTags.length,
        fromEndpoint:  (rawTags?.tags || []).map(t => ({ id: t.id, name: t.name })),
      },
    });
  } catch (err) {
    console.error("audit error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
