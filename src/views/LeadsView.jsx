import { useState, useMemo } from "react";
import { Users, Filter, Phone, Calendar } from "lucide-react";
import { useData } from "../contexts/DataContext.jsx";
import KPICard from "../components/ui/KPICard.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import Badge from "../components/ui/Badge.jsx";

// ── Helpers ───────────────────────────────────────────────────────────────────
function unique(arr) {
  return ["Todos", ...Array.from(new Set(arr.filter(v => v && v !== "(No hay datos)"))).sort()];
}

function parseDate(str) {
  if (!str || str === "(No hay datos)") return null;
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

function formatDate(str) {
  const d = parseDate(str);
  if (!d) return "—";
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Presets de rango de fechas ─────────────────────────────────────────────────
function getPreset(preset) {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (preset === "hoy") {
    return { from: today, to: new Date(today.getTime() + 86400000 - 1) };
  }
  if (preset === "semana") {
    const day  = today.getDay();
    const diff = day === 0 ? -6 : 1 - day; // lunes
    const mon  = new Date(today); mon.setDate(today.getDate() + diff);
    const sun  = new Date(mon);   sun.setDate(mon.getDate() + 6);
    sun.setHours(23, 59, 59, 999);
    return { from: mon, to: sun };
  }
  if (preset === "semana_ant") {
    const day  = today.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const mon  = new Date(today); mon.setDate(today.getDate() + diff - 7);
    const sun  = new Date(mon);   sun.setDate(mon.getDate() + 6);
    sun.setHours(23, 59, 59, 999);
    return { from: mon, to: sun };
  }
  if (preset === "mes") {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    const to   = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
    return { from, to };
  }
  if (preset === "mes_ant") {
    const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const to   = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);
    return { from, to };
  }
  if (preset === "30d") {
    const from = new Date(today); from.setDate(today.getDate() - 30);
    return { from, to: new Date(now) };
  }
  if (preset === "90d") {
    const from = new Date(today); from.setDate(today.getDate() - 90);
    return { from, to: new Date(now) };
  }
  return { from: null, to: null };
}

const PRESETS = [
  { id: "hoy",       label: "Hoy"          },
  { id: "semana",    label: "Esta semana"   },
  { id: "semana_ant",label: "Sem. pasada"   },
  { id: "mes",       label: "Este mes"      },
  { id: "mes_ant",   label: "Mes pasado"    },
  { id: "30d",       label: "Últimos 30 d"  },
  { id: "90d",       label: "Últimos 90 d"  },
];

// ── Columnas de la tabla ───────────────────────────────────────────────────────
const COLUMNS = [
  {
    key: "nombre", label: "Nombre", width: 190,
    render: (_, row) => (
      <div>
        <p className="font-medium text-cream leading-tight">{row.nombre || "—"}</p>
        <p className="text-[11px] text-cream-dim mt-0.5 font-mono">{row.phone}</p>
      </div>
    ),
  },
  { key: "assignedTo",    label: "Asesor",   width: 145 },
  { key: "source",        label: "Fuente",   width: 130 },
  {
    key: "pipelineName", label: "Pipeline", width: 160,
    render: (v) => <Badge value={v} type="pipeline" />,
  },
  { key: "pipelineStage", label: "Etapa",   width: 190 },
  {
    key: "nivelInteres", label: "Nivel de interés", width: 150,
    render: (v) => <Badge value={v} type="interest" />,
  },
  {
    key: "deseaCita", label: "¿Desea cita?", width: 120,
    render: (v) => <Badge value={v} type="yesno" />,
  },
  { key: "presupuesto",  label: "Presupuesto",  width: 145 },
  {
    key: "financiamiento", label: "Financiamiento", width: 130,
    render: (v) => <Badge value={v} type="yesno" />,
  },
  {
    key: "sePresentoCita", label: "¿Se presentó?", width: 130,
    render: (v) => <Badge value={v} type="yesno" />,
  },
  {
    key: "nivelInteresPost", label: "Nivel post-cita", width: 150,
    render: (v) => <Badge value={v} type="interest" />,
  },
  {
    key: "dateAdded", label: "Fecha alta", width: 120,
    render: (v) => <span className="font-mono text-xs text-cream-muted">{formatDate(v)}</span>,
  },
];

// ── Select genérico ───────────────────────────────────────────────────────────
function SelectFilter({ label, value, onChange, options }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-medium uppercase tracking-wider text-cream-dim">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="rounded-lg border border-dark-600 bg-dark-800 px-3 py-1.5 text-xs text-cream transition-colors hover:border-dark-500 focus:border-gold-500/60 focus:outline-none focus:ring-1 focus:ring-gold-500/20"
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function LeadsView() {
  const { data, loading } = useData();
  const contacts = data?.contacts ?? [];

  const [filterAgent,    setFilterAgent]    = useState("Todos");
  const [filterSource,   setFilterSource]   = useState("Todos");
  const [filterInterest, setFilterInterest] = useState("Todos");
  const [filterPipeline, setFilterPipeline] = useState("Todos");
  const [search,         setSearch]         = useState("");
  const [activePreset,   setActivePreset]   = useState(null); // id del preset activo
  const [dateFrom,       setDateFrom]       = useState("");   // "YYYY-MM-DD"
  const [dateTo,         setDateTo]         = useState("");

  // Aplicar preset de fecha
  function applyPreset(presetId) {
    if (activePreset === presetId) {
      // toggle: desactivar
      setActivePreset(null);
      setDateFrom("");
      setDateTo("");
      return;
    }
    const { from, to } = getPreset(presetId);
    setActivePreset(presetId);
    setDateFrom(from ? from.toISOString().split("T")[0] : "");
    setDateTo(to   ? to.toISOString().split("T")[0]   : "");
  }

  // Cuando el usuario cambia las fechas manualmente, quitar preset activo
  function handleDateFrom(v) { setDateFrom(v); setActivePreset(null); }
  function handleDateTo(v)   { setDateTo(v);   setActivePreset(null); }

  // Opciones de filtros
  const agents    = useMemo(() => unique(contacts.map(c => c.assignedTo)),   [contacts]);
  const sources   = useMemo(() => unique(contacts.map(c => c.source)),       [contacts]);
  const interests = useMemo(() => unique(contacts.map(c => c.nivelInteres)), [contacts]);
  const pipelines = useMemo(() => unique(contacts.map(c => c.pipelineName)), [contacts]);

  // Filas filtradas
  const rows = useMemo(() => {
    const q        = search.trim().toLowerCase();
    const fromDate = dateFrom ? new Date(dateFrom + "T00:00:00") : null;
    const toDate   = dateTo   ? new Date(dateTo   + "T23:59:59") : null;

    return contacts
      .filter(c => {
        if (filterAgent    !== "Todos" && c.assignedTo   !== filterAgent)    return false;
        if (filterSource   !== "Todos" && c.source       !== filterSource)   return false;
        if (filterInterest !== "Todos" && c.nivelInteres !== filterInterest) return false;
        if (filterPipeline !== "Todos" && c.pipelineName !== filterPipeline) return false;
        if (q) {
          const hay = `${c.firstName} ${c.lastName} ${c.phone} ${c.assignedTo} ${c.source}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (fromDate || toDate) {
          const d = parseDate(c.dateAdded);
          if (!d) return false;
          if (fromDate && d < fromDate) return false;
          if (toDate   && d > toDate)   return false;
        }
        return true;
      })
      .map(c => ({ ...c, nombre: `${c.firstName} ${c.lastName}`.trim() || "(Sin nombre)" }))
      // Contactos sin asesor asignado van al final
      .sort((a, b) => {
        const aNoAsesor = !a.assignedTo || a.assignedTo === "(No hay datos)";
        const bNoAsesor = !b.assignedTo || b.assignedTo === "(No hay datos)";
        if (aNoAsesor && !bNoAsesor) return 1;
        if (!aNoAsesor && bNoAsesor) return -1;
        return 0;
      });
  }, [contacts, filterAgent, filterSource, filterInterest, filterPipeline, search, dateFrom, dateTo]);

  // KPIs rápidos sobre los leads filtrados
  const kpiTotal     = rows.length;
  const kpiCalientes = rows.filter(r => {
    const v = (r.nivelInteres || "").toLowerCase();
    return v.includes("alto") || v.includes("caliente") || v.includes("muy");
  }).length;
  const kpiConCita   = rows.filter(r => {
    const v = (r.deseaCita || "").toLowerCase();
    return v === "sí" || v === "si" || v.startsWith("sí") || v.startsWith("si");
  }).length;
  const kpiPresento  = rows.filter(r => {
    const v = (r.sePresentoCita || "").toLowerCase();
    return v === "sí" || v === "si" || v.startsWith("sí") || v.startsWith("si");
  }).length;

  const hasDateFilter  = dateFrom || dateTo;
  const hasAnyFilter   = filterAgent !== "Todos" || filterSource !== "Todos" ||
                         filterInterest !== "Todos" || filterPipeline !== "Todos" ||
                         search || hasDateFilter;

  function clearAll() {
    setFilterAgent("Todos"); setFilterSource("Todos");
    setFilterInterest("Todos"); setFilterPipeline("Todos");
    setSearch(""); setDateFrom(""); setDateTo(""); setActivePreset(null);
  }

  if (loading && contacts.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-dark-600 border-t-gold-500" />
          <p className="text-sm text-cream-muted">Cargando leads desde GHL…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KPICard icon={Users}    label="Total leads"          value={kpiTotal}     color="gold"   />
        <KPICard icon={Filter}   label="Nivel alto/caliente"  value={kpiCalientes} color="green"
          sub={kpiTotal ? `${Math.round(kpiCalientes / kpiTotal * 100)}% del total` : "—"} />
        <KPICard icon={Phone}    label="Desean cita"          value={kpiConCita}   color="blue"   />
        <KPICard icon={Users}    label="Se presentaron"       value={kpiPresento}  color="orange" />
      </div>

      {/* Panel de filtros */}
      <div className="rounded-xl border border-dark-700 bg-dark-800/60 p-4 space-y-4">

        {/* Fila 1: Búsqueda + selects */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <label className="text-[10px] font-medium uppercase tracking-wider text-cream-dim">Buscar</label>
            <input
              type="text"
              placeholder="Nombre, teléfono, fuente…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="rounded-lg border border-dark-600 bg-dark-800 px-3 py-1.5 text-xs text-cream placeholder:text-cream-dim focus:border-gold-500/60 focus:outline-none focus:ring-1 focus:ring-gold-500/20"
            />
          </div>
          <SelectFilter label="Asesor"           value={filterAgent}    onChange={setFilterAgent}    options={agents} />
          <SelectFilter label="Fuente"           value={filterSource}   onChange={setFilterSource}   options={sources} />
          <SelectFilter label="Nivel de interés" value={filterInterest} onChange={setFilterInterest} options={interests} />
          <SelectFilter label="Pipeline"         value={filterPipeline} onChange={setFilterPipeline} options={pipelines} />
        </div>

        {/* Fila 2: Filtro de fechas */}
        <div className="border-t border-dark-700 pt-4">
          <div className="flex flex-wrap items-end gap-3">
            {/* Ícono + label */}
            <div className="flex items-center gap-1.5 self-end pb-1.5">
              <Calendar size={13} className="text-cream-dim" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-cream-dim">Período</span>
            </div>

            {/* Botones preset */}
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map(p => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id)}
                  className={[
                    "rounded-md px-2.5 py-1 text-[11px] font-medium transition-all border",
                    activePreset === p.id
                      ? "bg-gold-500/20 border-gold-500/50 text-gold-400"
                      : "border-dark-600 text-cream-muted hover:border-dark-500 hover:text-cream",
                  ].join(" ")}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Separador */}
            <div className="hidden h-6 w-px bg-dark-600 sm:block self-end mb-0.5" />

            {/* Rango personalizado */}
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium uppercase tracking-wider text-cream-dim">Desde</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => handleDateFrom(e.target.value)}
                  className="rounded-lg border border-dark-600 bg-dark-800 px-2.5 py-1.5 text-xs text-cream focus:border-gold-500/60 focus:outline-none focus:ring-1 focus:ring-gold-500/20 [color-scheme:dark]"
                />
              </div>
              <span className="self-end pb-2 text-cream-dim text-xs">—</span>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium uppercase tracking-wider text-cream-dim">Hasta</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => handleDateTo(e.target.value)}
                  className="rounded-lg border border-dark-600 bg-dark-800 px-2.5 py-1.5 text-xs text-cream focus:border-gold-500/60 focus:outline-none focus:ring-1 focus:ring-gold-500/20 [color-scheme:dark]"
                />
              </div>
            </div>

            {/* Limpiar + contador */}
            <div className="flex items-end gap-3 ml-auto">
              {hasAnyFilter && (
                <button
                  onClick={clearAll}
                  className="self-end rounded-lg border border-dark-600 px-3 py-1.5 text-xs text-cream-dim transition-colors hover:border-dark-500 hover:text-cream"
                >
                  Limpiar todo
                </button>
              )}
              <span className="self-end pb-1.5 text-xs text-cream-dim tabular-nums">
                {rows.length} de {contacts.length} leads
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabla */}
      <DataTable columns={COLUMNS} rows={rows} emptyMessage="No hay leads con los filtros seleccionados." />
    </div>
  );
}
