import { useMemo } from "react";
import { Phone, MessageSquare, CheckSquare, TrendingUp, Users, PhoneCall, PhoneMissed } from "lucide-react";
import { useData } from "../contexts/DataContext.jsx";
import KPICard from "../components/ui/KPICard.jsx";

// ── Barra de progreso mini ────────────────────────────────────────────────────
function MiniBar({ value, max, color = "bg-gold-500" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-dark-600">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right font-mono text-[11px] tabular-nums text-cream-muted">{pct}%</span>
    </div>
  );
}

// ── Celda numérica ────────────────────────────────────────────────────────────
function Num({ value, color = "text-cream" }) {
  return (
    <span className={`font-mono text-sm tabular-nums font-medium ${color}`}>
      {value ?? 0}
    </span>
  );
}

// ── Medalla de ranking ────────────────────────────────────────────────────────
function RankBadge({ rank }) {
  if (rank === 1) return <span title="1er lugar">🥇</span>;
  if (rank === 2) return <span title="2do lugar">🥈</span>;
  if (rank === 3) return <span title="3er lugar">🥉</span>;
  return <span className="font-mono text-[11px] text-cream-dim">#{rank}</span>;
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function ActividadView() {
  const { data, loading } = useData();

  const statsAgentes = data?.statsAgentes ?? {};
  const usuarios     = data?.usuarios ?? [];

  // Construir filas ordenadas por efectividad (llamadas contestadas % desc)
  const rows = useMemo(() => {
    return Object.entries(statsAgentes)
      .filter(([name]) => name !== "Sin asignar")
      .map(([name, s]) => {
        const pctContestacion = s.llamadasRealizadas > 0
          ? Math.round((s.llamadasContestadas / s.llamadasRealizadas) * 100)
          : null;
        return { name, ...s, pctContestacion };
      })
      .sort((a, b) => {
        // Ordenar por llamadas realizadas desc, luego por % contestación desc
        if (b.llamadasRealizadas !== a.llamadasRealizadas) return b.llamadasRealizadas - a.llamadasRealizadas;
        return (b.pctContestacion ?? 0) - (a.pctContestacion ?? 0);
      })
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }, [statsAgentes]);

  // KPIs de equipo
  const totals = useMemo(() => rows.reduce((acc, r) => ({
    llamadasRealizadas:  acc.llamadasRealizadas  + r.llamadasRealizadas,
    llamadasContestadas: acc.llamadasContestadas + r.llamadasContestadas,
    llamadasPerdidas:    acc.llamadasPerdidas    + r.llamadasPerdidas,
    mensajesEnviados:    acc.mensajesEnviados    + r.mensajesEnviados,
    mensajesNoLeidos:    acc.mensajesNoLeidos    + r.mensajesNoLeidos,
    tareasPendientes:    acc.tareasPendientes    + r.tareasPendientes,
    contactosAsignados:  acc.contactosAsignados  + r.contactosAsignados,
  }), {
    llamadasRealizadas: 0, llamadasContestadas: 0, llamadasPerdidas: 0,
    mensajesEnviados: 0, mensajesNoLeidos: 0, tareasPendientes: 0, contactosAsignados: 0,
  }), [rows]);

  const maxLlamadas  = Math.max(1, ...rows.map(r => r.llamadasRealizadas));
  const maxMensajes  = Math.max(1, ...rows.map(r => r.mensajesEnviados));

  const pctEquipo = totals.llamadasRealizadas > 0
    ? Math.round((totals.llamadasContestadas / totals.llamadasRealizadas) * 100)
    : 0;

  if (loading && rows.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-dark-600 border-t-gold-500" />
          <p className="text-sm text-cream-muted">Cargando actividad…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* KPI Cards del equipo */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KPICard icon={PhoneCall}    label="Llamadas realizadas"  value={totals.llamadasRealizadas}  color="gold"    />
        <KPICard icon={Phone}        label="Contestadas"          value={totals.llamadasContestadas} color="green"   sub={`${pctEquipo}% de efectividad`} />
        <KPICard icon={PhoneMissed}  label="Perdidas"             value={totals.llamadasPerdidas}    color="danger"  />
        <KPICard icon={MessageSquare}label="Mensajes enviados"    value={totals.mensajesEnviados}    color="blue"    />
        <KPICard icon={TrendingUp}   label="No leídos"            value={totals.mensajesNoLeidos}    color="orange"  />
        <KPICard icon={Users}        label="Asesores activos"     value={rows.length}                color="neutral" />
      </div>

      {/* Tabla de actividad por asesor */}
      <div className="rounded-xl border border-dark-700 bg-dark-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-dark-700 px-5 py-3.5">
          <h2 className="font-serif text-base font-semibold text-cream">Actividad por asesor</h2>
          <span className="text-xs text-cream-dim">{rows.length} asesores</span>
        </div>

        {rows.length === 0 ? (
          <div className="py-16 text-center text-cream-dim">
            Sin datos de actividad. Sincroniza para cargar conversaciones.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-dark-700/60">
                  {[
                    { label: "#",                  w: 48  },
                    { label: "Asesor",             w: 170 },
                    { label: "Llamadas",           w: 90  },
                    { label: "Contestadas",        w: 105 },
                    { label: "Perdidas",           w: 90  },
                    { label: "% Efect.",           w: 130 },
                    { label: "Msg. Enviados",      w: 115 },
                    { label: "No Leídos",          w: 100 },
                    { label: "Tareas",             w: 80  },
                    { label: "Contactos",          w: 90  },
                  ].map(col => (
                    <th
                      key={col.label}
                      style={{ width: col.w, minWidth: col.w }}
                      className="px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-cream-dim"
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name} className="border-b border-dark-700/40 last:border-0 hover:bg-dark-750 transition-colors">
                    {/* Rank */}
                    <td className="px-4 py-3 text-center">
                      <RankBadge rank={row.rank} />
                    </td>

                    {/* Nombre */}
                    <td className="px-4 py-3">
                      <span className="font-medium text-cream">{row.name}</span>
                    </td>

                    {/* Llamadas realizadas */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Num value={row.llamadasRealizadas} />
                        <div className="h-1 w-12 overflow-hidden rounded-full bg-dark-600">
                          <div
                            className="h-full rounded-full bg-gold-500/60"
                            style={{ width: `${Math.round((row.llamadasRealizadas / maxLlamadas) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Contestadas */}
                    <td className="px-4 py-3">
                      <Num value={row.llamadasContestadas} color="text-success-400" />
                    </td>

                    {/* Perdidas */}
                    <td className="px-4 py-3">
                      <Num value={row.llamadasPerdidas} color={row.llamadasPerdidas > 0 ? "text-danger-400" : "text-cream-dim"} />
                    </td>

                    {/* % Efectividad */}
                    <td className="px-4 py-3 pr-6">
                      {row.pctContestacion !== null ? (
                        <MiniBar
                          value={row.llamadasContestadas}
                          max={row.llamadasRealizadas}
                          color={row.pctContestacion >= 60 ? "bg-success-400" : row.pctContestacion >= 35 ? "bg-gold-500" : "bg-danger-400"}
                        />
                      ) : (
                        <span className="text-xs text-cream-dim">Sin datos</span>
                      )}
                    </td>

                    {/* Mensajes enviados */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Num value={row.mensajesEnviados} color="text-info-400" />
                        <div className="h-1 w-12 overflow-hidden rounded-full bg-dark-600">
                          <div
                            className="h-full rounded-full bg-info-400/50"
                            style={{ width: `${Math.round((row.mensajesEnviados / maxMensajes) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Mensajes no leídos */}
                    <td className="px-4 py-3">
                      {row.mensajesNoLeidos > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-warning-400/10 border border-warning-400/25 px-2 py-0.5 font-mono text-xs text-warning-400">
                          {row.mensajesNoLeidos}
                        </span>
                      ) : (
                        <Num value={0} color="text-cream-dim" />
                      )}
                    </td>

                    {/* Tareas */}
                    <td className="px-4 py-3">
                      {row.tareasPendientes > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-orange-400/10 border border-orange-400/25 px-2 py-0.5 font-mono text-xs text-orange-400">
                          {row.tareasPendientes}
                        </span>
                      ) : (
                        <Num value={0} color="text-cream-dim" />
                      )}
                    </td>

                    {/* Contactos asignados */}
                    <td className="px-4 py-3">
                      <Num value={row.contactosAsignados} color="text-cream-muted" />
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* Fila de totales */}
              {rows.length > 1 && (
                <tfoot>
                  <tr className="border-t border-dark-600 bg-dark-750">
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-cream-dim">
                      Total equipo
                    </td>
                    <td className="px-4 py-3"><Num value={totals.llamadasRealizadas} /></td>
                    <td className="px-4 py-3"><Num value={totals.llamadasContestadas} color="text-success-400" /></td>
                    <td className="px-4 py-3"><Num value={totals.llamadasPerdidas} color="text-danger-400" /></td>
                    <td className="px-4 py-3">
                      <MiniBar value={totals.llamadasContestadas} max={totals.llamadasRealizadas} color="bg-gold-500" />
                    </td>
                    <td className="px-4 py-3"><Num value={totals.mensajesEnviados} color="text-info-400" /></td>
                    <td className="px-4 py-3"><Num value={totals.mensajesNoLeidos} color="text-warning-400" /></td>
                    <td className="px-4 py-3"><Num value={totals.tareasPendientes} /></td>
                    <td className="px-4 py-3"><Num value={totals.contactosAsignados} /></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {/* Nota informativa sobre tareas */}
      <p className="text-[11px] text-cream-dim">
        * Las llamadas contestadas/perdidas se obtienen de los detalles de conversación (máx. 40 registros por sync).
        Las tareas requieren el endpoint <code className="font-mono">/tasks/search</code> activo en tu plan de GHL.
      </p>
    </div>
  );
}
