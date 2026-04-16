import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import { TrendingUp, Users, Target, BarChart2 } from "lucide-react";
import { useData } from "../contexts/DataContext.jsx";
import KPICard from "../components/ui/KPICard.jsx";

// ── Paleta de colores ─────────────────────────────────────────────────────────
const PALETTE = [
  "#c8974e", "#4a7fa5", "#6db87a", "#e8824a", "#7db8d4",
  "#a87a3a", "#2a6a8f", "#52a361", "#d4694a", "#9b8a6a",
];

const INTEREST_COLORS = {
  alto:    "#6db87a",
  caliente:"#6db87a",
  medio:   "#c8974e",
  tibio:   "#c8974e",
  bajo:    "#4a7fa5",
  frío:    "#4a7fa5",
  frio:    "#4a7fa5",
  default: "#6b6358",
};

function interestColor(label) {
  const l = String(label || "").toLowerCase();
  for (const [key, color] of Object.entries(INTEREST_COLORS)) {
    if (l.includes(key)) return color;
  }
  return INTEREST_COLORS.default;
}

// ── Tooltip personalizado ─────────────────────────────────────────────────────
const DarkTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 shadow-xl">
      {label && <p className="mb-1 text-xs font-medium text-cream">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="font-mono text-xs" style={{ color: p.color || p.fill }}>
          {p.name ? `${p.name}: ` : ""}{p.value}
        </p>
      ))}
    </div>
  );
};

