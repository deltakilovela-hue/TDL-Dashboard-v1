import { useMemo, useState } from "react";
import { MessageSquare, Phone, Inbox, Users, PhoneCall, ChevronDown, ChevronUp, Zap, Database } from "lucide-react";
import { useData } from "../contexts/DataContext.jsx";

// ── Suma stats de deep (históricas) para un asesor en el rango de fechas ──────
function sumDeepStats(deepStats, advisorName, from, to) {
  const advisorData = deepStats?.dailyStats?.[advisorName];
  if (!advisorData) return null;

  const result = { mensajesEnviados: 0, llamadas: 0, llamadasSalientes: 0, llamadasContestadas: 0, llamadasPerdidas: 0 };
  let found = false;

  // Iterar día a día dentro del rango
  const cursor = new Date(from);
  while (cursor <= to) {
    const key  = cursor.toISOString().split("T")[0];
    const day  = advisorData[key];
    if (day) {
      found = true;
      result.mensajesEnviados    += day.mensajesEnviados    || 0;
      result.llamadas            += day.llamadas            || 0;
      result.llamadasSalientes   += day.llamadasSalientes   || 0;
      result.llamadasContestadas += day.llamadasContestadas || 0;
      result.llamadasPerdidas    += day.llamadasPerdidas    || 0;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return found ? result : null;
}

// ── Campos del formulario ─────────────────────────────────────────────────────
const FORM_FIELDS = [
  { key: "nivelInteres",   label: "Nivel de interés"  },
  { key: "presupuesto",    label: "Presupuesto"        },
  { key: "financiamiento", label: "Financiamiento"     },
  { key: "deseaCita",      label: "¿Desea cita?"       },
  { key: "medioContacto",  label: "Medio de contacto"  },
];

function formScore(contact) {
  const filled = FORM_FIELDS.filter(f => {
    const v = contact[f.key];
    return v && v !== "(No hay datos)";
  }).length;
  return { filled, total: FORM_FIELDS.length, pct: Math.round((filled / FORM_FIELDS.length) * 100) };
}

// ── GHL lastMessageDirection puede ser string o número ────────────────────────
function isOutbound(dir) {
  if (dir === null || dir === undefined) return false;
  const d = String(dir).toLowerCase();
  return d === "outbound" || d === "1" || d === "type_outbound";
}
function isInbound(dir) {
  if (dir === null || dir === undefined) return false;
  const d = String(dir).toLowerCase();
  return d === "inbound" || d === "0" || d === "type_inbound";
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function initials(name) {
  return name.split(" ").filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join("");
}

function formatDate(str) {
  if (!str || str === "(No hay datos)") return "—";
  const d = new Date(str);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

const AVATAR_COLORS = [
  "bg-gold-500/20 text-gold-400 ring-gold-500/30",
  "bg-info-400/20 text-info-400 ring-info-400/30",
  "bg-success-400/20 text-success-400 ring-success-400/30",
  "bg-danger-400/20 text-danger-400 ring-danger-400/30",
  "bg-cream/10 text-cream ring-cream/20",
];

// ── Stat box ──────────────────────────────────────────────────────────────────
function Stat({ icon: Icon, label, value, color = "muted" }) {
  const valueClass =
    color === "gold"   ? "text-gold-400"   :
    color === "danger" ? "text-danger-400" :
    color === "green"  ? "text-success-400": "text-cream-dim";
  const iconClass =
    color === "gold"   ? "text-gold-400/50"   :
    color === "danger" ? "text-danger-400/50" :
    color === "green"  ? "text-success-400/50": "text-cream-dim/30";

  return (
    <div className="flex flex-1 flex-col items-center gap-1 rounded-lg bg-dark-800/60 px-2 py-3 min-w-[68px]">
      <Icon size={14} className={iconClass} />
      <span className={`text-2xl font-bold tabular-nums leading-none ${valueClass}`}>{value}</span>
      <span className="text-[10px] text-cream-dim text-center leading-tight">{label}</span>
    </div>
  );
}

// ── Barra del formulario ──────────────────────────────────────────────────────
function FormBar({ contacts }) {
  if (contacts.length === 0) return <p className="text-xs text-cream-dim">Sin contactos asignados</p>;

  const scores  = contacts.map(c => formScore(c));
  const avgPct  = Math.round(scores.reduce((s, x) => s + x.pct, 0) / scores.length);
  const avgFill = Math.round(scores.reduce((s, x) => s + x.filled, 0) / scores.length);
  const completos = contacts.filter(c => formScore(c).pct >= 80).length;

  const barColor  = avgPct >= 80 ? "bg-success-400" : avgPct >= 40 ? "bg-gold-500" : "bg-danger-400/70";
  const textColor = avgPct >= 80 ? "text-success-400" : avgPct >= 40 ? "text-gold-400" : "text-danger-400";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-cream-dim">Formulario promedio</span>
        <span className={textColor}>{avgFill}/{FORM_FIELDS.length} campos · {avgPct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-dark-700">
        <div className={`h-1.5 rounded-full transition-all ${barColor}`} style={{ width: `${avgPct}%` }} />
      </div>
      <p className="text-[11px] text-cream-dim">
        <span className={completos > 0 ? "text-cream" : ""}>{completos}</span> de {contacts.length} con formulario completo
      </p>
    </div>
  );
}

// ── Lista expandible de contactos ─────────────────────────────────────────────
function ContactList({ contacts }) {
  if (contacts.length === 0) return null;

  return (
    <div className="flex flex-col divide-y divide-dark-700/50 rounded-xl border border-dark-700 bg-dark-800/40 overflow-hidden">
      {contacts.map(c => {
        const score = formScore(c);
        const pctColor = score.pct >= 80 ? "text-success-400" : score.pct >= 40 ? "text-gold-400" : "text-danger-400";
        const barColor = score.pct >= 80 ? "bg-success-400" : score.pct >= 40 ? "bg-gold-500" : "bg-danger-400/70";
        const nombre   = `${c.firstName} ${c.lastName}`.trim() || "(Sin nombre)";

        return (
          <div key={c.id} className="flex items-center gap-3 px-3 py-2.5">
            {/* Nombre + teléfono */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-cream truncate">{nombre}</p>
              <p className="text-[11px] text-cream-dim font-mono">{c.phone !== "(No hay datos)" ? c.phone : "—"}</p>
            </div>

            {/* Pipeline */}
            {c.pipelineName !== "(No hay datos)" && (
              <span className="hidden sm:inline text-[10px] text-cream-dim bg-dark-700 rounded px-1.5 py-0.5 shrink-0 max-w-[110px] truncate">
                {c.pipelineName}
              </span>
            )}

            {/* Barra de formulario mini */}
            <div className="flex flex-col items-end gap-0.5 shrink-0 w-16">
              <span className={`text-[10px] font-medium ${pctColor}`}>{score.pct}%</span>
              <div className="h-1 w-14 rounded-full bg-dark-700">
                <div className={`h-1 rounded-full ${barColor}`} style={{ width: `${score.pct}%` }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Tarjeta de asesor ─────────────────────────────────────────────────────────
function AdvisorCard({ advisor, idx }) {
  const [expanded, setExpanded] = useState(false);
  const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length];
  const activo = advisor.mensajesEnviados > 0 || advisor.llamadas > 0;

  return (
    <div className="rounded-2xl border border-dark-700 bg-dark-900 overflow-hidden">
      <div className="p-5 flex flex-col gap-4">

        {/* Cabecera */}
        <div className="flex items-center gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-1 ${avatarColor} text-base font-bold`}>
            {initials(advisor.name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-cream truncate">{advisor.name}</p>
            <p className="text-xs text-cream-dim">{advisor.contacts.length} contactos asignados</p>
          </div>
          <span className={[
            "rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
            activo
              ? "bg-success-400/10 text-success-400 ring-success-400/20"
              : "bg-dark-700 text-cream-dim ring-dark-600",
          ].join(" ")}>
            {activo ? "Activo" : "Sin actividad"}
          </span>
        </div>

        {/* Stats */}
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-cream-dim">Actividad de la semana</p>
          <div className="flex gap-2">
            <Stat icon={MessageSquare} label="Msj. enviados"  value={advisor.mensajesEnviados}   color={advisor.mensajesEnviados > 0   ? "gold"   : "muted"} />
            <Stat icon={Inbox}         label="Sin leer"        value={advisor.mensajesPendientes}  color={advisor.mensajesPendientes > 0 ? "danger" : "muted"} />
            <Stat icon={Phone}         label="Llamadas"         value={advisor.llamadas}            color={advisor.llamadas > 0           ? "gold"   : "muted"} />
            <Stat icon={PhoneCall}     label="Salientes"        value={advisor.llamadasSalientes}   color={advisor.llamadasSalientes > 0  ? "green"  : "muted"} />
          </div>
        </div>

        {/* Formulario */}
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-cream-dim">Formulario de contactos</p>
          <FormBar contacts={advisor.contacts} />
        </div>
      </div>

      {/* Botón expandir */}
      {advisor.contacts.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex w-full items-center justify-between border-t border-dark-700/60 px-5 py-2.5 text-xs text-cream-muted transition-colors hover:bg-dark-800/40 hover:text-cream"
          >
            <span>{expanded ? "Ocultar" : "Ver"} {advisor.contacts.length} contactos</span>
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>

          {expanded && (
            <div className="px-4 pb-4">
              <ContactList contacts={advisor.contacts} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Vista principal ───────────────────────────────────────────────────────────
export default function AdvisorWeeklyView({ week }) {
  const { data, deepStats, loading, error } = useData();
  const usingDeep = !!deepStats?.dailyStats;

  const advisors = useMemo(() => {
    if (!data) return [];

    const contacts      = data.contacts      ?? [];
    const conversations = data.conversations ?? [];
    const usuarios      = data.usuarios      ?? [];

    // Conversaciones con actividad esta semana
    // lastMessageDate puede ser Unix ms (number) o ISO string
    const weekConvs = conversations.filter(c => {
      const raw = c.lastMessageDate;
      if (!raw) return false;
      const d = typeof raw === "number" ? new Date(raw) : new Date(raw);
      return !isNaN(d) && d >= week.from && d <= week.to;
    });

    // Acumular stats por asesor
    // IMPORTANTE: c.isCall viene ya calculado en sync.js — no recalcular aquí
    const activityMap = {};
    weekConvs.forEach(c => {
      const name = c.assignedToName || "(Sin asignar)";
      if (!activityMap[name]) activityMap[name] = {
        mensajesEnviados: 0, mensajesPendientes: 0,
        llamadas: 0, llamadasSalientes: 0,
      };
      if (c.isCall) {
        activityMap[name].llamadas++;
        if (isOutbound(c.lastMessageDirection)) activityMap[name].llamadasSalientes++;
      } else {
        if (isOutbound(c.lastMessageDirection)) activityMap[name].mensajesEnviados++;
        activityMap[name].mensajesPendientes += Number(c.unreadCount) || 0;
      }
    });

    // Contactos por asesor
    const contactsMap = {};
    contacts.forEach(c => {
      const name = c.assignedTo && c.assignedTo !== "(No hay datos)" ? c.assignedTo : "(Sin asignar)";
      if (!contactsMap[name]) contactsMap[name] = [];
      contactsMap[name].push(c);
    });

    const namesSet = new Set([
      ...usuarios.map(u => u.name).filter(Boolean),
      ...Object.keys(activityMap),
      ...Object.keys(contactsMap),
    ]);
    namesSet.delete("(Sin asignar)");

    return Array.from(namesSet)
      .map(name => {
        // Prioridad: datos históricos del job nocturno (precisos) > datos en tiempo real (aproximados)
        const deep = sumDeepStats(deepStats, name, week.from, week.to);
        const live = activityMap[name] || { mensajesEnviados: 0, mensajesPendientes: 0, llamadas: 0, llamadasSalientes: 0 };
        const act  = deep
          ? { ...live, mensajesEnviados: deep.mensajesEnviados, llamadas: deep.llamadas, llamadasSalientes: deep.llamadasSalientes, llamadasContestadas: deep.llamadasContestadas }
          : live;
        return { name, contacts: contactsMap[name] || [], ...act, hasDeepData: !!deep };
      })
      .sort((a, b) => {
        const sa = a.mensajesEnviados + a.llamadas;
        const sb = b.mensajesEnviados + b.llamadas;
        if (sb !== sa) return sb - sa;
        return a.name.localeCompare(b.name, "es");
      });
  }, [data, week]);

  const totals = useMemo(() => ({
    activos:    advisors.filter(a => a.mensajesEnviados + a.llamadas > 0).length,
    mensajes:   advisors.reduce((s, a) => s + a.mensajesEnviados,  0),
    pendientes: advisors.reduce((s, a) => s + a.mensajesPendientes, 0),
    llamadas:   advisors.reduce((s, a) => s + a.llamadas,           0),
  }), [advisors]);

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-dark-600 border-t-gold-500" />
          <p className="text-sm text-cream-muted">Cargando datos de GHL…</p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-danger-400">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: Users,         label: "Asesores activos",  value: totals.activos,    sub: `de ${advisors.length} en total` },
          { icon: MessageSquare, label: "Mensajes enviados", value: totals.mensajes,   sub: "esta semana" },
          { icon: Inbox,         label: "Sin leer",          value: totals.pendientes, sub: "pendientes",  warn: totals.pendientes > 0 },
          { icon: Phone,         label: "Llamadas",          value: totals.llamadas,   sub: "esta semana" },
        ].map(({ icon: Icon, label, value, sub, warn }) => (
          <div key={label} className="rounded-xl border border-dark-700 bg-dark-900 p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-cream-dim">{label}</p>
                <p className={`mt-1 text-3xl font-bold tabular-nums ${warn ? "text-danger-400" : "text-cream"}`}>{value}</p>
                <p className="mt-0.5 text-xs text-cream-dim">{sub}</p>
              </div>
              <div className={`rounded-lg p-2 ${warn ? "bg-danger-400/10" : "bg-dark-800"}`}>
                <Icon size={16} className={warn ? "text-danger-400" : "text-cream-muted"} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Indicador de fuente de datos */}
      <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
        usingDeep
          ? "border-success-400/20 bg-success-400/5 text-success-400"
          : "border-gold-500/20 bg-gold-500/5 text-gold-400"
      }`}>
        {usingDeep
          ? <><Database size={13} /> <span><strong>Datos históricos activos</strong> — estadísticas exactas del job nocturno ({deepStats?.updatedAt ? new Date(deepStats.updatedAt).toLocaleDateString("es-MX") : ""})</span></>
          : <><Zap size={13} /> <span><strong>Datos en tiempo real</strong> — aproximación basada en el último mensaje de cada conversación. Para datos exactos, configura el job nocturno de GitHub Actions.</span></>
        }
      </div>

      {/* Tarjetas */}
      {advisors.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-xl border border-dark-700 bg-dark-900">
          <p className="text-sm text-cream-dim">Sin datos. Presiona Sincronizar.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {advisors.map((advisor, i) => (
            <AdvisorCard key={advisor.name} advisor={advisor} idx={i} />
          ))}
        </div>
      )}

    </div>
  );
}
