import { useMemo } from "react";
import { MessageSquare, Phone, PhoneOff, Inbox, Users, PhoneCall } from "lucide-react";
import { useData } from "../contexts/DataContext.jsx";

// ── Campos del formulario de primer contacto ──────────────────────────────────
const FORM_FIELDS = [
  { key: "nivelInteres",   label: "Nivel de interés"   },
  { key: "presupuesto",    label: "Presupuesto"         },
  { key: "financiamiento", label: "Financiamiento"      },
  { key: "deseaCita",      label: "¿Desea cita?"        },
  { key: "medioContacto",  label: "Medio de contacto"   },
];

function formScore(contact) {
  const filled = FORM_FIELDS.filter(f => {
    const v = contact[f.key];
    return v && v !== "(No hay datos)";
  }).length;
  return { filled, total: FORM_FIELDS.length, pct: Math.round((filled / FORM_FIELDS.length) * 100) };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function initials(name) {
  return name.split(" ").filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join("");
}

// GHL puede devolver direction como string "outbound"/"inbound" o número 0/1
function isOutbound(dir) {
  if (!dir && dir !== 0) return false;
  const d = String(dir).toLowerCase();
  return d === "outbound" || d === "1" || d.includes("out");
}

function isInbound(dir) {
  if (!dir && dir !== 0) return false;
  const d = String(dir).toLowerCase();
  return d === "inbound" || d === "0" || d.includes("in");
}

// GHL lastMessageDate puede ser Unix ms (number) o ISO string
function parseConvDate(val) {
  if (!val) return null;
  if (typeof val === "number") return new Date(val);
  const d = new Date(val);
  return isNaN(d) ? null : d;
}

function isCallConv(c) {
  const t  = String(c.type || "").toLowerCase();
  const ch = String(c.lastMessageType || c.lastMessageChannel || "").toLowerCase();
  return t === "type_phone" || t === "phone" || t === "6" ||
         ch === "call" || ch.includes("call") || ch.includes("phone");
}

// ── Colores de avatar ─────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  "bg-gold-500/20 text-gold-400 ring-gold-500/30",
  "bg-info-400/20 text-info-400 ring-info-400/30",
  "bg-success-400/20 text-success-400 ring-success-400/30",
  "bg-danger-400/20 text-danger-400 ring-danger-400/30",
  "bg-cream/10 text-cream ring-cream/20",
];

// ── Stat box ──────────────────────────────────────────────────────────────────
function Stat({ icon: Icon, label, value, color = "normal" }) {
  const valueClass =
    color === "gold"    ? "text-gold-400"    :
    color === "danger"  ? "text-danger-400"  :
    color === "success" ? "text-success-400" :
    color === "muted"   ? "text-cream-dim"   : "text-cream";
  const iconClass =
    color === "gold"    ? "text-gold-400/60"    :
    color === "danger"  ? "text-danger-400/60"  :
    color === "success" ? "text-success-400/60" :
    color === "muted"   ? "text-cream-dim/40"   : "text-cream-muted";

  return (
    <div className="flex flex-1 flex-col items-center gap-1 rounded-lg bg-dark-800/60 px-2 py-3 min-w-[72px]">
      <Icon size={14} className={iconClass} />
      <span className={`text-2xl font-bold tabular-nums leading-none ${valueClass}`}>{value}</span>
      <span className="text-[10px] text-cream-dim text-center leading-tight">{label}</span>
    </div>
  );
}