function groupBy(arr, key, skip = ["(No hay datos)", "", null, undefined]) {
  const map = {};
  arr.forEach(item => {
    const v = item[key];
    if (skip.includes(v)) return;
    map[v] = (map[v] || 0) + 1;
  });
  return Object.entries(map)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

// ── Panel de chart reutilizable ───────────────────────────────────────────────
function ChartPanel({ title, sub, children }) {
  return (
    <div className="rounded-xl border border-dark-700 bg-dark-800">
      <div className="border-b border-dark-700 px-5 py-3.5">
        <h3 className="font-serif text-base font-semibold text-cream">{title}</h3>
        {sub && <p className="mt-0.5 text-xs text-cream-dim">{sub}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function ResumenView() {
  const { data, loading } = useData();
  const contacts     = data?.contacts ?? [];
  const statsAgentes = data?.statsAgentes ?? {};

  // ── Leads por fuente ──────────────────────────────────────────────────────
  const bySource = useMemo(() => groupBy(contacts, "source").slice(0, 12), [contacts]);

  // ── Leads por nivel de interés ────────────────────────────────────────────
  const byInterest = useMemo(() => groupBy(contacts, "nivelInteres").slice(0, 8), [contacts]);

  // ── Conversión por asesor (% en pipeline Cierre o etapa de cierre) ─────────
  const conversionData = useMemo(() => {
    const closingPipelines = ["02 - Cierre", "Cierre"];
    const closingStages    = ["Asistió a cita", "Nutrición de cierre", "Apartado", "Enganche", "Proceso notarial", "Venta cerrada"];

    const byAgent = {};
    contacts.forEach(c => {
      const agent = c.assignedTo || "Sin asignar";
      if (!byAgent[agent]) byAgent[agent] = { total: 0, enCierre: 0 };
      byAgent[agent].total++;
      const inCierre = closingPipelines.includes(c.pipelineName) ||
                       closingStages.includes(c.pipelineStage);
      if (inCierre) byAgent[agent].enCierre++;
    });

    return Object.entries(byAgent)
      .filter(([name]) => name !== "Sin asignar")
      .map(([name, s]) => ({
        name: name.split(" ")[0], // Solo primer nombre para el eje
        nameFull: name,
        total:    s.total,
        enCierre: s.enCierre,
        pct: s.total > 0 ? Math.round((s.enCierre / s.total) * 100) : 0,
      }))
      .filter(r => r.total >= 2) // Solo asesores con al menos 2 contactos
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 10);
  }, [contacts]);

  // ── KPIs generales ────────────────────────────────────────────────────────
  const totalLeads     = contacts.length;
  const topFuente      = bySource[0]?.name ?? "—";
  const totalEnCierre  = contacts.filter(c => ["02 - Cierre", "Cierre"].includes(c.pipelineName)).length;
  const pctConversion  = totalLeads > 0 ? Math.round((totalEnCierre / totalLeads) * 100) : 0;

  if (loading && contacts.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-dark-600 border-t-gold-500" />
          <p className="text-sm text-cream-muted">Calculando resumen…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KPICard icon={Users}    label="Total leads"       value={totalLeads}         color="gold"    />
        <KPICard icon={BarChart2}label="Fuente principal"  value={topFuente}          color="blue"    sub={bySource[0] ? `${bySource[0].value} leads` : ""} />
        <KPICard icon={Target}   label="En pipeline cierre" value={totalEnCierre}     color="green"   />
        <KPICard icon={TrendingUp}label="Tasa de conversión" value={`${pctConversion}%`} color="orange" sub="Leads en etapa Cierre" />
      </div>

      {/* Fila 1: Fuente + Nivel de interés */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">

        {/* Leads por fuente */}
        <ChartPanel title="Leads por fuente" sub={`${bySource.length} fuentes · ${totalLeads} leads totales`}>
          {bySource.length === 0 ? (
            <p className="py-8 text-center text-sm text-cream-dim">Sin datos de fuente.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={bySource} margin={{ top: 4, right: 4, left: -20, bottom: 40 }}>
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#9a9080", fontSize: 11 }}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis tick={{ fill: "#9a9080", fontSize: 11 }} allowDecimals={false} />
                <Tooltip content={<DarkTooltip />} />
                <Bar dataKey="value" name="Leads" radius={[4, 4, 0, 0]}>
                  {bySource.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>

        {/* Leads por nivel de interés */}
        <ChartPanel title="Nivel de interés" sub="Distribución de prospectos por temperatura">
          {byInterest.length === 0 ? (
            <p className="py-8 text-center text-sm text-cream-dim">Sin datos de nivel de interés en encuestas.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={byInterest}
                  dataKey="value"
                  nameKey="name"
                  cx="45%"
                  cy="50%"
                  outerRadius={100}
                  innerRadius={50}
                  paddingAngle={3}
                  label={({ name, percent }) =>
                    percent > 0.06 ? `${Math.round(percent * 100)}%` : ""
                  }
                  labelLine={false}
                >
                  {byInterest.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={interestColor(entry.name)}
                      fillOpacity={0.85}
                      stroke="transparent"
                    />
                  ))}
                </Pie>
                <Tooltip content={<DarkTooltip />} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={v => <span style={{ color: "#9a9080", fontSize: 11 }}>{v}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>
      </div>

      {/* Fila 2: Conversión por asesor */}
      <ChartPanel
        title="Conversión por asesor"
        sub="% de contactos asignados que llegaron a pipeline Cierre (mínimo 2 contactos)"
      >
        {conversionData.length === 0 ? (
          <p className="py-8 text-center text-sm text-cream-dim">Sin datos de conversión disponibles.</p>
        ) : (
          <div className="space-y-3">
            {conversionData.map((row, i) => (
              <div key={row.nameFull} className="flex items-center gap-4">
                {/* Nombre */}
                <div className="w-32 shrink-0 text-right">
                  <span className="text-sm text-cream">{row.nameFull.split(" ").slice(0, 2).join(" ")}</span>
                </div>
                {/* Barra */}
                <div className="flex flex-1 items-center gap-3">
                  <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-dark-700">
                    <div
                      className="h-full rounded-md transition-all"
                      style={{
                        width: `${row.pct}%`,
                        backgroundColor: PALETTE[i % PALETTE.length],
                        opacity: 0.8,
                      }}
                    />
                    {row.pct > 12 && (
                      <span className="absolute inset-y-0 left-2 flex items-center font-mono text-[11px] font-medium text-dark-950">
                        {row.pct}%
                      </span>
                    )}
                  </div>
                  {/* Stats */}
                  <div className="w-28 shrink-0 text-right font-mono text-xs text-cream-dim tabular-nums">
                    {row.enCierre} / {row.total} leads
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ChartPanel>

      {/* Tabla resumen por pipeline */}
      <ChartPanel title="Distribución por pipeline" sub="Total de leads en cada pipeline activo">
        {(() => {
          const byPipeline = groupBy(contacts, "pipelineName");
          if (byPipeline.length === 0)
            return <p className="py-4 text-center text-sm text-cream-dim">Sin datos de pipeline.</p>;
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-700">
                    <th className="py-2 pr-4 text-left text-[10px] font-medium uppercase tracking-wider text-cream-dim">Pipeline</th>
                    <th className="py-2 pr-4 text-right text-[10px] font-medium uppercase tracking-wider text-cream-dim">Leads</th>
                    <th className="py-2 text-left text-[10px] font-medium uppercase tracking-wider text-cream-dim">Distribución</th>
                  </tr>
                </thead>
                <tbody>
                  {byPipeline.map((row, i) => (
                    <tr key={row.name} className="border-b border-dark-700/40 last:border-0">
                      <td className="py-2.5 pr-4 font-medium text-cream">{row.name}</td>
                      <td className="py-2.5 pr-4 text-right font-mono tabular-nums text-cream-muted">{row.value}</td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-40 overflow-hidden rounded-full bg-dark-700">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.round((row.value / totalLeads) * 100)}%`,
                                backgroundColor: PALETTE[i % PALETTE.length],
                                opacity: 0.8,
                              }}
                            />
                          </div>
                          <span className="font-mono text-xs tabular-nums text-cream-dim">
                            {Math.round((row.value / totalLeads) * 100)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </ChartPanel>
    </div>
  );
}
