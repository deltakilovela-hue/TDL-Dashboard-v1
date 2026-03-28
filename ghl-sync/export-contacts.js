/**
 * export-contacts.js
 * Descarga todos los contactos de GoHighLevel y los guarda como contacts-latest.json
 * También crea un backup contacts-YYYY-MM-DD.json
 *
 * Uso: node export-contacts.js
 */

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const API_KEY = process.env.GHL_API_KEY;
const LOCATION_ID = process.env.GHL_LOCATION_ID;
const OUTPUT_DIR = path.join(__dirname, "data");

if (!API_KEY || !LOCATION_ID) {
  console.error("❌ Faltan variables de entorno. Verifica tu archivo .env");
  process.exit(1);
}

// Asegura que el directorio data/ exista
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Los tokens "pit-..." son de la API v2 de GHL (services.leadconnectorhq.com)
// La paginación v2 usa startAfterId en lugar de skip
async function fetchAllContacts() {
  let allContacts = [];
  const limit = 100;
  let startAfterId = null;
  let total = 0;

  console.log("🔄 Descargando contactos de GoHighLevel (API v2)...");

  while (true) {
    try {
      const params = { locationId: LOCATION_ID, limit };
      if (startAfterId) params.startAfterId = startAfterId;

      const response = await axios.get("https://services.leadconnectorhq.com/contacts/", {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          Version: "2021-07-28",
        },
        params,
        timeout: 30000,
      });

      const contacts = response.data.contacts || [];
      allContacts = allContacts.concat(contacts);
      if (!total) total = response.data.meta?.total || response.data.total || 0;

      console.log(`  📦 ${contacts.length} contactos descargados (total acumulado: ${allContacts.length}${total ? "/" + total : ""})`);

      // Siguiente página: GHL v2 usa startAfterId del último contacto
      const nextId = response.data.meta?.startAfterId || response.data.meta?.nextPageUrl;
      if (contacts.length < limit || !nextId || allContacts.length >= total) {
        break;
      }
      startAfterId = contacts[contacts.length - 1].id;
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      if (err.response) {
        console.error(`❌ Error API: ${err.response.status} - ${JSON.stringify(err.response.data)}`);
      } else {
        console.error(`❌ Error de red: ${err.message}`);
      }
      process.exit(1);
    }
  }

  return allContacts;
}