// ── Barra del formulario ──────────────────────────────────────────────────────
function FormBar({ pct, filled, total, contacts }) {
  const barColor = pct >= 80 ? "bg-success-400" : pct >= 40 ? "bg-gold-500" : "bg-danger-400/70";
  const textColor = pct >= 80 ? "text-success-400" : pct >= 40 ? "text-gold-400" : "text-danger-400";
  const completos = contacts.filter(c => formScore(c).pct >= 80).length;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-cream-dim">Formulario promedio</span>
        <span className={textColor}>{filled}/{total} campos · {pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-dark-700">
        <div className={`h-1.5 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] text-cream-dim">
        <span className={completos > 0 ? "text-cream" : ""}>{completos}</span> de {contacts.length} con formulario completo
      </p>
    </div>
  );
}

// ── Tarjeta de asesor ─────────────────────────────────────────────────────────
function AdvisorCard({ advisor, idx }) {
  const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length];

  const formAvg = useMemo(() => {
    if (advisor.contacts.length === 0) return { filled: 0, total: FORM_FIELDS.length, pct: 0 };
    const scores  = advisor.contacts.map(c => formScore(c));
    const avgFill = Math.round(scores.reduce((s, x) => s + x.filled, 0) / scores.length);
    const avgPct  = Math.round(scores.reduce((s, x) => s + x.pct,    0) / scores.length);
    return { filled: avgFill, total: FORM_FIELDS.length, pct: avgPct };
  }, [advisor.contacts]);

  const activo = advisor.mensajesEnviados > 0 || advisor.mensajesRecibidos > 0 || advisor.llamadas > 0;

  return (
    <div className="rounded-2xl border border-dark-700 bg-dark-900 p-5 flex flex-col gap-4">

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

      {/* Stats de la semana */}
      <div>
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-cream-dim">Actividad de la semana</p>
        <div className="flex gap-2">
          <Stat icon={MessageSquare} label="Msj. enviados"   value={advisor.mensajesEnviados}  color={advisor.mensajesEnviados > 0  ? "gold"    : "muted"} />
          <Stat icon={Inbox}         label="Sin leer"         value={advisor.mensajesPendientes} color={advisor.mensajesPendientes > 0? "danger"  : "muted"} />
          <Stat icon={Phone}         label="Llamadas"          value={advisor.llamadas}           color={advisor.llamadas > 0          ? "gold"    : "muted"} />
          <Stat icon={PhoneCall}     label="Salientes"         value={advisor.llamadasSalientes}  color={advisor.llamadasSalientes > 0 ? "success" : "muted"} />
        </div>
      </div>

      {/* Formulario */}
      {advisor.contacts.length > 0 ? (
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-cream-dim">Formulario de contactos</p>
          <FormBar
            pct={formAvg.pct}
            filled={formAvg.filled}
            total={formAvg.total}
            contacts={advisor.contacts}
          />
        </div>
      ) : (
        <p className="text-xs text-cream-dim">Sin contactos asignados</p>
      )}

    </div>
  );
}

// ── Vista principal ───────────────────────────────────────────────────────────
export default function AdvisorWeeklyView({ week }) {
  const { data, loading, error } = useData();

  const advisors = useMemo(() => {
    if (!data) return [];

    const contacts      = data.contacts      ?? [];
    const conversations = data.conversations ?? [];
    const usuarios      = data.usuarios      ?? [];

    // Conversaciones con actividad esta semana
    const weekConvs = conversations.filter(c => {
      const d = parseConvDate(c.lastMessageDate);
      if (!d) return false;
      return d >= week.from && d <= week.to;
    });

    // Stats por asesor
    const activityMap = {};
    weekConvs.forEach(c => {
      const name = c.assignedToName || "(Sin asignar)";
      if (!activityMap[name]) activityMap[name] = {
        mensajesEnviados: 0, mensajesRecibidos: 0,
        mensajesPendientes: 0,
        llamadas: 0, llamadasSalientes: 0,
      };

      if (isCallConv(c)) {
        activityMap[name].llamadas++;
        if (isOutbound(c.lastMessageDirection)) activityMap[name].llamadasSalientes++;
      } else {
        if (isOutbound(c.lastMessageDirection)) activityMap[name].mensajesEnviados++;
        if (isInbound(c.lastMessageDirection))  activityMap[name].mensajesRecibidos++;
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

    // Unión de todos los asesores conocidos
    const namesSet = new Set([
      ...usuarios.map(u => u.name).filter(Boolean),
      ...Object.keys(activityMap),
      ...Object.keys(contactsMap),
    ]);
    namesSet.delete("(Sin asignar)");

    return Array.from(namesSet)
      .map(name => {
        const act = activityMap[name] || {
          mensajesEnviados: 0, mensajesRecibidos: 0,
          mensajesPendientes: 0, llamadas: 0, llamadasSalientes: 0,
        };
        return { name, contacts: contactsMap[name] || [], ...act };
      })
      .sort((a, b) => {
        const sa = a.mensajesEnviados + a.llamadas;
        const sb = b.mensajesEnviados + b.llamadas;
        if (sb !== sa) return sb - sa;
        return a.name.localeCompare(b.name, "es");
      });
  }, [data, week]);

  // Totales
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
        <p className="text-sm text-danger-400">Error al cargar: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: Users,         label: "Asesores activos",   value: totals.activos,    sub: `de ${advisors.length} en total` },
          { icon: MessageSquare, label: "Mensajes enviados",  value: totals.mensajes,   sub: "esta semana" },
          { icon: Inbox,         label: "Sin leer",           value: totals.pendientes, sub: "pendientes",  warn: totals.pendientes > 0 },
          { icon: Phone,         label: "Llamadas",           value: totals.llamadas,   sub: "esta semana" },
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
