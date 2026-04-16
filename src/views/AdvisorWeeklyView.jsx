import { useMemo } from "react";
import { MessageSquare, Phone, PhoneCall, Inbox, Users, CheckCircle } from "lucide-react";
import { useData } from "../contexts/DataContext.jsx";

// ── Campos que consideramos "formulario de primer contacto" ──────────────────
const FORM_FIELDS = [
  "nivelInteres",
  "presupuesto",
  "financiamiento",
  "deseaCita",
  "medioContacto",
];

function formScore(contact) {
  const filled = FORM_FIELDS.filter(f => {
    const v = contact[f];
    return v && v !== "(No hay datos)";
  }).length;
  return { filled, total: FORM_FIELDS.length, pct: Math.round((filled / FORM_FIELDS.length) * 100) };
}

// ── Iniciales del nombre ──────────────────────────────────────────────────────
function initials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0].toUpperCase())
    .join("");
}

// ── Colores por índice ────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  "bg-gold-500/20 text-gold-400 ring-gold-500/30",
  "bg-info-400/20 text-info-400 ring-info-400/30",
  "bg-success-400/20 text-success-400 ring-success-400/30",
  "bg-danger-400/20 text-danger-400 ring-danger-400/30",
  "bg-cream/10 text-cream ring-cream/20",
];

// ── Stat individual ───────────────────────────────────────────────────────────
function Stat({ icon: Icon, label, value, highlight = false, dim = false }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg bg-dark-800/60 px-3 py-3 min-w-[80px]">
      <Icon size={15} className={highlight ? "text-gold-400" : dim ? "text-cream-dim/50" : "text-cream-muted"} />
      <span className={[
        "text-xl font-bold tabular-nums leading-none",
        highlight ? "text-gold-400" : dim ? "text-cream-dim" : "text-cream",
      ].join(" ")}>
        {value}
      </span>
      <span className="text-[10px] text-cream-dim text-center leading-tight">{label}</span>
    </div>
  );
}

