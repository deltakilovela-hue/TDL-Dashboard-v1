import { useMemo, useState, useEffect } from "react";
import { MessageSquare, Phone, Inbox, Users, PhoneCall, ChevronDown, ChevronUp, Zap, Database, X, TrendingUp, FileText, Calendar, CheckCircle, XCircle, AlertCircle, Clock } from "lucide-react";
import { useData } from "../contexts/DataContext.jsx";
import ContactModal from "../components/ContactModal.jsx";

// ── Configuración de roles ────────────────────────────────────────────────────
// Usuarios que NO son asesores de ventas (ocultar del dashboard)
const EXCLUDED_USERS = new Set([
  "Alma Benitez",
  "Javier Vendedor",
  "Jonathan vendedor vendedor",
  "Robert Merca",
]);

// Usuarios con rol de administrador (muestran insignia especial)
const ADMIN_USERS = new Set([
  "Jonathan Delta Kilo",
  "Fernanda Valdez",
  "Nanncy Meza",
]);

// ── Helpers de presupuesto ────────────────────────────────────────────────────
function parsePresupuesto(v) {
  if (!v || v === "(No hay datos)") return 0;
  const s = String(v).toLowerCase().replace(/[$,\s]/g, "");
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  if (s.endsWith("m")) return n * 1_000_000;
  if (s.endsWith("k")) return n * 1_000;
  return n;
}
function formatCurrency(n) {
  if (n <= 0) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toLocaleString("es-MX")}`;
}

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

// ── Construir historial semana a semana desde deepStats ───────────────────────
function getWeekOf(anchor) {
  const d   = new Date(anchor);
  const day = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  return { from: mon, to: sun };
}

function buildWeeklyHistory(deepStats, advisorName, daysBack = 90) {
  const advisorData = deepStats?.dailyStats?.[advisorName];
  if (!advisorData) return [];

  const today   = new Date();
  const earliest = new Date(today.getTime() - daysBack * 86_400_000);
  const firstWeek = getWeekOf(earliest);

  const weeks = [];
  const cursor = new Date(firstWeek.from);

  while (cursor <= today) {
    const weekFrom = new Date(cursor);
    const weekTo   = new Date(cursor);
    weekTo.setDate(cursor.getDate() + 6);
    weekTo.setHours(23, 59, 59, 999);

    const stats = { mensajesEnviados: 0, llamadas: 0, llamadasSalientes: 0, llamadasContestadas: 0, llamadasPerdidas: 0 };
    let hasData = false;

    const c = new Date(weekFrom);
    while (c <= weekTo && c <= today) {
      const key = c.toISOString().split("T")[0];
      const day = advisorData[key];
      if (day) {
        hasData = true;
        stats.mensajesEnviados    += day.mensajesEnviados    || 0;
        stats.llamadas            += day.llamadas            || 0;
        stats.llamadasSalientes   += day.llamadasSalientes   || 0;
        stats.llamadasContestadas += day.llamadasContestadas || 0;
        stats.llamadasPerdidas    += day.llamadasPerdidas    || 0;
      }
      c.setDate(c.getDate() + 1);
    }

    weeks.push({ from: weekFrom, to: weekTo, ...stats, hasData });
    cursor.setDate(cursor.getDate() + 7);
  }

  return weeks.reverse(); // más reciente primero
}

function formatWeekRange(from, to) {
  const opts = { day: "numeric", month: "short" };
  return `${from.toLocaleDateString("es-MX", opts)} – ${to.toLocaleDateString("es-MX", { day: "numeric", month: "short" })}`;
}

// ── Historial semanal de un asesor ────────────────────────────────────────────
function AdvisorHistory({ advisorName, deepStats, currentWeek, onWeekClick }) {
  const weeks = useMemo(
    () => buildWeeklyHistory(deepStats, advisorName),
    [deepStats, advisorName]
  );

  if (!deepStats?.dailyStats) {
    return (
      <div className="rounded-xl border border-gold-500/20 bg-gold-500/5 p-4 text-sm text-gold-400">
        <Zap size={13} className="inline mr-1" />
        El historial semana a semana requiere el job nocturno de GitHub Actions.
      </div>
    );
  }

  const activeWeeks = weeks.filter(w => w.hasData);
  if (activeWeeks.length === 0) {
    return (
      <div className="rounded-xl border border-dark-700 bg-dark-900 p-6 text-center text-sm text-cream-dim">
        Sin actividad registrada en los últimos 90 días para <strong className="text-cream">{advisorName}</strong>.
      </div>
    );
  }

  // Máximos para escalar las barras
  const maxMsg  = Math.max(...weeks.map(w => w.mensajesEnviados), 1);
  const maxCall = Math.max(...weeks.map(w => w.llamadas), 1);

  const isCurrentWeekFn = (w) =>
    w.from.toDateString() === currentWeek.from.toDateString();

  return (
    <div className="rounded-2xl border border-dark-700 bg-dark-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-dark-700">
        <TrendingUp size={15} className="text-gold-400" />
        <div>
          <p className="font-semibold text-cream">{advisorName}</p>
          <p className="text-xs text-cream-dim">Historial de actividad — últimas {weeks.length} semanas</p>
        </div>
        <div className="ml-auto flex items-center gap-4 text-[11px] text-cream-dim">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-gold-500/60 inline-block" /> Mensajes</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-info-400/60 inline-block" /> Llamadas</span>
        </div>
      </div>

      {/* Tabla / barras */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-cream-dim border-b border-dark-700/60">
              <th className="text-left px-5 py-2.5 font-medium">Semana</th>
              <th className="text-right px-3 py-2.5 font-medium w-20">Msj.</th>
              <th className="px-3 py-2.5 w-40 hidden md:table-cell"></th>
              <th className="text-right px-3 py-2.5 font-medium w-20">Llamadas</th>
              <th className="px-3 py-2.5 w-40 hidden md:table-cell"></th>
              <th className="text-right px-3 py-2.5 font-medium w-20">Contest.</th>
              <th className="text-right px-3 py-2.5 font-medium w-20">Perdidas</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w, i) => {
              const isCurrent = isCurrentWeekFn(w);
              const msgPct  = Math.round((w.mensajesEnviados / maxMsg)  * 100);
              const callPct = Math.round((w.llamadas         / maxCall) * 100);

              return (
                <tr
                  key={i}
                  onClick={() => w.hasData && onWeekClick && onWeekClick(w)}
                  className={[
                    "border-b border-dark-700/40 transition-colors",
                    isCurrent ? "bg-gold-500/8 border-l-2 border-l-gold-500" : "",
                    w.hasData ? "cursor-pointer hover:bg-dark-800/60" : "opacity-40",
                  ].join(" ")}
                >
                  {/* Semana */}
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      {isCurrent && <span className="text-[9px] bg-gold-500/20 text-gold-400 px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wide">Actual</span>}
                      <span className={`text-xs ${isCurrent ? "text-gold-300 font-medium" : "text-cream-dim"}`}>
                        {formatWeekRange(w.from, w.to)}
                      </span>
                    </div>
                  </td>

                  {/* Mensajes count */}
                  <td className="px-3 py-3 text-right">
                    <span className={`text-sm font-bold tabular-nums ${w.mensajesEnviados > 0 ? "text-gold-400" : "text-cream-dim"}`}>
                      {w.mensajesEnviados}
                    </span>
                  </td>

                  {/* Barra mensajes */}
                  <td className="px-3 py-3 hidden md:table-cell">
                    <div className="h-2 w-full rounded-full bg-dark-700">
                      <div
                        className="h-2 rounded-full bg-gold-500/60 transition-all"
                        style={{ width: `${msgPct}%` }}
                      />
                    </div>
                  </td>

                  {/* Llamadas count */}
                  <td className="px-3 py-3 text-right">
                    <span className={`text-sm font-bold tabular-nums ${w.llamadas > 0 ? "text-info-400" : "text-cream-dim"}`}>
                      {w.llamadas}
                    </span>
                  </td>

                  {/* Barra llamadas */}
                  <td className="px-3 py-3 hidden md:table-cell">
                    <div className="h-2 w-full rounded-full bg-dark-700">
                      <div
                        className="h-2 rounded-full bg-info-400/60 transition-all"
                        style={{ width: `${callPct}%` }}
                      />
                    </div>
                  </td>

                  {/* Contestadas */}
                  <td className="px-3 py-3 text-right">
                    <span className={`text-sm font-bold tabular-nums ${w.llamadasContestadas > 0 ? "text-success-400" : "text-cream-dim"}`}>
                      {w.llamadasContestadas}
                    </span>
                  </td>

                  {/* Perdidas */}
                  <td className="px-3 py-3 text-right">
                    <span className={`text-sm font-bold tabular-nums ${w.llamadasPerdidas > 0 ? "text-danger-400" : "text-cream-dim"}`}>
                      {w.llamadasPerdidas}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Totales 90 días */}
      <div className="flex flex-wrap gap-4 px-5 py-3 border-t border-dark-700/60 bg-dark-800/30 text-xs text-cream-dim">
        <span>90 días: </span>
        <span className="text-gold-400 font-medium">{activeWeeks.reduce((s, w) => s + w.mensajesEnviados, 0)} mensajes</span>
        <span className="text-info-400 font-medium">{activeWeeks.reduce((s, w) => s + w.llamadas, 0)} llamadas</span>
        <span className="text-success-400 font-medium">{activeWeeks.reduce((s, w) => s + w.llamadasContestadas, 0)} contestadas</span>
        <span className="text-danger-400 font-medium">{activeWeeks.reduce((s, w) => s + w.llamadasPerdidas, 0)} perdidas</span>
      </div>
    </div>
  );
}

// ── Campos de ambas encuestas (para calcular completion en la tarjeta) ────────
const FIELDS_PC = [
  { key: "requieroMasTiempo"  },
  { key: "medioContacto"      },
  { key: "nivelInteres"       },
  { key: "deseaCita"          },
  { key: "presupuesto"        },
  { key: "financiamiento"     },
  { key: "notaPrimerContacto" },
  { key: "funciones"          },
  { key: "notaSeguimiento"    },
];
const FIELDS_CIERRE = [
  { key: "necesitaMasTiempo"  },
  { key: "descartado"         },
  { key: "sePresentoCita"     },
  { key: "tipoCita"           },
  { key: "nivelInteresPost"   },
  { key: "queFaltaCerrar"     },
  { key: "requiereCloser"     },
  { key: "fechaSeguimiento"   },
  { key: "notaCierre"         },
];
const ALL_FORM_FIELDS = [...FIELDS_PC, ...FIELDS_CIERRE];

// ── Campos de notas de actividad ──────────────────────────────────────────────
const NOTE_FIELDS = [
  { key: "notaPrimerContacto" },
  { key: "notaSeguimiento"    },
  { key: "notaCierre"         },
];

function hasValue(v) { return v && v !== "(No hay datos)"; }

function formScore(contact) {
  const pcFilled     = FIELDS_PC.filter(f => hasValue(contact[f.key])).length;
  const cierreFilled = FIELDS_CIERRE.filter(f => hasValue(contact[f.key])).length;
  const filled = pcFilled + cierreFilled;
  const total  = ALL_FORM_FIELDS.length;
  return {
    filled, total,
    pct: Math.round((filled / total) * 100),
    pcFilled, pcTotal: FIELDS_PC.length,
    cierreFilled, cierreTotal: FIELDS_CIERRE.length,
  };
}

// Cuántas notas tiene llenadas este contacto
function noteScore(contact) {
  return NOTE_FIELDS.filter(f => hasValue(contact[f.key])).length;
}

// ── Filtro de mensajes automáticos / bots ────────────────────────────────────
// Excluye mensajes de sistema, NancyBot y secuencias de nutrición automatizada.
// Agrega más patrones aquí cuando sea necesario.
const AUTO_PATTERNS = [
  // ── Mensajes de sistema GHL ──────────────────────────────────────────────────
  /^opportunity status changed$/i,
  /^opportunity updated$/i,
  /^opportunity created$/i,
  /^opportunity deleted$/i,
  /^contact updated$/i,
  /^appointment scheduled$/i,
  /^appointment cancelled$/i,

  // ── Flujos de re-engagement automáticos ─────────────────────────────────────
  /veo que no pudiste asistir a la cita/i,
  /te gustar[ií]a re-?agendar/i,
  /perdiste tu cita/i,

  // ── Renders / imágenes automáticas (Wayak, Oasis Ananta, etc.) ──────────────
  /wayak\s*\|.*render ilustrativo/i,
  /\(render ilustrativo\)/i,          // cubre cualquier render futuro
  /vista posterior de oasis/i,

  // ── NancyBot — nombre y cargo ────────────────────────────────────────────────
  /soy\s+\*?nancy\*?/i,
  /coordinadora comercial/i,
  /coordinadora comercial de \*?taller del ladrillo\*?/i,

  // ── NancyBot — plantillas de presentación ───────────────────────────────────
  /estoy aquí para cuando quieras seguir con la información/i,
  /te presento a \*?.+\*?\s+tu asesor/i,
  /(?:oasis ananta|taller del ladrillo).*(?:frente al mar|preventa|mazatl[aá]n)/i,

  // ── Secuencias de nutrición automatizada ────────────────────────────────────
  /recientemente te contact[eé] referente/i,
  /sigo sin poder conversar contigo referente/i,
  /para enviarte\s*(la información|opciones|los detalles)/i,

  // ── Saludos/presentaciones de bot con frases fijas ───────────────────────────
  /hola,?\s+vi que te interesaste en/i,
  /quedo\s+(al pendiente|a tus órdenes|a la orden)\s+para\s+cualquier\s+duda/i,
];

function isAutoMessage(text) {
  if (!text || !text.trim()) return false;
  const t = text.trim();
  return AUTO_PATTERNS.some(p => p.test(t));
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

// ── Estados de cita ───────────────────────────────────────────────────────────
const APPT_STATUS_MAP = {
  confirmed: { label: "Confirmada",    color: "bg-info-400/15 text-info-300 border-info-400/30",       icon: Clock },
  new:       { label: "Nueva",         color: "bg-info-400/15 text-info-300 border-info-400/30",       icon: Clock },
  showed:    { label: "Se presentó",   color: "bg-success-400/15 text-success-300 border-success-400/30", icon: CheckCircle },
  "no-show": { label: "No show",       color: "bg-danger-400/15 text-danger-300 border-danger-400/30", icon: XCircle },
  noshow:    { label: "No show",       color: "bg-danger-400/15 text-danger-300 border-danger-400/30", icon: XCircle },
  cancelled: { label: "Cancelada",     color: "bg-dark-700 text-cream-dim border-dark-600",             icon: XCircle },
  default:   { label: "Programada",   color: "bg-dark-700 text-cream-dim border-dark-600",             icon: AlertCircle },
};

function ApptBadge({ status }) {
  const s = APPT_STATUS_MAP[status] || APPT_STATUS_MAP.default;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium rounded-full border px-1.5 py-0.5 ${s.color}`}>
      <Icon size={9} />
      {s.label}
    </span>
  );
}