// ── Helper para llamadas a la API de GHL ──────────────────────────────────────
async function ghlGet(path, params = {}) {
  const url = new URL(`https://services.leadconnectorhq.com${path}`);
  Object.entries(params).forEach(([k, v]) => v && url.set ? url.searchParams.set(k, v) : null);
  // Usar axios con params
  const response = await axios.get(`https://services.leadconnectorhq.com${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", Version: "2021-07-28" },
    params,
    timeout: 30000,
  });
  return response.data;
}

// ── Fetch usuarios → { userId: "Nombre Apellido" } ────────────────────────────
async function fetchUserMap() {
  try {
    const data = await ghlGet("/users/", { locationId: LOCATION_ID });
    const map = {};
    (data.users || []).forEach((u) => {
      if (u.id) map[u.id] = u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim();
    });
    console.log(`  👥 ${Object.keys(map).length} usuarios cargados`);
    return map;
  } catch (e) {
    console.warn("⚠️  fetchUserMap:", e.response?.data || e.message);
    return {};
  }
}

// ── Fetch oportunidades → { contactId: { pipeline, stage, status } } ──────────
async function fetchOpportunityMap() {
  const map = {};
  let startAfterId = null;
  const PRIORITY = ["01 - Desarrollos", "02 - Cierre", "Rentas Vacacionales"];
  console.log("🎯 Descargando oportunidades (pipeline/stage)...");

  for (let page = 0; page < 30; page++) {
    try {
      const params = { location_id: LOCATION_ID, limit: 100 };
      if (startAfterId) params.startAfterId = startAfterId;
      const data = await ghlGet("/opportunities/search", params);
      const opps = data.opportunities || [];

      opps.forEach((opp) => {
        const contactId = opp.contactId || opp.contact?.id;
        if (!contactId) return;
        const pipelineName = opp.pipeline?.name || opp.pipelineName || "";
        const stageName    = opp.pipelineStage?.name || opp.pipelineStageName || opp.name || "";
        const status       = opp.status || "open";
        const current      = map[contactId];
        const isMain       = PRIORITY.includes(pipelineName);
        const curIsMain    = current && PRIORITY.includes(current.pipeline);
        if (!current || (isMain && !curIsMain) ||
            (isMain && curIsMain && status === "open" && current.status !== "open")) {
          map[contactId] = { pipeline: pipelineName, stage: stageName, status };
        }
      });

      console.log(`  🎯 Página ${page + 1}: ${opps.length} oportunidades (contactos mapeados: ${Object.keys(map).length})`);
      const nextId = data.meta?.startAfterId;
      if (opps.length < 100 || !nextId) break;
      startAfterId = opps[opps.length - 1].id;
      await new Promise((r) => setTimeout(r, 200));
    } catch (e) {
      console.warn("⚠️  fetchOpportunityMap página", page, e.response?.data || e.message);
      break;
    }
  }
  return map;
}

// Parsea el campo "Opportunities" de GHL: "open 01 - Desarrollos Interesado en proyecto 🤖"
// Devuelve { status, pipeline, stage } del pipeline principal
function parseMainOpportunity(oppsStr) {
  if (!oppsStr) return { status: "", pipeline: "", stage: "" };
  const KNOWN_PIPELINES = [
    "01 - Desarrollos", "02 - Cierre", "Rentas Vacacionales",
    "Seguimiento IA", "Recepción Proveedores",
  ];
  // Dividir por ", " seguido de "open ", "won " o "lost "
  const entries = oppsStr.split(/, (?=open |won |lost )/i);
  const parsed = entries.map((entry) => {
    const sm = entry.match(/^(open|won|lost)\s+/i);
    const status = sm ? sm[1].toLowerCase() : "open";
    const rest = entry.replace(/^(open|won|lost)\s+/i, "").trim();
    let pipeline = "", stage = rest;
    for (const p of KNOWN_PIPELINES) {
      if (rest === p || rest.startsWith(p + " ")) {
        pipeline = p; stage = rest.slice(p.length).trim(); break;
      }
    }
    return { status, pipeline, stage };
  });
  // Prioriza el pipeline principal activo (01-Desarrollos > 02-Cierre > Rentas)
  const priority = ["01 - Desarrollos", "02 - Cierre", "Rentas Vacacionales"];
  for (const p of priority) {
    const found = parsed.find((o) => o.pipeline === p);
    if (found) return found;
  }
  return parsed.find((o) => o.status === "open") || parsed[0] || { status: "", pipeline: "", stage: "" };
}

function normalizeContact(c, userMap = {}, oppMap = {}) {
  // Extrae custom fields a un objeto plano (por id Y por fieldKey)
  const custom = {};
  if (Array.isArray(c.customField)) {
    c.customField.forEach((f) => {
      if (f.id) custom[f.id] = f.value;
      if (f.fieldKey) {
        custom[f.fieldKey] = f.value;
        // También sin el prefijo "contact." para facilitar el acceso
        custom[f.fieldKey.replace(/^contact\./, "")] = f.value;
      }
    });
  }

  const tags = Array.isArray(c.tags) ? c.tags.join(", ") : (c.tags || "");
  const fullName = c.contactName || `${c.firstName || ""} ${c.lastName || ""}`.trim();
  // Resuelve el ID de usuario → nombre real del agente
  const owner = c.ownerName || userMap[c.assignedTo] || c.assignedTo || "";
  const created = c.dateAdded || c.createdAt || "";

  // Pipeline/Stage: del mapa de oportunidades (más completo que el campo de contacto)
  const opp = oppMap[c.id] || {};
  const apiPipeline = opp.pipeline || c.pipelineName || "";
  const apiStage    = opp.stage    || c.pipelineStage || c.pipelineStageName || "";
  const oppsStr = c.opportunities || "";
  const mainOpp = (!apiPipeline && oppsStr) ? parseMainOpportunity(oppsStr) : { pipeline: apiPipeline, stage: apiStage, status: "open" };
  const pipeline = mainOpp.pipeline || apiPipeline;
  const stage = mainOpp.stage || apiStage;

  return {
    // ── Columnas exactas del CSV de GHL ─────────────────────────────────────
    "Contact Id": c.id || "",
    "First Name": c.firstName || "",
    "Last Name": c.lastName || "",
    "Phone": c.phone || "",
    "Email": c.email || "",
    "Business Name": c.companyName || "",
    "Created": created,
    "Last Activity": c.lastActivityDate || "",
    "Tags": tags,
    "Comentario de NOTA primer contacto": custom["comentario_de_nota_primer_contacto"] || custom["comentario_nota_primer_contacto"] || "",
    "Requiero mas tiempo para responder": custom["requiero_mas_tiempo_para_responder"] || "",
    "Medio de contacto de preferencia": custom["medio_de_contacto_de_preferencia"] || "",
    "🌡️ Nivel de interés del prospecto": custom["nivel_de_interes_del_prospecto"] || custom["nivel_interes"] || "",
    "📆 ¿Desea agendar una cita?": custom["desea_agendar_una_cita"] || custom["agendar_cita"] || "",
    "💸 Presupuesto estimado": custom["presupuesto_estimado"] || custom["presupuesto"] || "",
    "🏦 ¿Cuenta con financiamiento o crédito?": custom["cuenta_con_financiamiento_o_credito"] || custom["financiamiento"] || "",
    "Funciones de LEAD": custom["funciones_de_lead"] || custom["funciones_lead"] || "",
    "Necesito mas tiempo con el prospecto": custom["necesito_mas_tiempo_con_el_prospecto"] || "",
    "Descartado 🗑": custom["descartado"] || "",
    "👥 ¿El prospecto se presentó a la cita?": custom["el_prospecto_se_presento_a_la_cita"] || custom["asistio_cita"] || "",
    "📍 Tipo de cita": custom["tipo_de_cita"] || "",
    "📊 Nivel de interés después de la cita": custom["nivel_de_interes_despues_de_la_cita"] || custom["nivel_interes_post_cita"] || "",
    "📝 ¿Qué le hace falta para cerrar la operación?": custom["que_le_hace_falta_para_cerrar"] || "",
    "🔁 ¿Requiere intervención de un closer u otro equipo?": custom["requiere_intervencion_closer"] || custom["closer"] || "",
    "🗓️ Fecha tentativa de seguimiento/cierre": custom["fecha_tentativa_seguimiento_cierre"] || custom["fecha_seguimiento"] || "",
    "Comentario NOTA Cierre comercial": custom["comentario_nota_cierre_comercial"] || custom["nota_cierre"] || "",
    "Historial de NOTAS para clientes": custom["historial_de_notas_para_clientes"] || custom["historial_notas"] || "",
    "Source": c.source || "",
    "Contact Type": c.type || "lead",
    "Comentarios": custom["comentarios"] || "",
    "Last Note": c.lastNote || custom["last_note"] || "",
    "Opportunities": oppsStr || (pipeline ? `open ${pipeline} ${stage}` : ""),
    "Assigned To": owner,
    "Updated": c.dateUpdated || "",
    "¿Dónde te gustaria invertir?": custom["donde_te_gustaria_invertir"] || custom["donde_invertir"] || "",
    "¿En que te gustaria invertir?": custom["en_que_te_gustaria_invertir"] || custom["en_que_invertir"] || "",
    "Turno de asignación": custom["turno_de_asignacion"] || custom["turno_asignacion"] || "",
    "¿Necesitas algo especial?": custom["necesitas_algo_especial"] || "",
    "Numero de personas (Total)": custom["numero_de_personas_total"] || custom["num_personas"] || "",
    "¿Cuántos días estarás con nosotros?": custom["cuantos_dias_estaras_con_nosotros"] || custom["dias_estancia"] || "",
    "Fecha de visita": custom["fecha_de_visita"] || custom["fecha_visita"] || "",
    "Propiedad seleccionada": custom["propiedad_seleccionada"] || custom["propiedad"] || "",
    // ── Nombres compatibles con el dashboard (para scoring y filtros) ────────
    "Nombre del Contacto": fullName,
    "Número de teléfono": c.phone || "",
    "Usuario asignado": owner,
    "Created On": created,
    "Pipeline": pipeline,
    "Pipeline Name": pipeline,
    "Stage": stage,
    "{{contact.suma_de_notas_de_agente}}": custom["suma_de_notas_de_agente"] || custom["contact.suma_de_notas_de_agente"] || "0",
    // ── Todos los custom fields crudos (por si hay claves distintas) ─────────
    ...custom,
  };
}

// ── Fetch Conversations (mensajes) ────────────────────────────────────────────
async function fetchAllConversations() {
  let all = [];
  let startAfterId = null;
  let total = 0;
  console.log("💬 Descargando conversaciones...");

  while (true) {
    try {
      const params = { locationId: LOCATION_ID, limit: 100 };
      if (startAfterId) params.startAfterId = startAfterId;

      const res = await axios.get("https://services.leadconnectorhq.com/conversations/search", {
        headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", Version: "2021-07-28" },
        params,
        timeout: 30000,
      });

      const convs = res.data.conversations || [];
      all = all.concat(convs);
      if (!total) total = res.data.meta?.total || 0;
      console.log(`  💬 ${convs.length} conversaciones (acumulado: ${all.length}${total ? "/" + total : ""})`);

      const nextId = res.data.meta?.startAfterId;
      if (convs.length < 100 || !nextId || all.length >= total) break;
      startAfterId = convs[convs.length - 1].id;
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.warn("⚠️  Error al descargar conversaciones:", err.response?.data || err.message);
      break; // No detiene el proceso, solo omite conversaciones
    }
  }
  return all;
}

function normalizeConversation(c, userMap = {}) {
  const ownerName = c.ownerName || userMap[c.assignedTo] || c.assignedTo || "";
  return {
    "Nombre del Contacto": c.contactName || c.fullName || "",
    "Mensajes no leídos": String(c.unreadCount || 0),
    "Asignado a": ownerName,
    "Tipo": (c.unreadCount || 0) > 0 ? "Unread" : "Read",
    "Dirección del último mensaje": c.lastMessageDirection || "",
    "Canal del último Mensaje": c.lastMessageChannel || c.lastMessageType || c.type || "",
    "Creada Activado": c.dateCreated || c.dateUpdated || "",
    "Contact Id": c.contactId || "",
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Carga usuarios y oportunidades en paralelo con los contactos/conversaciones
  const [rawContacts, rawConversations, userMap, oppMap] = await Promise.all([
    fetchAllContacts(),
    fetchAllConversations(),
    fetchUserMap(),
    fetchOpportunityMap(),
  ]);

  const contacts = rawContacts.map((c) => normalizeContact(c, userMap, oppMap));
  const mensajes = rawConversations.map((c) => normalizeConversation(c, userMap));

  const today = new Date().toISOString().split("T")[0];
  const updatedAt = new Date().toISOString();

  // contacts-latest.json
  const latestPath = path.join(OUTPUT_DIR, "contacts-latest.json");
  fs.writeFileSync(latestPath, JSON.stringify({ updatedAt, total: contacts.length, contacts, mensajes }, null, 2));

  // Backup con fecha
  const backupPath = path.join(OUTPUT_DIR, `contacts-${today}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ updatedAt, total: contacts.length, contacts, mensajes }, null, 2));

  console.log(`\n✅ Sincronización completa:`);
  console.log(`   👥 ${contacts.length} contactos`);
  console.log(`   💬 ${mensajes.length} conversaciones`);
  console.log(`   📄 ${latestPath}`);
}

main();
