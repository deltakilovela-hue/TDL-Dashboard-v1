import { useEffect, useState, useCallback } from "react";
import { X, MessageSquare, Phone, FileText, PhoneCall, PhoneMissed, PhoneIncoming, ChevronDown, ChevronUp } from "lucide-react";

function formatDate(str) {
  if (!str) return "—";
  const d = new Date(typeof str === "number" ? str : str);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDateShort(str) {
  if (!str) return "—";
  const d = new Date(typeof str === "number" ? str : str);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

/* ── Burbuja de mensaje ──────────────────────────────────────────────────────── */
function MessageBubble({ msg }) {
  if (msg.isCall) {
    const status = msg.callStatus || "unknown";
    const answered = status === "completed" || status === "answered" || status === "connected";
    const missed   = status === "missed"    || status === "no-answer" || status === "busy";
    const Icon  = answered ? PhoneCall : missed ? PhoneMissed : Phone;
    const color = answered ? "text-green-400 bg-green-900/20 border-green-800/40"
                : missed   ? "text-red-400 bg-red-900/20 border-red-800/40"
                :             "text-zinc-400 bg-zinc-800/40 border-zinc-700/40";
    return (
      <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${color} ${msg.isOutbound ? "ml-8" : "mr-8"}`}>
        <Icon size={12} />
        <span className="font-medium">
          {answered ? "Llamada contestada" : missed ? "Llamada perdida" : "Llamada"}
          {msg.isOutbound ? " (saliente)" : " (entrante)"}
        </span>
        {msg.callDuration && <span className="opacity-60">· {Math.round(msg.callDuration / 60)}min</span>}
        <span className="ml-auto opacity-50">{formatDateShort(msg.dateAdded)}</span>
      </div>
    );
  }

  const out = msg.isOutbound;
  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs ${
        out
          ? "bg-gold-500/15 text-gold-100 rounded-br-sm"
          : "bg-zinc-800 text-zinc-200 rounded-bl-sm"
      }`}>
        {msg.body
          ? <p className="whitespace-pre-wrap leading-relaxed">{msg.body}</p>
          : <p className="italic opacity-50">{msg.attachments > 0 ? `📎 ${msg.attachments} adjunto(s)` : "(Sin texto)"}</p>
        }
        <p className={`mt-1 text-[10px] ${out ? "text-gold-400/50 text-right" : "text-zinc-500"}`}>
          {formatDateShort(msg.dateAdded)}
        </p>
      </div>
    </div>
  );
}

/* ── Tab button ─────────────────────────────────────────────────────────────── */
function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
        active ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

/* ── Stat pill ───────────────────────────────────────────────────────────────── */
function StatPill({ icon: Icon, label, value, color = "zinc" }) {
  const colors = {
    zinc:  "bg-zinc-800 text-zinc-300",
    gold:  "bg-gold-500/15 text-gold-400",
    green: "bg-green-900/30 text-green-400",
    red:   "bg-red-900/30 text-red-400",
  };
  return (
    <div className={`flex flex-col items-center gap-1 rounded-xl px-4 py-3 ${colors[color]}`}>
      <Icon size={14} className="opacity-60" />
      <span className="text-xl font-bold tabular-nums">{value}</span>
      <span className="text-[10px] opacity-70 text-center leading-tight">{label}</span>
    </div>
  );
}

/* ── Modal principal ─────────────────────────────────────────────────────────── */
export default function ContactModal({ contact, onClose }) {
  const [detail, setDetail]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [tab, setTab]         = useState("mensajes"); // mensajes | notas | info
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    if (!contact?.id) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/contact-detail?contactId=${contact.id}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      if (!json.ok) throw new Error(json.error);
      setDetail(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [contact?.id]);

  useEffect(() => { load(); }, [load]);

  // Cerrar con Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!contact) return null;

  const nombre = `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "(Sin nombre)";
  const msgs   = detail?.messages || [];
  const notes  = detail?.notes    || [];
  const s      = detail?.stats    || {};

  const visibleMsgs = showAll ? msgs : msgs.slice(0, 20);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-zinc-800 shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-zinc-100 text-lg leading-tight truncate">{nombre}</h2>
            <div className="flex flex-wrap gap-2 mt-1">
              {contact.phone && contact.phone !== "(No hay datos)" && (
                <span className="text-xs text-zinc-400 font-mono">{contact.phone}</span>
              )}
              {contact.pipelineName && contact.pipelineName !== "(No hay datos)" && (
                <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">
                  {contact.pipelineName} · {contact.pipelineStage}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Stats rápidas */}
        {!loading && detail && (
          <div className="flex gap-2 px-5 py-3 border-b border-zinc-800 shrink-0 overflow-x-auto">
            <StatPill icon={MessageSquare} label="Mensajes enviados"   value={s.sentMessages   ?? 0} color="gold"  />
            <StatPill icon={MessageSquare} label="Mensajes recibidos"  value={s.recvMessages   ?? 0} color="zinc"  />
            <StatPill icon={Phone}         label="Llamadas totales"    value={s.totalCalls     ?? 0} color="zinc"  />
            <StatPill icon={PhoneCall}     label="Contestadas"         value={s.answeredCalls  ?? 0} color="green" />
            <StatPill icon={PhoneMissed}   label="Perdidas"            value={s.missedCalls    ?? 0} color="red"   />
            <StatPill icon={FileText}      label="Notas"               value={s.totalNotes     ?? 0} color="zinc"  />
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3 pb-2 border-b border-zinc-800 shrink-0">
          <TabBtn active={tab === "mensajes"} onClick={() => setTab("mensajes")}>
            💬 Mensajes {!loading && <span className="opacity-60">({msgs.length})</span>}
          </TabBtn>
          <TabBtn active={tab === "notas"} onClick={() => setTab("notas")}>
            📝 Notas {!loading && <span className="opacity-60">({notes.length})</span>}
          </TabBtn>
          <TabBtn active={tab === "info"} onClick={() => setTab("info")}>
            👤 Info
          </TabBtn>
        </div>

        {/* Contenido scrollable */}
        <div className="flex-1 overflow-y-auto">

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center h-40 gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-gold-500" />
              <span className="text-sm text-zinc-400">Cargando conversación…</span>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="m-4 rounded-xl border border-red-800 bg-red-900/20 p-4 text-sm text-red-400">
              ❌ {error}
            </div>
          )}

          {/* TAB: Mensajes */}
          {!loading && !error && tab === "mensajes" && (
            <div className="flex flex-col gap-2 p-4">
              {msgs.length === 0 ? (
                <p className="text-center text-sm text-zinc-500 py-8">Sin mensajes registrados</p>
              ) : (
                <>
                  {visibleMsgs.map((m, i) => <MessageBubble key={m.id || i} msg={m} />)}
                  {msgs.length > 20 && (
                    <button
                      onClick={() => setShowAll(s => !s)}
                      className="flex items-center justify-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 py-2 transition-colors"
                    >
                      {showAll ? <><ChevronUp size={12} /> Mostrar menos</> : <><ChevronDown size={12} /> Ver {msgs.length - 20} mensajes más</>}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* TAB: Notas */}
          {!loading && !error && tab === "notas" && (
            <div className="flex flex-col gap-3 p-4">
              {notes.length === 0 ? (
                <p className="text-center text-sm text-zinc-500 py-8">Sin notas registradas</p>
              ) : (
                notes.map((n, i) => (
                  <div key={n.id || i} className="rounded-xl border border-zinc-800 bg-zinc-800/40 p-3">
                    <p className="text-xs text-zinc-500 mb-1.5">{formatDate(n.dateAdded)}</p>
                    <p className="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">{n.body || "(Sin contenido)"}</p>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB: Info */}
          {!loading && !error && tab === "info" && (
            <div className="p-4 space-y-3">
              {[
                { label: "Nombre",           value: nombre },
                { label: "Teléfono",         value: contact.phone },
                { label: "Email",            value: contact.email },
                { label: "Fuente",           value: contact.source },
                { label: "Pipeline",         value: contact.pipelineName },
                { label: "Etapa",            value: contact.pipelineStage },
                { label: "Asignado a",       value: contact.assignedTo },
                { label: "Tags",             value: contact.tags },
                { label: "Fecha alta",       value: formatDate(contact.dateAdded) },
                { label: "Última actividad", value: formatDate(contact.lastActivity) },
                { label: "Nivel de interés", value: contact.nivelInteres },
                { label: "Presupuesto",      value: contact.presupuesto },
                { label: "Financiamiento",   value: contact.financiamiento },
                { label: "¿Desea cita?",     value: contact.deseaCita },
                { label: "Medio contacto",   value: contact.medioContacto },
              ].filter(f => f.value && f.value !== "(No hay datos)").map(f => (
                <div key={f.label} className="flex gap-3 text-sm border-b border-zinc-800/60 pb-2">
                  <span className="text-zinc-500 w-36 shrink-0">{f.label}</span>
                  <span className="text-zinc-200">{f.value}</span>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