function formatTime(str) {
  if (!str) return "—";
  const d = new Date(str);
  if (isNaN(d)) return "—";
  return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

// ── Lista de citas del asesor ─────────────────────────────────────────────────
function AppointmentsList({ appointments }) {
  const [collapsed, setCollapsed] = useState(true);

  if (!appointments || appointments.length === 0) return null;

  const showed    = appointments.filter(a => a.status === "showed").length;
  const noShow    = appointments.filter(a => a.status === "no-show" || a.status === "noshow").length;
  const cancelled = appointments.filter(a => a.status === "cancelled").length;
  const pending   = appointments.filter(a => a.status === "confirmed" || a.status === "new").length;

  const visible = collapsed ? appointments.slice(0, 3) : appointments;

  return (
    <div className="rounded-xl border border-dark-700 bg-dark-800/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-dark-700/60">
        <Calendar size={12} className="text-gold-400 shrink-0" />
        <span className="text-[11px] font-semibold text-cream-dim uppercase tracking-wide flex-1">
          Citas de la semana
        </span>
        <div className="flex items-center gap-1.5 text-[10px]">
          {showed    > 0 && <span className="text-success-400">{showed}✓</span>}
          {noShow    > 0 && <span className="text-danger-400">{noShow}✗</span>}
          {cancelled > 0 && <span className="text-cream-dim">{cancelled} cancel.</span>}
          {pending   > 0 && <span className="text-info-300">{pending} conf.</span>}
        </div>
      </div>

      {/* Lista */}
      <div className="divide-y divide-dark-700/40">
        {visible.map((a, i) => (
          <div key={a.id || i} className="flex items-center gap-2 px-3 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-cream truncate">
                {a.contactName || a.title || "(Sin nombre)"}
              </p>
              {a.calendarName && (
                <p className="text-[10px] text-cream-dim truncate">{a.calendarName}</p>
              )}
            </div>
            <span className="text-[10px] text-cream-dim tabular-nums shrink-0">{formatTime(a.startTime)}</span>
            <ApptBadge status={a.status} />
          </div>
        ))}
      </div>

      {/* Ver más */}
      {appointments.length > 3 && (
        <button
          onClick={() => setCollapsed(c => !c)}
          className="flex w-full items-center justify-center gap-1 py-1.5 text-[11px] text-cream-dim hover:text-cream border-t border-dark-700/60 transition-colors"
        >
          {collapsed
            ? <><ChevronDown size={11} /> Ver {appointments.length - 3} más</>
            : <><ChevronUp size={11} /> Mostrar menos</>}
        </button>
      )}
    </div>
  );
}

// ── Stat box ──────────────────────────────────────────────────────────────────
function Stat({ icon: Icon, label, value, color = "muted", onClick }) {
  const valueClass =
    color === "gold"   ? "text-gold-400"   :
    color === "danger" ? "text-danger-400" :
    color === "green"  ? "text-success-400": "text-cream-dim";
  const iconClass =
    color === "gold"   ? "text-gold-400/50"   :
    color === "danger" ? "text-danger-400/50" :
    color === "green"  ? "text-success-400/50": "text-cream-dim/30";

  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={[
        "flex flex-1 flex-col items-center gap-1 rounded-lg bg-dark-800/60 px-2 py-3 min-w-[68px]",
        onClick ? "cursor-pointer hover:bg-dark-700/80 active:scale-95 transition-all" : "",
      ].join(" ")}
    >
      <Icon size={14} className={iconClass} />
      <span className={`text-2xl font-bold tabular-nums leading-none ${valueClass}`}>{value}</span>
      <span className="text-[10px] text-cream-dim text-center leading-tight">{label}</span>
    </Tag>
  );
}

