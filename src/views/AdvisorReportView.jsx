import { useMemo, useState } from "react";
import { Users, MessageSquare, Phone, PhoneCall, PhoneMissed, FileText, Mail, Smartphone, ChevronLeft, ChevronRight, Database } from "lucide-react";
import { useData } from "../contexts/DataContext.jsx";
import { EXCLUDED_USERS } from "./AdvisorWeeklyView.jsx";

// ── Rangos de fecha ────────────────────────────────────────────────────────────
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d)   { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

function getWeekBounds(anchor) {
  const d   = new Date(anchor);
  const day = d.getDay();
  const mon = startOfDay(new Date(d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))));
  const sun = endOfDay(new Date(mon.getTime() + 6 * 86_400_000));
  return { from: mon, to: sun };
}
function getMonthBounds(anchor) {
  const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const to   = endOfDay(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0));
  return { from, to };
}
function getEarliestDay(dailyStatsForAdvisor) {
  const keys = Object.keys(dailyStatsForAdvisor || {});
  if (keys.length === 0) return null;
  return startOfDay(new Date(keys.sort()[0]));
}

const RANGE_LABELS = { dia: "Día", semana: "Semana", mes: "Mes", historico: "Histórico completo" };

function formatRangeLabel(rangeType, from, to) {
  if (rangeType === "historico") return from ? `Desde ${from.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}` : "Sin datos";
  const opts = { day: "numeric", month: "short", year: rangeType === "dia" ? undefined : "numeric" };
  if (rangeType === "dia") return from.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
  return `${from.toLocaleDateString("es-MX", opts)} – ${to.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}`;
}

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color = "cream" }) {
  const colorClass = { cream: "text-cream", gold: "text-gold-400", success: "text-success-400", danger: "text-danger-400", info: "text-info-400" }[color];
  return (
    <div className="rounded-xl border border-dark-700 bg-dark-900 p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-cream-dim">{label}</p>
          <p className={`mt-1 text-3xl font-bold tabular-nums ${colorClass}`}>{value}</p>
          {sub && <p className="mt-0.5 text-xs text-cream-dim">{sub}</p>}
        </div>
        <div className="rounded-lg bg-dark-800 p-2">
          <Icon size={16} className="text-cream-muted" />
        </div>
      </div>
    </div>
  );
}

function ChannelBar({ label, icon: Icon, value, max }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <Icon size={13} className="text-cream-dim shrink-0" />
      <span className="w-24 shrink-0 text-xs text-cream-dim">{label}</span>
      <div className="h-2 flex-1 rounded-full bg-dark-700">
        <div className="h-2 rounded-full bg-gold-500/60 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right text-sm font-bold tabular-nums text-cream">{value}</span>
    </div>
  );
}

