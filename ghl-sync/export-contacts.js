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

function normalizeContact(c) {
  // Extrae custom fields a un objeto plano
  const custom = {};
  if (Array.isArray(c.customField)) {
    c.customField.forEach((f) => {
      custom[f.id] = f.value;
      if (f.fieldKey) custom[f.fieldKey] = f.value;
    });
  }

  return {
    id: c.id || "",
    firstName: c.firstName || "",
    lastName: c.lastName || "",
    fullName: c.contactName || `${c.firstName || ""} ${c.lastName || ""}`.trim(),
    email: c.email || "",
    phone: c.phone || "",
    assignedTo: c.assignedTo || "",
    ownerName: c.ownerName || "",
    source: c.source || "",
    tags: Array.isArray(c.tags) ? c.tags.join(", ") : c.tags || "",
    pipelineName: c.pipelineName || "",
    pipelineStage: c.pipelineStage || c.pipelineStageName || "",
    pipelineStageId: c.pipelineStageId || "",
    status: c.contact_status || c.contactStatus || "",
    leadValue: c.monetaryValue || 0,
    createdAt: c.dateAdded || c.createdAt || "",
    updatedAt: c.dateUpdated || c.updatedAt || "",
    lastActivity: c.lastActivityDate || "",
    city: c.city || "",
    state: c.state || "",
    country: c.country || "",
    // Notas del agente (campo custom de GHL)
    notasAgente: custom["suma_de_notas_de_agente"] || custom["contact.suma_de_notas_de_agente"] || "",
    // Todos los custom fields por si acaso
    customFields: custom,
    // Raw para acceso completo
    _raw: c,
  };
}

async function main() {
  const contacts = await fetchAllContacts();
  const normalized = contacts.map(normalizeContact);

  const today = new Date().toISOString().split("T")[0];

  // Guarda contacts-latest.json (siempre el más reciente)
  const latestPath = path.join(OUTPUT_DIR, "contacts-latest.json");
  fs.writeFileSync(latestPath, JSON.stringify({ updatedAt: new Date().toISOString(), total: normalized.length, contacts: normalized }, null, 2));

  // Guarda backup con fecha
  const backupPath = path.join(OUTPUT_DIR, `contacts-${today}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ updatedAt: new Date().toISOString(), total: normalized.length, contacts: normalized }, null, 2));

  console.log(`\n✅ ${normalized.length} contactos guardados en:`);
  console.log(`   📄 ${latestPath}`);
  console.log(`   💾 ${backupPath}`);
}

main();
