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
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), payload }));
  } catch {}
}

// ── Parsear CSV de exportación GHL ────────────────────────────────────────────
function parseCSVLine(line) {
  const result = []; let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === "," && !inQ) { result.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  result.push(cur.trim());
  return result;
}

function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line);
    const obj  = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
    return obj;
  });
}

// Mapea una fila del CSV de GHL al formato normalizado del dashboard
function mapCSVRow(row) {
  const g = (...keys) => {
    for (const k of keys) {
      const v = row[k];
      if (v && v.trim() && v.trim() !== "N/A") return v.trim();
    }
    return "(No hay datos)";
  };

  const firstName = g("First Name", "first_name", "Nombre");
  const lastName  = g("Last Name",  "last_name",  "Apellido");

  return {
    id:            g("Contact Id", "id", "contact_id") + "_csv",
    firstName,
    lastName,
    phone:         g("Phone", "Mobile Phone", "Número de teléfono", "phone"),
    email:         g("Email", "email"),
    source:        g("Source", "source", "Fuente"),
    status:        g("Status", "status", "Estado"),
    dateAdded:     g("Date Added", "Created On", "Fecha de creación"),
    dateUpdated:   g("Date Updated", "Updated"),
    lastActivity:  g("Last Activity Date", "Last Activity"),
    assignedTo:    g("Assigned To", "Owner Name", "Usuario asignado", "Assigned User"),
    tags:          g("Tags", "tags"),
    unreadCount:   0,
    pipelineName:  g("Pipeline Name", "Pipeline", "pipeline_name"),
    pipelineStage: g("Pipeline Stage", "Stage", "pipeline_stage"),
    // Encuesta — Primer Contacto
    nivelInteres:    g("🌡️ Nivel de interés del prospecto", "Nivel de interés del prospecto", "nivel_de_interes"),
    presupuesto:     g("💸 Presupuesto estimado", "Presupuesto estimado"),
    financiamiento:  g("🏦 ¿Cuenta con financiamiento o crédito?", "Financiamiento"),
    deseaCita:       g("📅 ¿Desea agendar una cita?", "Desea agendar una cita"),
    medioContacto:   g("Medio de contacto de preferencia"),
    funciones:       g("Funciones de LEAD"),
    notaPrimerContacto: g("Comentario de NOTA primer contacto"),
    // Encuesta — Cierre
    sePresentoCita:  g("¿El prospecto se presentó a la cita?", "Se presentó a la cita"),
    nivelInteresPost:g("📊 Nivel de interés después de la cita", "Nivel de interés después de la cita"),
    queFaltaCerrar:  g("¿Qué le hace falta para cerrar?"),
    requiereCloser:  g("¿Requiere closer u otro equipo?"),
    fechaSeguimiento:g("📅 Fecha tentativa seguimiento/cierre"),
    notaCierre:      g("Comentario NOTA Cierre Comercial"),
    _fromCSV: true,
  };
}

// Merge: GHL contacts tienen prioridad, CSV llena los que faltan por ID
function mergeContacts(ghlContacts, csvContacts) {
  const ghlIds = new Set(ghlContacts.map(c => c.id));
  // Quitar el sufijo _csv para comparar
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

  // Cargar CSV guardado al iniciar
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

  // Importar CSV histórico
  const importCSV = useCallback((csvText) => {
    try {
      const rows    = parseCSV(csvText);
      const mapped  = rows.map(mapCSVRow).filter(c => c.firstName !== "(No hay datos)");
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

  // Combinar GHL + CSV
  const mergedData = data ? {
    ...data,
    contacts: mergeContacts(data.contacts ?? [], csvContacts),
    total:    mergeContacts(data.contacts ?? [], csvContacts).length,
  } : null;

  useEffect(() => { fetchData(false); }, [fetchData]);

  return (
    <DataContext.Provider value={{
      data:     mergedData,
      csvCount: csvContacts.length,
      loading,
      error,
      lastSync,
      refresh:   () => fetchData(true),
      importCSV,
      clearCSV,
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