// ── Barra del formulario ──────────────────────────────────────────────────────
function FormBar({ contacts }) {
  if (contacts.length === 0) return <p className="text-xs text-cream-dim">Sin contactos asignados</p>;

  const scores = contacts.map(c => formScore(c));

  const avgPC        = Math.round(scores.reduce((s, x) => s + x.pcFilled,     0) / scores.length);
  const avgCierre    = Math.round(scores.reduce((s, x) => s + x.cierreFilled, 0) / scores.length);
  const avgPCpct     = Math.round((avgPC     / FIELDS_PC.length)     * 100);
  const avgCierrepct = Math.round((avgCierre / FIELDS_CIERRE.length) * 100);
  const completos    = contacts.filter(c => formScore(c).pct >= 80).length;

  const barPC     = avgPCpct     >= 80 ? "bg-success-400" : avgPCpct     >= 40 ? "bg-gold-500" : "bg-danger-400/70";
  const barCierre = avgCierrepct >= 80 ? "bg-success-400" : avgCierrepct >= 40 ? "bg-gold-500" : "bg-danger-400/70";
  const txtPC     = avgPCpct     >= 80 ? "text-success-400" : avgPCpct     >= 40 ? "text-gold-400" : "text-danger-400";
  const txtCierre = avgCierrepct >= 80 ? "text-success-400" : avgCierrepct >= 40 ? "text-gold-400" : "text-danger-400";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-cream-dim">Enc. Primer Contacto</span>
          <span className={txtPC}>{avgPC}/{FIELDS_PC.length} · {avgPCpct}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-dark-700">
          <div className={`h-1.5 rounded-full transition-all ${barPC}`} style={{ width: `${avgPCpct}%` }} />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-cream-dim">Enc. Cierre Comercial</span>
          <span className={txtCierre}>{avgCierre}/{FIELDS_CIERRE.length} · {avgCierrepct}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-dark-700">
          <div className={`h-1.5 rounded-full transition-all ${barCierre}`} style={{ width: `${avgCierrepct}%` }} />
        </div>
      </div>
      <p className="text-[11px] text-cream-dim">
        <span className={completos > 0 ? "text-cream" : ""}>{completos}</span> de {contacts.length} con ambas encuestas completas
      </p>
    </div>
  );
}

