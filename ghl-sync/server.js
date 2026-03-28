/**
 * server.js
 * Servidor Express local que sirve los datos de GHL al dashboard React.
 * Corre en http://localhost:3001
 *
 * Endpoints:
 *   GET /api/contacts        → devuelve contacts-latest.json
 *   GET /api/sync            → ejecuta export-contacts.js y devuelve los datos nuevos
 *   GET /api/status          → estado del servidor y última sincronización
 *
 * Uso: node server.js
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, "data");
const LATEST_FILE = path.join(DATA_DIR, "contacts-latest.json");

// Permite requests desde el dashboard React (local y Vercel)
app.use(cors({
  origin: (origin, callback) => {
    // Permitir: localhost dev, Vercel producción, y cualquier subdominio de vercel.app
    const allowed = [
      /^http:\/\/localhost:/,
      /^http:\/\/127\.0\.0\.1:/,
      /\.vercel\.app$/,
    ];
    if (!origin || allowed.some(r => r.test(origin))) {
      callback(null, true);
    } else {
      callback(new Error("CORS no permitido: " + origin));
    }
  },
  methods: ["GET", "POST"],
}));
app.use(express.json());

// ── GET /api/status ────────────────────────────────────────────────────────────
app.get("/api/status", (req, res) => {
  let lastSync = null;
  let total = 0;

  if (fs.existsSync(LATEST_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(LATEST_FILE, "utf8"));
      lastSync = data.updatedAt || null;
      total = data.total || 0;
    } catch {}
  }

  let totalMensajes = 0;
  try {
    if (fs.existsSync(LATEST_FILE)) {
      const d = JSON.parse(fs.readFileSync(LATEST_FILE, "utf8"));
      totalMensajes = d.mensajes?.length || 0;
    }
  } catch {}

  res.json({
    ok: true,
    server: "TDL Dashboard Sync Server",
    version: "1.1.0",
    lastSync,
    totalContacts: total,
    totalMensajes,
    dataFile: fs.existsSync(LATEST_FILE) ? "exists" : "not_found",
  });
});

// ── GET /api/contacts ──────────────────────────────────────────────────────────
app.get("/api/contacts", (req, res) => {
  if (!fs.existsSync(LATEST_FILE)) {
    return res.status(404).json({
      ok: false,
      error: "No hay datos sincronizados aún. Ejecuta /api/sync primero.",
    });
  }

  try {
    const raw = fs.readFileSync(LATEST_FILE, "utf8");
    const data = JSON.parse(raw);
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: "Error leyendo el archivo de datos: " + err.message });
  }
});

// ── GET /api/sync ──────────────────────────────────────────────────────────────
// Dispara el script de exportación y devuelve los datos actualizados
let syncInProgress = false;

app.get("/api/sync", (req, res) => {
  if (syncInProgress) {
    return res.status(429).json({ ok: false, error: "Sincronización ya en progreso. Espera unos segundos." });
  }

  syncInProgress = true;
  console.log("🔄 Iniciando sincronización con GHL...");

  const scriptPath = path.join(__dirname, "export-contacts.js");
  const command = `node "${scriptPath}"`;

  exec(command, { cwd: __dirname, timeout: 120000 }, (err, stdout, stderr) => {
    syncInProgress = false;

    if (err) {
      console.error("❌ Error en sincronización:", err.message);
      console.error(stderr);
      return res.status(500).json({
        ok: false,
        error: "Error ejecutando la sincronización: " + err.message,
        details: stderr,
      });
    }

    console.log("✅ Sincronización completada");
    console.log(stdout);

    // Devuelve los datos recién descargados
    try {
      const data = JSON.parse(fs.readFileSync(LATEST_FILE, "utf8"));
      res.json({ ok: true, synced: true, ...data });
    } catch (parseErr) {
      res.status(500).json({ ok: false, error: "Sync OK pero error leyendo datos: " + parseErr.message });
    }
  });
});

// ── Inicia el servidor ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 TDL Sync Server corriendo en http://localhost:${PORT}`);
  console.log(`   GET /api/status    → estado del servidor`);
  console.log(`   GET /api/contacts  → datos más recientes`);
  console.log(`   GET /api/sync      → sincronizar ahora con GHL\n`);

  // Verifica si ya hay datos disponibles
  if (fs.existsSync(LATEST_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(LATEST_FILE, "utf8"));
      console.log(`📊 Datos disponibles: ${data.total} contactos (última sync: ${data.updatedAt})`);
    } catch {}
  } else {
    console.log("⚠️  No hay datos aún. Llama a /api/sync para descargar contactos.");
  }
});