// ── Barra de progreso del formulario ─────────────────────────────────────────
function FormBar({ pct, filled, total }) {
  const color =
    pct >= 80 ? "bg-success-400" :
    pct >= 40 ? "bg-gold-500" :
                "bg-danger-400/70";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-cream-dim">Formulario</span>
        <span className={pct >= 80 ? "text-success-400" : pct >= 40 ? "text-gold-400" : "text-danger-400"}>
          {filled}/{total} campos · {pct}%
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-dark-700">
        <div
          className={`h-1.5 rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Tarjeta de asesor ─────────────────────────────────────────────────────────
function AdvisorCard({ advisor, idx }) {
  const avatarColor = AVATAR_COLORS[idx % AVATAR_COLORS.length];

  // Promedio del formulario de los contactos asignados
  const formAvg = useMemo(() => {
    if (advisor.contacts.length === 0) return { filled: 0, total: FORM_FIELDS.length, pct: 0 };
    const scores = advisor.contacts.map(c => formScore(c));
    const avgFilled = Math.round(scores.reduce((s, x) => s + x.filled, 0) / scores.length);
    const avgPct    = Math.round(scores.reduce((s, x) => s + x.pct,    0) / scores.length);
    return { filled: avgFilled, total: FORM_FIELDS.length, pct: avgPct };
  }, [advisor.contacts]);

  // Cuántos contactos tienen el form completo (≥80%)
  const formCompletos = advisor.contacts.filter(c => formScore(c).pct >= 80).length;

  return (
    <div className="rounded-2xl border border-dark-700 bg-dark-900 p-5 flex flex-col gap-5">

      {/* Cabecera: avatar + nombre + contactos */}
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-1 ${avatarColor} text-base font-bold`}>
          {initials(advisor.name)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-cream truncate">{advisor.name}</p>
          <p className="text-xs text-cream-dim">{advisor.contacts.length} contactos asignados</p>
        </div>
        {/* Badge de actividad semanal */}
        {advisor.totalActivity > 0 ? (
          <span className="rounded-full bg-success-400/10 px-2 py-0.5 text-[11px] font-medium text-success-400 ring-1 ring-success-400/20">
            Activo
          </span>
        ) : (
          <span className="rounded-full bg-dark-700 px-2 py-0.5 text-[11px] font-medium text-cream-dim ring-1 ring-dark-600">
            Sin actividad
          </span>
        )}
      </div>

      {/* Stats de la semana */}
      <div>
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-cream-dim">Actividad de la semana</p>
        <div className="flex flex-wrap gap-2">
          <Stat icon={MessageSquare} label="Mensajes enviados"  value={advisor.mensajesEnviados}  highlight={advisor.mensajesEnviados > 0} />
          <Stat icon={Inbox}         label="Sin leer"           value={advisor.mensajesPendientes} dim={advisor.mensajesPendientes === 0} highlight={advisor.mensajesPendientes > 0} />
          <Stat icon={Phone}         label="Llamadas"           value={advisor.llamadas}           highlight={advisor.llamadas > 0} />
          <Stat icon={PhoneCall}     label="Contestadas"        value={advisor.llamadasContestadas} highlight={advisor.llamadasContestadas > 0} />
        </div>
      </div>

      {/* Formulario promedio */}
      <div>
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-cream-dim">
          Formulario de contactos asignados
        </p>
        {advisor.contacts.length > 0 ? (
          <>
            <FormBar pct={formAvg.pct} filled={formAvg.filled} total={formAvg.total} />
            <p className="mt-1.5 text-[11px] text-cream-dim">
              <span className="text-cream">{formCompletos}</span> de {advisor.contacts.length} con formulario completo (≥80%)
            </p>
          </>
        ) : (
          <p className="text-xs text-cream-dim">Sin contactos asignados</p>
        )}
      </div>

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

    // Conversaciones activas esta semana
    const weekConvs = conversations.filter(c => {
      if (!c.lastMessageDate) return false;
      const d = new Date(c.lastMessageDate);
      return d >= week.from && d <= week.to;
    });

    // Agrupar actividad semanal por nombre de asesor
    const activityMap = {};
    weekConvs.forEach(c => {
      const name = c.assignedToName || "(Sin asignar)";
      if (!activityMap[name]) {
        activityMap[name] = { mensajesEnviados: 0, mensajesPendientes: 0, llamadas: 0, llamadasContestadas: 0 };
      }
      if (c.isCall) {
        activityMap[name].llamadas++;
        // GHL marca llamadas contestadas cuando la dirección es inbound (el cliente llamó y se contestó)
        // o cuando hay un mensaje outbound de tipo call contestado
        if (c.lastMessageDirection === "inbound") activityMap[name].llamadasContestadas++;
      } else {
        if (c.lastMessageDirection === "outbound") activityMap[name].mensajesEnviados++;
        activityMap[name].mensajesPendientes += c.unreadCount || 0;
      }
    });

    // Contactos agrupados por asesor
    const contactsMap = {};
    contacts.forEach(c => {
      const name = c.assignedTo && c.assignedTo !== "(No hay datos)" ? c.assignedTo : "(Sin asignar)";
      if (!contactsMap[name]) contactsMap[name] = [];
      contactsMap[name].push(c);
    });

    // Lista de asesores activos (usuarios GHL + cualquiera con contactos o actividad)
    const namesSet = new Set([
      ...usuarios.map(u => u.name),
      ...Object.keys(activityMap),
      ...Object.keys(contactsMap),
    ]);
    namesSet.delete("(Sin asignar)");

    return Array.from(namesSet)
      .map(name => {
        const act = activityMap[name] || { mensajesEnviados: 0, mensajesPendientes: 0, llamadas: 0, llamadasContestadas: 0 };
        const myContacts = contactsMap[name] || [];
        return {
          name,
          contacts: myContacts,
          ...act,
          totalActivity: act.mensajesEnviados + act.llamadas,
        };
      })
      // Ordenar: más activos primero, luego por nombre
      .sort((a, b) => {
        if (b.totalActivity !== a.totalActivity) return b.totalActivity - a.totalActivity;
        return a.name.localeCompare(b.name, "es");
      });
  }, [data, week]);

  // ── Totales de la semana ──────────────────────────────────────────────────
  const totals = useMemo(() => ({
    mensajes:   advisors.reduce((s, a) => s + a.mensajesEnviados, 0),
    pendientes: advisors.reduce((s, a) => s + a.mensajesPendientes, 0),
    llamadas:   advisors.reduce((s, a) => s + a.llamadas, 0),
    activos:    advisors.filter(a => a.totalActivity > 0).length,
  }), [advisors]);

  // ── Loading / Error ───────────────────────────────────────────────────────
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

      {/* Resumen de la semana */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: Users,         label: "Asesores activos",   value: totals.activos,    sub: `de ${advisors.length} total` },
          { icon: MessageSquare, label: "Mensajes enviados",  value: totals.mensajes,   sub: "esta semana" },
          { icon: Inbox,         label: "Mensajes sin leer",  value: totals.pendientes, sub: "pendientes", warn: totals.pendientes > 0 },
          { icon: Phone,         label: "Llamadas realizadas",value: totals.llamadas,   sub: "esta semana" },
        ].map(({ icon: Icon, label, value, sub, warn }) => (
          <div key={label} className="rounded-xl border border-dark-700 bg-dark-900 p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-cream-dim">{label}</p>
                <p className={`mt-1 text-3xl font-bold tabular-nums ${warn ? "text-danger-400" : "text-cream"}`}>
                  {value}
                </p>
                <p className="mt-0.5 text-xs text-cream-dim">{sub}</p>
              </div>
              <div className={`rounded-lg p-2 ${warn ? "bg-danger-400/10" : "bg-dark-800"}`}>
                <Icon size={16} className={warn ? "text-danger-400" : "text-cream-muted"} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tarjetas de asesores */}
      {advisors.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-xl border border-dark-700 bg-dark-900">
          <p className="text-sm text-cream-dim">Sin datos de asesores. Presiona Sincronizar.</p>
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
