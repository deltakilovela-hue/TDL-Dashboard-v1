import { createContext, useContext, useState, useEffect, useCallback } from "react";

const DataContext = createContext(null);

const LS_KEY    = "tdl_ghl_v2";
const LS_CSV    = "tdl_csv_contacts_v2";
const LS_TTL_MS = 30 * 60 * 1000; // 30 min

function loadFromLS(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, payload } = JSON.parse(raw);
    if (key === LS_KEY && Date.now() - ts > LS_TTL_MS) return null;
    return payload;
  } catch { return null; }
}

function saveToLS(key, payload) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), payload })); } catch {}
}

// ── CSV Parser robusto (maneja campos con comas Y saltos de línea dentro de comillas) ──
function parseCSV(text) {
  const src     = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const records = [];
  let headers   = null;
  let pos       = 0;

  while (pos < src.length) {
    const { fields, next } = readRecord(src, pos);
    pos = next;
    if (fields.length === 0 || (fields.length === 1 && fields[0] === "")) continue;
    if (!headers) { headers = fields; continue; }
    const obj = {};
    headers.forEach((h, i) => { obj[h] = fields[i] ?? ""; });
    records.push(obj);
  }
  return records;
}

function readRecord(src, start) {
  const fields = [];
  let pos = start;
  let field = "";

  while (pos < src.length) {
    const ch = src[pos];

    if (ch === '"') {
      // Campo entre comillas — puede contener comas y saltos de línea
      pos++;
      while (pos < src.length) {
        if (src[pos] === '"') {
          if (src[pos + 1] === '"') { field += '"'; pos += 2; } // "" → "
          else { pos++; break; }
        } else {
          field += src[pos++];
        }
      }
    } else if (ch === ",") {
      fields.push(field.trim());
      field = "";
      pos++;
    } else if (ch === "\n") {
      // Fin de registro
      fields.push(field.trim());
      return { fields, next: pos + 1 };
    } else {
      field += ch;
      pos++;
    }
  }

  // Último registro sin salto de línea al final
  fields.push(field.trim());
  return { fields, next: pos };
}

// ── Parsear pipeline desde campo Opportunities del CSV ──────────────────────
// Puede tener múltiples oportunidades: "open 01 - Desarrollos Etapa, open Seguimiento IA Otro"
// Prioridad: pipelines principales con status open > won > lost/abandoned
// Pipelines principales (mismos que sync.js)
const MAIN_PIPELINES = [
  "01 - Desarrollos",
  "02 - Cierre",
  "Rentas Vacacionales",
  "Rentas vacacionales",
];
// Normaliza el nombre del pipeline a la versión canónica
function normalizePipeline(name) {
  if (name.toLowerCase() === "rentas vacacionales") return "Rentas Vacacionales";
  return name;
}
// Statuses permitidos — igual que sync.js: open, won, abandoned (NO lost)
const CSV_ALLOWED = new Set(["open", "won", "abandoned"]);

function parseOpportunity(oppStr) {
  if (!oppStr || !oppStr.trim())
    return { pipelineName: "(No hay datos)", pipelineStage: "(No hay datos)" };

  // Dividir múltiples oportunidades: "open Pipeline Etapa, won Pipeline2 Etapa2"
  const parts = oppStr.split(/,\s*(?=open\s|won\s|lost\s|abandoned\s)/i);

  const opps = parts.map(part => {
    const m = part.trim().match(/^(open|won|lost|abandoned)\s+(.+)/i);
    if (!m) return null;
    const status = m[1].toLowerCase();
    if (!CSV_ALLOWED.has(status)) return null; // descarta "lost"

    const rest = m[2].trim();

    // Buscar pipeline principal al inicio del string
    let pipelineName  = null;
    let pipelineStage = rest;

    for (const p of MAIN_PIPELINES) {
      if (rest.toLowerCase().startsWith(p.toLowerCase())) {
        pipelineName  = normalizePipeline(p);
        pipelineStage = rest.slice(p.length).trim() || "(No hay datos)";
        break;
      }
    }
    if (!pipelineName) return null; // pipeline no relevante (Seguimiento IA, etc.)
    return { status, pipelineName, pipelineStage };
  }).filter(Boolean);

  if (opps.length === 0)
    return { pipelineName: "(No hay datos)", pipelineStage: "(No hay datos)" };

  // Prioridad: open=0 > abandoned=1 > won=2; pipeline en orden del array
  const score = (o) => {
    const s = o.status === "open" ? 0 : o.status === "abandoned" ? 1 : 2;
    const p = MAIN_PIPELINES.findIndex(p => p.toLowerCase() === o.pipelineName.toLowerCase());
    return s * 10 + (p === -1 ? 9 : p);
  };

  const best = opps.sort((a, b) => score(a) - score(b))[0];
  return { pipelineName: best.pipelineName, pipelineStage: best.pipelineStage };
}