// ── Lista expandible de contactos ─────────────────────────────────────────────
function ContactList({ contacts, onSelectContact }) {
  if (contacts.length === 0) return null;

  return (
    <div className="flex flex-col divide-y divide-dark-700/50 rounded-xl border border-dark-700 bg-dark-800/40 overflow-hidden">
      {contacts.map(c => {
        const score    = formScore(c);
        const pcPct    = Math.round((score.pcFilled     / FIELDS_PC.length)     * 100);
        const cierrePct= Math.round((score.cierreFilled / FIELDS_CIERRE.length) * 100);
        const barPC    = pcPct     >= 80 ? "bg-success-400" : pcPct     >= 40 ? "bg-gold-500" : "bg-danger-400/70";
        const barCierre= cierrePct >= 80 ? "bg-success-400" : cierrePct >= 40 ? "bg-gold-500" : "bg-danger-400/70";
        const nombre   = `${c.firstName} ${c.lastName}`.trim() || "(Sin nombre)";

        return (
          <button
            key={c.id}
            onClick={() => onSelectContact(c)}
            className="flex items-center gap-3 px-3 py-2.5 w-full text-left transition-colors hover:bg-dark-700/40 active:bg-dark-700/60"
          >
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

            {/* Barras PC + Cierre */}
            <div className="flex flex-col gap-0.5 shrink-0 w-20">
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-cream-dim w-5">PC</span>
                <div className="h-1 flex-1 rounded-full bg-dark-700">
                  <div className={`h-1 rounded-full ${barPC}`} style={{ width: `${pcPct}%` }} />
                </div>
                <span className="text-[9px] text-cream-dim w-6 text-right">{pcPct}%</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-cream-dim w-5">CC</span>
                <div className="h-1 flex-1 rounded-full bg-dark-700">
                  <div className={`h-1 rounded-full ${barCierre}`} style={{ width: `${cierrePct}%` }} />
                </div>
                <span className="text-[9px] text-cream-dim w-6 text-right">{cierrePct}%</span>
              </div>
            </div>

            {/* Indicador de clickeable */}
            <span className="text-zinc-600 text-[10px] shrink-0">›</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Modal de notas del asesor ─────────────────────────────────────────────────
const NOTE_KEYS = [
  { key: "notaPrimerContacto", label: "Primer contacto" },
  { key: "notaSeguimiento",    label: "Seguimiento"     },
  { key: "notaCierre",         label: "Cierre"          },
];

function AdvisorNotesModal({ advisor, onClose }) {
  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const contactsWithNotes = advisor.contacts.filter(c =>
    NOTE_KEYS.some(n => hasValue(c[n.key])) || hasValue(c.historialNotas)
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-2xl border border-dark-700 bg-dark-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-dark-700 shrink-0">
          <FileText size={15} className="text-gold-400" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-cream">Notas — {advisor.name}</p>
            <p className="text-xs text-cream-dim">
              {contactsWithNotes.length} contacto(s) con notas registradas · Total: {advisor.sumaNotas || 0} notas GHL
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 h-8 w-8 flex items-center justify-center rounded-full hover:bg-dark-800 text-cream-dim hover:text-cream transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {contactsWithNotes.length === 0 ? (
            <p className="text-center text-sm text-cream-dim py-8">Sin notas registradas en campos de encuesta</p>
          ) : (
            contactsWithNotes.map(c => {
              const nombre = `${c.firstName} ${c.lastName}`.trim() || "(Sin nombre)";
              return (
                <div key={c.id} className="rounded-xl border border-dark-700 bg-dark-800/40 overflow-hidden">
                  {/* Contacto header */}
                  <div className="flex items-center gap-2 px-3 py-2 bg-dark-800/60 border-b border-dark-700/60">
                    <span className="text-xs font-semibold text-cream">{nombre}</span>
                    {c.phone && c.phone !== "(No hay datos)" && (
                      <span className="text-[10px] text-cream-dim font-mono">{c.phone}</span>
                    )}
                    {hasValue(c.sumaNotas) && (
                      <span className="ml-auto text-[10px] text-gold-400">{c.sumaNotas} notas</span>
                    )}
                  </div>
                  {/* Notas de encuesta */}
                  <div className="divide-y divide-dark-700/40">
                    {NOTE_KEYS.map(n => hasValue(c[n.key]) && (
                      <div key={n.key} className="flex gap-3 px-3 py-2.5">
                        <span className="text-[11px] text-cream-dim shrink-0 w-28">{n.label}</span>
                        <p className="text-xs text-cream-muted leading-relaxed">{c[n.key]}</p>
                      </div>
                    ))}
                    {hasValue(c.historialNotas) && (
                      <div className="px-3 py-2.5">
                        <p className="text-[11px] text-cream-dim mb-1">Historial GHL</p>
                        <p className="text-xs text-cream-muted leading-relaxed whitespace-pre-wrap">{c.historialNotas}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ── Modal de actividad (llamadas / mensajes) del asesor ──────────────────────
function AdvisorActivityModal({ advisor, type, onClose, onSelectContact }) {
  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const isCalls         = type === "calls";
  const Icon            = isCalls ? Phone : MessageSquare;
  const title           = isCalls ? "Llamadas" : "Mensajes enviados";
  const crossedContacts = isCalls ? advisor.calledContacts : advisor.messagedContacts;
  // Si el cruce conv↔contacto está vacío, usar fallback filtrado por semana (ya pre-computado)
  const useFallback     = crossedContacts.length === 0;
  const contacts        = useFallback ? (advisor.weekContacts || []) : crossedContacts;
  const actCount        = isCalls ? advisor.llamadas : advisor.mensajesEnviados;
  const countLabel      = `${contacts.length} contacto(s) · ${actCount} ${isCalls ? "llamada(s)" : "mensaje(s)"} esta semana`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md max-h-[80vh] flex flex-col rounded-2xl border border-dark-700 bg-dark-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-dark-700 shrink-0">
          <Icon size={15} className="text-gold-400" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-cream">{title} — {advisor.name}</p>
            <p className="text-xs text-cream-dim">{countLabel}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-full hover:bg-dark-800 text-cream-dim hover:text-cream transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Aviso fallback */}
        {useFallback && contacts.length > 0 && (
          <div className="px-4 py-2 bg-gold-500/10 border-b border-gold-500/20 shrink-0">
            <p className="text-[11px] text-gold-400">⚠ Sin datos de conversación. Mostrando contactos con actividad en la semana (por fecha de actualización).</p>
          </div>
        )}

        {/* Lista de contactos */}
        <div className="flex-1 overflow-y-auto divide-y divide-dark-700/50">
          {contacts.length === 0 ? (
            <p className="text-center text-sm text-cream-dim py-10">Sin contactos asignados</p>
          ) : (
            contacts.map(({ contact: c, body, date }) => {
              const nombre  = `${c.firstName || ""} ${c.lastName || ""}`.trim() || "(Sin nombre)";
              const dateStr = date ? new Date(date).toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) : null;
              return (
                <button
                  key={c.id}
                  onClick={() => { onSelectContact(c); onClose(); }}
                  className="flex items-start gap-3 w-full px-4 py-3 text-left hover:bg-dark-800/50 active:bg-dark-800/80 transition-colors"
                >
                  {/* Iniciales */}
                  <div className="shrink-0 h-9 w-9 rounded-full bg-dark-700 flex items-center justify-center text-[11px] font-bold text-cream-dim mt-0.5">
                    {initials(nombre)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <p className="text-sm font-medium text-cream truncate">{nombre}</p>
                      {dateStr && <span className="text-[10px] text-cream-dim shrink-0">{dateStr}</span>}
                    </div>
                    <p className="text-xs text-cream-dim font-mono mb-1">
                      {c.phone && c.phone !== "(No hay datos)" ? c.phone : "Sin teléfono"}
                    </p>
                    {body ? (
                      <p className="text-xs text-cream-muted leading-relaxed line-clamp-2 bg-dark-800/60 rounded px-2 py-1">
                        {body}
                      </p>
                    ) : (
                      <p className="text-xs text-cream-dim/50 italic">Sin texto disponible</p>
                    )}
                  </div>
                  <span className="text-zinc-600 text-xs shrink-0 mt-1">›</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tarjeta de asesor ─────────────────────────────────────────────────────────
function AdvisorCard({ advisor, idx, onSelectContact, appointments = [], onShowNotes, onShowCalls, onShowMessages }) {
  const [expanded, setExpanded] = useState(false);
  const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length];
  const activo = advisor.mensajesEnviados > 0 || advisor.llamadas > 0;

  const citasCount  = appointments.length;
  const citasShowed = appointments.filter(a => a.status === "showed").length;
  const citasNoShow = appointments.filter(a => ["no-show","noshow"].includes(a.status)).length;

  // Sumatoria de presupuesto de contactos asignados
  const presupuestoTotal  = advisor.contacts.reduce((s, c) => s + parsePresupuesto(c.presupuesto), 0);
  const presupuestoStr    = formatCurrency(presupuestoTotal);
  const presupuestoCount  = advisor.contacts.filter(c => hasValue(c.presupuesto)).length;

  return (
    <div className="rounded-2xl border border-dark-700 bg-dark-900 overflow-hidden">
      <div className="p-5 flex flex-col gap-4">

        {/* Cabecera */}
        <div className="flex items-center gap-3">
          {/* Avatar con corona si es admin */}
          <div className="relative shrink-0">
            <div className={`flex h-11 w-11 items-center justify-center rounded-full ring-1 ${avatarColor} text-base font-bold`}>
              {initials(advisor.name)}
            </div>
            {ADMIN_USERS.has(advisor.name) && (
              <span className="absolute -top-1.5 -right-1.5 text-[13px]" title="Administrador">👑</span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="font-semibold text-cream truncate">{advisor.name}</p>
              {ADMIN_USERS.has(advisor.name) && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-gold-500/15 text-gold-400 border border-gold-500/30 rounded-full px-1.5 py-0.5 shrink-0">
                  ✦ Admin
                </span>
              )}
            </div>
            <p className="text-xs text-cream-dim">{advisor.contacts.length} contactos asignados</p>
          </div>
          <span className={[
            "rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 shrink-0",
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
          <div className="flex gap-1.5 flex-wrap">
            <Stat
              icon={MessageSquare}
              label="Msj. enviados"
              value={advisor.mensajesEnviados}
              color={advisor.mensajesEnviados > 0 ? "gold" : "muted"}
              onClick={advisor.mensajesEnviados > 0 ? () => onShowMessages(advisor) : undefined}
            />
            <Stat icon={Inbox}         label="Sin leer"        value={advisor.mensajesPendientes} color={advisor.mensajesPendientes > 0 ? "danger" : "muted"} />
            <Stat
              icon={Phone}
              label="Llamadas"
              value={advisor.llamadas}
              color={advisor.llamadas > 0 ? "gold" : "muted"}
              onClick={advisor.llamadas > 0 ? () => onShowCalls(advisor) : undefined}
            />
            <Stat
              icon={FileText}
              label="Notas reg."
              value={advisor.sumaNotas || 0}
              color={advisor.sumaNotas > 0 ? "gold" : "muted"}
              onClick={advisor.sumaNotas > 0 ? () => onShowNotes(advisor) : undefined}
            />
            <Stat icon={Calendar}      label="Citas"           value={citasCount}                 color={citasCount > 0                 ? "gold"   : "muted"} />
          </div>
          {/* Mini resumen de citas y presupuesto */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1">
            {citasCount > 0 && citasShowed > 0  && <span className="text-[11px] text-success-400">{citasShowed} se presentaron</span>}
            {citasCount > 0 && citasNoShow > 0  && <span className="text-[11px] text-danger-400">{citasNoShow} no show</span>}
            {presupuestoStr && (
              <span className="text-[11px] text-cream-dim flex items-center gap-1">
                💰 <span className="text-cream font-medium">{presupuestoStr}</span>
                <span className="text-cream-dim">en presupuesto ({presupuestoCount} contactos)</span>
              </span>
            )}
          </div>
        </div>

        {/* Citas de la semana */}
        {appointments.length > 0 && (
          <AppointmentsList appointments={appointments} />
        )}

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
              <ContactList contacts={advisor.contacts} onSelectContact={onSelectContact} />
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
  const [selectedContact, setSelectedContact] = useState(null);
  const [filterAdvisor,   setFilterAdvisor]   = useState(null);
  const [notesAdvisor,    setNotesAdvisor]    = useState(null); // para modal de notas
  const [activityModal,   setActivityModal]   = useState(null); // { advisor, type: "calls"|"messages" }

  // ── Citas de la semana ────────────────────────────────────────────────────
  const [apptData,    setApptData]    = useState(null);
  const [apptLoading, setApptLoading] = useState(false);

  useEffect(() => {
    if (!week?.from || !week?.to) return;
    setApptLoading(true);
    const from = week.from.toISOString();
    const to   = week.to.toISOString();
    fetch(`/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then(r => r.json())
      .then(d => { if (d.ok) setApptData(d); })
      .catch(() => {})
      .finally(() => setApptLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week?.from?.toISOString(), week?.to?.toISOString()]);

  // Map: advisor name → array of appointments
  const apptsByAdvisor = useMemo(() => {
    if (!apptData?.byAdvisor) return {};
    return apptData.byAdvisor;
  }, [apptData]);

  const advisors = useMemo(() => {
    if (!data) return [];

    const contacts      = data.contacts      ?? [];
    const conversations = data.conversations ?? [];
    const usuarios      = data.usuarios      ?? [];

    // Conversaciones con actividad esta semana (solo filtro de fecha).
    // NO filtramos por lastMessageBody aquí: GHL a veces devuelve
    // "Opportunity created" como lastMessageBody aunque el asesor enviara
    // un mensaje real antes, lo que causaría que se excluyera toda la conv.
    // El filtro de auto-mensajes se aplica SOLO al mostrar el preview en el modal.
    const weekConvs = conversations.filter(c => {
      const raw = c.lastMessageDate;
      if (!raw) return false;
      const d = typeof raw === "number" ? new Date(raw) : new Date(raw);
      return !isNaN(d) && d >= week.from && d <= week.to;
    });

    // Lookup global id → contacto (necesario antes del forEach para fallback de asignación)
    const contactsById = {};
    contacts.forEach(c => { if (c.id) contactsById[c.id] = c; });

    // Acumular stats por asesor
    // IMPORTANTE: c.isCall viene ya calculado en sync.js — no recalcular aquí
    const activityMap  = {};
    // Dos mapas separados: uno para llamadas, otro para mensajes
    // (un contacto puede tener ambos tipos de conv esta semana)
    const weekCallByContact    = new Map(); // contactId → conv más reciente tipo llamada
    const weekMessageByContact = new Map(); // contactId → conv más reciente tipo mensaje
    weekConvs.forEach(c => {
      // En GHL, la conversación puede no tener assignedTo propio.
      // Fallback: usar el asesor asignado al contacto correspondiente.
      let name = c.assignedToName && c.assignedToName !== "(Sin asignar)"
        ? c.assignedToName
        : null;
      if (!name && c.contactId) {
        const ct = contactsById[c.contactId];
        if (ct && ct.assignedTo && ct.assignedTo !== "(No hay datos)") name = ct.assignedTo;
      }
      name = name || "(Sin asignar)";
      if (!activityMap[name]) activityMap[name] = {
        mensajesEnviados: 0, mensajesPendientes: 0,
        llamadas: 0, llamadasSalientes: 0,
      };
      if (c.isCall) {
        activityMap[name].llamadas++;
        if (isOutbound(c.lastMessageDirection)) activityMap[name].llamadasSalientes++;
        if (c.contactId) {
          const prev = weekCallByContact.get(c.contactId);
          if (!prev || new Date(c.lastMessageDate) > new Date(prev.lastMessageDate))
            weekCallByContact.set(c.contactId, c);
        }
      } else {
        // Contar cualquier conversación de mensaje activa esta semana.
        // GHL no devuelve lastMessageDirection confiable para WhatsApp/SMS,
        // así que usamos la presencia en weekConvs como proxy de actividad.
        activityMap[name].mensajesEnviados++;
        activityMap[name].mensajesPendientes += Number(c.unreadCount) || 0;
        if (c.contactId) {
          const prev = weekMessageByContact.get(c.contactId);
          if (!prev || new Date(c.lastMessageDate) > new Date(prev.lastMessageDate))
            weekMessageByContact.set(c.contactId, c);
        }
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
    EXCLUDED_USERS.forEach(name => namesSet.delete(name));

    return Array.from(namesSet)
      .map(name => {
        const deep = sumDeepStats(deepStats, name, week.from, week.to);
        const live = activityMap[name] || { mensajesEnviados: 0, mensajesPendientes: 0, llamadas: 0, llamadasSalientes: 0 };
        // mensajesEnviados: SIEMPRE del conteo en vivo filtrado (excluye bots/automáticos).
        // Los deep stats cuentan TODOS los mensajes salientes incluidos los de bots,
        // por lo que no son útiles para este campo.
        // llamadas: deep stats son más precisos (no hay llamadas automatizadas).
        const act = {
          ...live,
          llamadas:          deep ? deep.llamadas          : live.llamadas,
          llamadasSalientes: deep ? deep.llamadasSalientes : live.llamadasSalientes,
          llamadasContestadas: deep ? deep.llamadasContestadas : (live.llamadasContestadas || 0),
        };
        const contactList = contactsMap[name] || [];
        // Contar notas llenadas (campos de actividad) en los contactos de este asesor
        const notasLlenadas = contactList.reduce((sum, c) => sum + noteScore(c), 0);
        // Sumar el campo numérico "Suma de notas de agente" de cada contacto
        const sumaNotas = contactList.reduce((sum, c) => {
          const v = Number(c.sumaNotas);
          return sum + (isNaN(v) ? 0 : v);
        }, 0);
        // Contactos con actividad esta semana — mapas separados para no mezclar llamadas con mensajes
        const calledContacts   = contactList
          .map(c => ({ contact: c, conv: weekCallByContact.get(c.id) }))
          .filter(({ conv }) => conv)
          .map(({ contact, conv }) => ({ contact, body: conv.lastMessageBody, date: conv.lastMessageDate }))
          .sort((a, b) => new Date(b.date) - new Date(a.date));
        const messagedContacts = contactList
          .map(c => ({ contact: c, conv: weekMessageByContact.get(c.id) }))
          .filter(({ conv }) => conv)
          .map(({ contact, conv }) => ({
            contact,
            // Si el último cuerpo es un mensaje de bot, no mostrar el preview
            body: conv.lastMessageBody && !isAutoMessage(conv.lastMessageBody) ? conv.lastMessageBody : null,
            date: conv.lastMessageDate,
          }))
          .sort((a, b) => new Date(b.date) - new Date(a.date));
        // Fallback filtrado: contactos del asesor con dateUpdated DENTRO de esta semana
        // Se usa cuando el cruce por conv está vacío (cache desactualizado o datos incompletos)
        const weekContacts = contactList
          .filter(c => {
            if (!c.dateUpdated || c.dateUpdated === "(No hay datos)") return false;
            const d = new Date(c.dateUpdated);
            return !isNaN(d) && d >= week.from && d <= week.to;
          })
          .sort((a, b) => new Date(b.dateUpdated) - new Date(a.dateUpdated))
          .map(c => ({ contact: c, body: null, date: c.dateUpdated }));
        return { name, contacts: contactList, ...act, notasLlenadas, sumaNotas, hasDeepData: !!deep, calledContacts, messagedContacts, weekContacts };
      })
      .sort((a, b) => {
        // Score compuesto: mensajes + llamadas×2 + notas×1.5 + notas_llenadas×3
        const sa = (a.mensajesEnviados || 0) + (a.llamadas || 0) * 2 + (a.sumaNotas || 0) * 1.5 + (a.notasLlenadas || 0) * 3;
        const sb = (b.mensajesEnviados || 0) + (b.llamadas || 0) * 2 + (b.sumaNotas || 0) * 1.5 + (b.notasLlenadas || 0) * 3;
        if (sb !== sa) return sb - sa;
        return a.name.localeCompare(b.name, "es");
      });
  }, [data, week]);

  // Reordenar incluyendo citas cuando estén disponibles
  const sortedAdvisors = useMemo(() => {
    if (!apptsByAdvisor || Object.keys(apptsByAdvisor).length === 0) return advisors;
    return [...advisors].sort((a, b) => {
      const aAppts = (apptsByAdvisor[a.name] || []).length;
      const bAppts = (apptsByAdvisor[b.name] || []).length;
      const sa = (a.mensajesEnviados || 0) + (a.llamadas || 0) * 2 + (a.sumaNotas || 0) * 1.5 + (a.notasLlenadas || 0) * 3 + aAppts * 2;
      const sb = (b.mensajesEnviados || 0) + (b.llamadas || 0) * 2 + (b.sumaNotas || 0) * 1.5 + (b.notasLlenadas || 0) * 3 + bAppts * 2;
      if (sb !== sa) return sb - sa;
      return a.name.localeCompare(b.name, "es");
    });
  }, [advisors, apptsByAdvisor]);

  const totals = useMemo(() => {
    const allAppts  = Object.values(apptsByAdvisor).flat();
    return {
      activos:    advisors.filter(a => a.mensajesEnviados + a.llamadas > 0).length,
      mensajes:   advisors.reduce((s, a) => s + a.mensajesEnviados,   0),
      pendientes: advisors.reduce((s, a) => s + a.mensajesPendientes, 0),
      llamadas:   advisors.reduce((s, a) => s + a.llamadas,           0),
      notas:      advisors.reduce((s, a) => s + (a.notasLlenadas||0), 0),
      sumaNotas:  advisors.reduce((s, a) => s + (a.sumaNotas||0),     0),
      citas:      allAppts.length,
      citasShowed:   allAppts.filter(a => a.status === "showed").length,
      citasNoShow:   allAppts.filter(a => ["no-show","noshow"].includes(a.status)).length,
    };
  }, [advisors, apptsByAdvisor]);

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
      {/* Modal de notas del asesor */}
      {notesAdvisor && (
        <AdvisorNotesModal
          advisor={notesAdvisor}
          onClose={() => setNotesAdvisor(null)}
        />
      )}

      {/* Modal de llamadas / mensajes del asesor */}
      {activityModal && (
        <AdvisorActivityModal
          advisor={activityModal.advisor}
          type={activityModal.type}
          onClose={() => setActivityModal(null)}
          onSelectContact={c => { setSelectedContact(c); setActivityModal(null); }}
        />
      )}

      {/* Modal de contacto */}
      {selectedContact && (
        <ContactModal
          contact={selectedContact}
          onClose={() => setSelectedContact(null)}
        />
      )}

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
        {[
          { icon: Users,         label: "Asesores activos",  value: totals.activos,       sub: `de ${advisors.length}` },
          { icon: MessageSquare, label: "Mensajes enviados", value: totals.mensajes,      sub: "esta semana" },
          { icon: Inbox,         label: "Sin leer",          value: totals.pendientes,    sub: "pendientes",  warn: totals.pendientes > 0 },
          { icon: Phone,         label: "Llamadas",          value: totals.llamadas,      sub: "esta semana" },
          { icon: FileText,      label: "Notas campos",      value: totals.notas,         sub: "campos activos" },
          { icon: FileText,      label: "Total notas GHL",   value: totals.sumaNotas,     sub: "suma del campo" },
          { icon: Calendar,      label: "Citas semana",      value: totals.citas,         sub: apptLoading ? "cargando…" : `${totals.citasShowed} asistieron`, gold: totals.citas > 0 },
          { icon: CheckCircle,   label: "No show",           value: totals.citasNoShow,   sub: "de la semana", warn: totals.citasNoShow > 0 },
        ].map(({ icon: Icon, label, value, sub, warn, gold }) => (
          <div key={label} className="rounded-xl border border-dark-700 bg-dark-900 p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-cream-dim">{label}</p>
                <p className={`mt-1 text-3xl font-bold tabular-nums ${warn ? "text-danger-400" : gold ? "text-gold-400" : "text-cream"}`}>{value}</p>
                <p className="mt-0.5 text-xs text-cream-dim">{sub}</p>
              </div>
              <div className={`rounded-lg p-2 ${warn ? "bg-danger-400/10" : gold ? "bg-gold-500/10" : "bg-dark-800"}`}>
                <Icon size={16} className={warn ? "text-danger-400" : gold ? "text-gold-400" : "text-cream-muted"} />
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

      {/* ── Filtro de asesores ── */}
      {advisors.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-cream-dim shrink-0">Filtrar:</span>
          <button
            onClick={() => setFilterAdvisor(null)}
            className={[
              "rounded-full px-3 py-1 text-xs font-medium transition-all border",
              !filterAdvisor
                ? "bg-gold-500/20 text-gold-400 border-gold-500/40"
                : "border-dark-600 text-cream-dim hover:border-dark-500 hover:text-cream",
            ].join(" ")}
          >
            Todos
          </button>
          {sortedAdvisors.map((a) => (
            <button
              key={a.name}
              onClick={() => setFilterAdvisor(prev => prev === a.name ? null : a.name)}
              className={[
                "rounded-full px-3 py-1 text-xs font-medium transition-all border flex items-center gap-1.5",
                filterAdvisor === a.name
                  ? "bg-gold-500/20 text-gold-400 border-gold-500/40"
                  : "border-dark-600 text-cream-dim hover:border-dark-500 hover:text-cream",
              ].join(" ")}
            >
              {initials(a.name)}
              <span className="hidden sm:inline">{a.name.split(" ")[0]}</span>
              {filterAdvisor === a.name && (
                <X size={10} className="opacity-60" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Historial del asesor seleccionado ── */}
      {filterAdvisor && (
        <AdvisorHistory
          advisorName={filterAdvisor}
          deepStats={deepStats}
          currentWeek={week}
          onWeekClick={(w) => {
            // Al hacer clic en una semana del historial, navegar a esa semana
            // Comunicamos hacia arriba via un evento de window para simplificar
            window.dispatchEvent(new CustomEvent("tdl:gotoweek", { detail: w }));
          }}
        />
      )}

      {/* ── Tarjetas ── */}
      {advisors.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-xl border border-dark-700 bg-dark-900">
          <p className="text-sm text-cream-dim">Sin datos. Presiona Sincronizar.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(filterAdvisor
            ? sortedAdvisors.filter(a => a.name === filterAdvisor)
            : sortedAdvisors
          ).map((advisor, i) => (
            <AdvisorCard
              key={advisor.name}
              advisor={advisor}
              idx={i}
              onSelectContact={setSelectedContact}
              appointments={apptsByAdvisor[advisor.name] || []}
              onShowNotes={setNotesAdvisor}
              onShowCalls={a => setActivityModal({ advisor: a, type: "calls" })}
              onShowMessages={a => setActivityModal({ advisor: a, type: "messages" })}
            />
          ))}
        </div>
      )}

    </div>
  );
}
