import { useState, useMemo } from "react";
import { Users, Filter, Phone } from "lucide-react";
import { useData } from "../contexts/DataContext.jsx";
import KPICard from "../components/ui/KPICard.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import Badge from "../components/ui/Badge.jsx";

// ── Helpers ───────────────────────────────────────────────────────────────────
function unique(arr) {
  return ["Todos", ...Array.from(new Set(arr.filter(v => v && v !== "(No hay datos)"))).sort()];
}

function formatDate(str) {
  if (!str || str === "(No hay datos)") return "—";
  try {
    const d = new Date(str);
    if (isNaN(d)) return str;
    return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return str; }
}

// ── Columnas de la tabla ───────────────────────────────────────────────────────
const COLUMNS = [
  {
    key: "nombre",
    label: "Nombre",
    width: 190,
    render: (_, row) => (
      <div>
        <p className="font-medium text-cream leading-tight">{row.nombre || "—"}</p>
        <p className="text-[11px] text-cream-dim mt-0.5 font-mono">{row.phone}</p>
      </div>
    ),
  },
  { key: "assignedTo",    label: "Asesor",      width: 145 },
  { key: "source",        label: "Fuente",       width: 130 },
  {
    key: "pipelineName",
    label: "Pipeline",
    width: 160,
    render: (v) => <Badge value={v} type="pipeline" />,
  },
  { key: "pipelineStage", label: "Etapa",        width: 190 },
  {
    key: "nivelInteres",
    label: "Nivel de interés",
    width: 150,
    render: (v) => <Badge value={v} type="interest" />,
  },
  {
    key: "deseaCita",
    label: "¿Desea cita?",
    width: 120,
    render: (v) => <Badge value={v} type="yesno" />,
  },
  { key: "presupuesto",  label: "Presupuesto",   width: 145 },
  {
    key: "financiamiento",
    label: "Financiamiento",
    width: 130,
    render: (v) => <Badge value={v} type="yesno" />,
  },
  {
    key: "sePresentoCita",
    label: "¿Se presentó?",
    width: 130,
    render: (v) => <Badge value={v} type="yesno" />,
  },
  {
    key: "nivelInteresPost",
    label: "Nivel post-cita",
    width: 150,
    render: (v) => <Badge value={v} type="interest" />,
  },
  {
    key: "dateAdded",
    label: "Fecha",
    width: 120,
    render: (v) => <span className="font-mono text-xs text-cream-muted">{formatDate(v)}</span>,
  },
];

// ── Componente principal ──────────────────────────────────────────────────────
export default function LeadsView() {
  const { data, loading } = useData();
  const contacts = data?.contacts ?? [];

  const [filterAgent,    setFilterAgent]    = useState("Todos");
  const [filterSource,   setFilterSource]   = useState("Todos");
  const [filterInterest, setFilterInterest] = useState("Todos");
  const [filterPipeline, setFilterPipeline] = useState("Todos");
  const [search,         setSearch]         = useState("");

  // Opciones de filtros (memoizadas)
  const agents    = useMemo(() => unique(contacts.map(c => c.assignedTo)),    [contacts]);
  const sources   = useMemo(() => unique(contacts.map(c => c.source)),        [contacts]);
  const interests = useMemo(() => unique(contacts.map(c => c.nivelInteres)),  [contacts]);
  const pipelines = useMemo(() => unique(contacts.map(c => c.pipelineName)),  [contacts]);

  // Filas procesadas
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
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
        return true;
      })
      .map(c => ({
        ...c,
        nombre: `${c.firstName} ${c.lastName}`.trim() || "(Sin nombre)",
      }));
  }, [contacts, filterAgent, filterSource, filterInterest, filterPipeline, search]);

  // KPIs rápidos
  const kpiTotal     = rows.length;
  const kpiConCita   = rows.filter(r => r.deseaCita?.toLowerCase().includes("sí") || r.deseaCita?.toLowerCase() === "si").length;
  const kpiPresento  = rows.filter(r => r.sePresentoCita?.toLowerCase().includes("sí") || r.sePresentoCita?.toLowerCase() === "si").length;
  const kpiCalientes = rows.filter(r => r.nivelInteres?.toLowerCase().includes("alto") || r.nivelInteres?.toLowerCase().includes("caliente")).length;

  const SelectFilter = ({ label, value, onChange, options }) => (
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
    <div className="space-y-6">

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KPICard icon={Users}  label="Total leads"      value={kpiTotal}     color="gold"   />
        <KPICard icon={Filter} label="Nivel alto/caliente" value={kpiCalientes} color="green"  sub={`${kpiTotal ? Math.round(kpiCalientes / kpiTotal * 100) : 0}% del total`} />
        <KPICard icon={Phone}  label="Desean cita"      value={kpiConCita}   color="blue"   />
        <KPICard icon={Users}  label="Se presentaron"   value={kpiPresento}  color="orange" />
      </div>

      {/* Filtros */}
      <div className="rounded-xl border border-dark-700 bg-dark-800/60 p-4">
        <div className="flex flex-wrap items-end gap-4">
          {/* Búsqueda */}
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

          {/* Reset */}
          {(filterAgent !== "Todos" || filterSource !== "Todos" || filterInterest !== "Todos" || filterPipeline !== "Todos" || search) && (
            <button
              onClick={() => { setFilterAgent("Todos"); setFilterSource("Todos"); setFilterInterest("Todos"); setFilterPipeline("Todos"); setSearch(""); }}
              className="self-end rounded-lg border border-dark-600 px-3 py-1.5 text-xs text-cream-dim transition-colors hover:border-dark-500 hover:text-cream"
            >
              Limpiar
            </button>
          )}

          <span className="ml-auto self-end text-xs text-cream-dim tabular-nums">
            {rows.length} de {contacts.length} leads
          </span>
        </div>
      </div>

      {/* Tabla */}
      <DataTable columns={COLUMNS} rows={rows} emptyMessage="No hay leads con los filtros seleccionados." />
    </div>
  );
}