// ── Mapear fila CSV al formato normalizado del dashboard ──────────────────────
function mapCSVRow(row) {
  const g = (...keys) => {
    for (const k of keys) {
      const v = row[k];
      if (v !== undefined && v !== null && v.trim() && v.trim() !== "N/A") return v.trim();
    }
    return "(No hay datos)";
  };

  const { pipelineName, pipelineStage } = parseOpportunity(row["Opportunities"] || "");

  return {
    id:           (row["Contact Id"] || row["id"] || "") + "_csv",
    firstName:    g("First Name", "first_name"),
    lastName:     g("Last Name",  "last_name"),
    phone:        g("Phone", "Mobile Phone", "Número de teléfono"),
    email:        g("Email", "email"),
    source:       g("Source", "source", "Fuente"),
    status:       g("Contact Type", "Status", "status"),
    // ── El CSV de GHL usa "Created", no "Date Added" ──
    dateAdded:    g("Created", "Date Added", "Created On", "Fecha de creación"),
    dateUpdated:  g("Updated", "Date Updated"),
    lastActivity: g("Last Activity", "Last Activity Date"),
    assignedTo:   g("Assigned To", "Owner Name", "Usuario asignado"),
    tags:         g("Tags", "tags"),
    unreadCount:  0,
    pipelineName,
    pipelineStage,
    // ── Encuesta Primer Contacto ──
    nivelInteres:   g("🌡️ Nivel de interés del prospecto", "Nivel de interés del prospecto"),
    presupuesto:    g("💸 Presupuesto estimado", "Presupuesto estimado"),
    financiamiento: g("🏦 ¿Cuenta con financiamiento o crédito?", "Financiamiento"),
    // El CSV usa 📆 (no 📅)
    deseaCita:      g("📆 ¿Desea agendar una cita?", "📅 ¿Desea agendar una cita?", "¿Desea agendar una cita?"),
    medioContacto:  g("Medio de contacto de preferencia"),
    funciones:      g("Funciones de LEAD"),
    notaPrimerContacto: g("Comentario de NOTA primer contacto"),
    // ── Encuesta Cierre Comercial ──
    sePresentoCita:  g("👥 ¿El prospecto se presentó a la cita?", "¿El prospecto se presentó a la cita?"),
    nivelInteresPost:g("📊 Nivel de interés después de la cita", "Nivel de interés después de la cita"),
    queFaltaCerrar:  g("📝 ¿Qué le hace falta para cerrar la operación?", "¿Qué le hace falta para cerrar?"),
    requiereCloser:  g("🔁 ¿Requiere intervención de un closer u otro equipo?", "¿Requiere closer u otro equipo?"),
    fechaSeguimiento:g("🗓️ Fecha tentativa de seguimiento/cierre", "Fecha tentativa de seguimiento/cierre"),
    notaCierre:      g("Comentario NOTA Cierre comercial", "Comentario NOTA Cierre Comercial"),
    _fromCSV: true,
  };
}

// ── Merge GHL + CSV sin duplicados ────────────────────────────────────────────
function mergeContacts(ghlContacts, csvContacts) {
  const ghlIds = new Set(ghlContacts.map(c => c.id));
  const csvNew = csvContacts.filter(c => !ghlIds.has(c.id.replace("_csv", "")));
  return [...ghlContacts, ...csvNew];
}

// ── Provider ──────────────────────────────────────────────────────────────────
export function DataProvider({ children }) {
  const [data,        setData]        = useState(null);
  const [csvContacts, setCsvContacts] = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [lastSync,    setLastSync]    = useState(null);

  useEffect(() => {
    const saved = loadFromLS(LS_CSV);
    if (saved) setCsvContacts(saved);
  }, []);

  const fetchData = useCallback(async (force = false) => {
    if (!force) {
      const cached = loadFromLS(LS_KEY);
      if (cached) {
        setData(cached);
        setLastSync(cached.updatedAt ? new Date(cached.updatedAt) : null);
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(force ? "/api/sync?force=true" : "/api/sync");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Error en /api/sync");
      setData(json);
      setLastSync(json.updatedAt ? new Date(json.updatedAt) : new Date());
      saveToLS(LS_KEY, json);
    } catch (e) {
      console.error("DataContext fetch:", e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const importCSV = useCallback((csvText) => {
    try {
      const rows   = parseCSV(csvText);
      const mapped = rows.map(mapCSVRow).filter(c => c.firstName !== "(No hay datos)");
      setCsvContacts(mapped);
      saveToLS(LS_CSV, mapped);
      return { ok: true, count: mapped.length };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, []);

  const clearCSV = useCallback(() => {
    setCsvContacts([]);
    localStorage.removeItem(LS_CSV);
  }, []);

  const mergedData = data ? {
    ...data,
    contacts: mergeContacts(data.contacts ?? [], csvContacts),
    total:    mergeContacts(data.contacts ?? [], csvContacts).length,
  } : null;

  useEffect(() => { fetchData(false); }, [fetchData]);

  return (
    <DataContext.Provider value={{
      data: mergedData,
      csvCount: csvContacts.length,
      loading, error, lastSync,
      refresh:   () => fetchData(true),
      importCSV, clearCSV,
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData debe usarse dentro de <DataProvider>");
  return ctx;
}