// ── Vista principal ───────────────────────────────────────────────────────────
export default function AdvisorReportView() {
  const { data, deepStats } = useData();

  const advisorNames = useMemo(() => {
    const names = new Set([
      ...(data?.usuarios || []).map(u => u.name).filter(Boolean),
      ...Object.keys(deepStats?.dailyStats || {}),
    ]);
    EXCLUDED_USERS.forEach(n => names.delete(n));
    names.delete("(Sin asignar)");
    return [...names].sort((a, b) => a.localeCompare(b, "es"));
  }, [data, deepStats]);

  const [selectedAdvisor, setSelectedAdvisor] = useState(null);
  const [rangeType, setRangeType]             = useState("semana");
  const [anchorDate, setAnchorDate]           = useState(() => new Date());

  const advisor = selectedAdvisor || advisorNames[0] || null;
  const advisorDaily = deepStats?.dailyStats?.[advisor] || {};

  const { from, to } = useMemo(() => {
    if (rangeType === "dia")      return { from: startOfDay(anchorDate), to: endOfDay(anchorDate) };
    if (rangeType === "semana")   return getWeekBounds(anchorDate);
    if (rangeType === "mes")      return getMonthBounds(anchorDate);
    const earliest = getEarliestDay(advisorDaily);
    return { from: earliest, to: endOfDay(new Date()) };
  }, [rangeType, anchorDate, advisorDaily]);

  // ── Navegación (deshabilitada en "histórico") ──────────────────────────────
  function navigate(dir) {
    setAnchorDate(prev => {
      const d = new Date(prev);
      if (rangeType === "dia")    d.setDate(d.getDate() + dir);
      if (rangeType === "semana") d.setDate(d.getDate() + dir * 7);
      if (rangeType === "mes")    d.setMonth(d.getMonth() + dir);
      return d;
    });
  }

  // ── Agregación del rango seleccionado ──────────────────────────────────────
  const agg = useMemo(() => {
    const result = {
      mensajesEnviados: 0,
      mensajesPorCanal: { correo: 0, sms: 0, whatsappQr: 0, otros: 0 },
      llamadas: 0, llamadasContestadas: 0, llamadasPerdidas: 0,
      notasTotal: 0,
      notasPorFecha: [], // [{ date, count }]
      leadsContactados: 0,
    };
    if (!from) return result;
    const contactosSet = new Set();

    Object.entries(advisorDaily)
      .filter(([day]) => { const d = new Date(day); return d >= from && d <= to; })
      .sort(([a], [b]) => b.localeCompare(a)) // más reciente primero
      .forEach(([day, stats]) => {
        result.mensajesEnviados += stats.mensajesEnviados || 0;
        result.llamadas         += stats.llamadas || 0;
        result.llamadasContestadas += stats.llamadasContestadas || 0;
        result.llamadasPerdidas    += stats.llamadasPerdidas || 0;
        if (stats.mensajesPorCanal) {
          result.mensajesPorCanal.correo     += stats.mensajesPorCanal.correo     || 0;
          result.mensajesPorCanal.sms        += stats.mensajesPorCanal.sms        || 0;
          result.mensajesPorCanal.whatsappQr += stats.mensajesPorCanal.whatsappQr || 0;
          result.mensajesPorCanal.otros      += stats.mensajesPorCanal.otros      || 0;
        }
        if (stats.notas) {
          result.notasTotal += stats.notas;
          result.notasPorFecha.push({ date: day, count: stats.notas });
        }
        (stats.contactosTocados || []).forEach(id => contactosSet.add(id));
      });

    result.leadsContactados = contactosSet.size;
    return result;
  }, [advisorDaily, from, to]);

  const leadsAsignados = useMemo(() => {
    if (!data?.contacts) return 0;
    return data.contacts.filter(c => c.assignedTo === advisor).length;
  }, [data, advisor]);

  const usingDeep = !!deepStats?.dailyStats;
  const maxChannel = Math.max(agg.mensajesPorCanal.correo, agg.mensajesPorCanal.sms, agg.mensajesPorCanal.whatsappQr, agg.mensajesPorCanal.otros, 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-cream">Reporte por asesor</h1>
        <p className="text-sm text-cream-dim">Filtra por asesor y rango de fecha para ver su actividad completa.</p>
      </div>

      {!usingDeep && (
        <div className="rounded-lg border border-gold-500/20 bg-gold-500/5 px-3 py-2 text-xs text-gold-400">
          <Database size={13} className="inline mr-1" />
          El histórico depende del job nocturno de GitHub Actions. Si no ves datos, verifica que haya corrido al menos una vez.
        </div>
      )}

      {/* ── Selector de asesor ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-cream-dim shrink-0">Asesor:</span>
        {advisorNames.map(name => (
          <button
            key={name}
            onClick={() => setSelectedAdvisor(name)}
            className={[
              "rounded-full px-3 py-1 text-xs font-medium transition-all border",
              advisor === name
                ? "bg-gold-500/20 text-gold-400 border-gold-500/40"
                : "border-dark-600 text-cream-dim hover:border-dark-500 hover:text-cream",
            ].join(" ")}
          >
            {name}
          </button>
        ))}
      </div>

      {/* ── Selector de rango ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-dark-700 p-1">
          {Object.entries(RANGE_LABELS).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setRangeType(key)}
              className={[
                "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                rangeType === key ? "bg-gold-500/20 text-gold-400" : "text-cream-dim hover:text-cream",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>

        {rangeType !== "historico" && (
          <div className="flex items-center gap-1">
            <button onClick={() => navigate(-1)} className="flex h-7 w-7 items-center justify-center rounded-md text-cream-dim hover:bg-dark-700 hover:text-cream">
              <ChevronLeft size={14} />
            </button>
            <button onClick={() => navigate(1)} className="flex h-7 w-7 items-center justify-center rounded-md text-cream-dim hover:bg-dark-700 hover:text-cream">
              <ChevronRight size={14} />
            </button>
          </div>
        )}

        <span className="text-sm font-medium text-cream">{from ? formatRangeLabel(rangeType, from, to) : "Sin datos históricos para este asesor"}</span>
      </div>

      {!advisor ? (
        <div className="flex h-32 items-center justify-center rounded-xl border border-dark-700 bg-dark-900">
          <p className="text-sm text-cream-dim">No hay asesores disponibles todavía. Sincroniza primero.</p>
        </div>
      ) : (
        <>
          {/* ── KPIs principales ── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard icon={Users}         label="Leads asignados"    value={leadsAsignados}          sub="actual" />
            <KpiCard icon={Users}         label="Leads contactados" value={agg.leadsContactados}    sub="distintos en el rango" color="gold" />
            <KpiCard icon={MessageSquare} label="Mensajes enviados" value={agg.mensajesEnviados}     sub="en el rango" color="gold" />
            <KpiCard icon={FileText}      label="Notas agregadas"   value={agg.notasTotal}           sub="en el rango" />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <KpiCard icon={Phone}     label="Llamadas"    value={agg.llamadas}            sub="en el rango" />
            <KpiCard icon={PhoneCall} label="Contestadas" value={agg.llamadasContestadas} sub="en el rango" color="success" />
            <KpiCard icon={PhoneMissed} label="Perdidas"  value={agg.llamadasPerdidas}    sub="en el rango" color="danger" />
          </div>

          {/* ── Mensajes por canal ── */}
          <div className="rounded-xl border border-dark-700 bg-dark-900 p-5">
            <p className="mb-4 text-sm font-semibold text-cream">Mensajes por canal</p>
            <div className="flex flex-col gap-3">
              <ChannelBar label="Correo"      icon={Mail}       value={agg.mensajesPorCanal.correo}     max={maxChannel} />
              <ChannelBar label="SMS"         icon={Smartphone} value={agg.mensajesPorCanal.sms}        max={maxChannel} />
              <ChannelBar label="WhatsApp QR" icon={MessageSquare} value={agg.mensajesPorCanal.whatsappQr} max={maxChannel} />
              <ChannelBar label="Otros"       icon={MessageSquare} value={agg.mensajesPorCanal.otros}    max={maxChannel} />
            </div>
          </div>

          {/* ── Notas por fecha ── */}
          <div className="rounded-xl border border-dark-700 bg-dark-900 overflow-hidden">
            <div className="px-5 py-3 border-b border-dark-700">
              <p className="text-sm font-semibold text-cream">Notas agregadas por fecha</p>
            </div>
            {agg.notasPorFecha.length === 0 ? (
              <p className="p-5 text-center text-sm text-cream-dim">Sin notas registradas en este rango.</p>
            ) : (
              <div className="max-h-80 overflow-y-auto divide-y divide-dark-700/50">
                {agg.notasPorFecha.map(({ date, count }) => (
                  <div key={date} className="flex items-center justify-between px-5 py-2.5">
                    <span className="text-sm text-cream-muted">
                      {new Date(date).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                    </span>
                    <span className="text-sm font-bold tabular-nums text-gold-400">{count} nota{count !== 1 ? "s" : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
