import { useEffect, useState, useCallback } from "react";
import { X, MessageSquare, Phone, FileText, PhoneCall, PhoneMissed, ChevronDown, ChevronUp, Pencil, Save, XCircle, CheckCircle, Plus, Send } from "lucide-react";

// ── Utilidades ────────────────────────────────────────────────────────────────
function stripHtml(str) {
  if (!str) return "";
  return str
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
}

function formatDate(str) {
  if (!str) return "—";
  const d = new Date(typeof str === "number" ? str : str);
  if (isNaN(d)) return str; // devuelve el string tal cual si no es fecha
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function formatDateShort(str) {
  if (!str) return "—";
  const d = new Date(typeof str === "number" ? str : str);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}
function hasValue(v) { return v && v !== "(No hay datos)" && v !== "--"; }

// ── Definición de encuestas con IDs de GHL ───────────────────────────────────
const ENCUESTA_PC = [
  { key: "medioContacto",   id: "D1bAtBu1yhE3aigqdLCj", label: "Medio de contacto",          type: "radio",   options: ["WhatsApp","Llamada","Email","Facebook","Instagram","Otro"] },
  { key: "nivelInteres",    id: "IVDOKjoJDMtoCcYqzlPH", label: "Nivel de interés",            type: "radio",   options: ["Alto","Medio","Bajo","Sin interés"] },
  { key: "deseaCita",       id: "GhEmwRVvGcPSap7NnZsP", label: "¿Desea agendar una cita?",    type: "radio",   options: ["Sí","No","Tal vez"] },
  { key: "presupuesto",     id: "XPJiJOI5nVLNXzEXlrDp", label: "Presupuesto estimado",        type: "text"  },
  { key: "financiamiento",  id: "oLYtW2bv1h8HO11fyJ86", label: "¿Cuenta con financiamiento?", type: "radio",   options: ["Sí","No","En proceso"] },
  { key: "funciones",       id: "w5UHR3yXRimaT1wTYpyb", label: "Funciones de LEAD",           type: "text"  },
  { key: "notaPrimerContacto", id: "UaloobEyDQTsCu41WUnU", label: "Nota primer contacto",     type: "textarea" },
  { key: "notaSeguimiento", id: "pJ7gXNsKRQaTz6DjICcz", label: "Comentario seguimiento ext.", type: "textarea" },
];

const ENCUESTA_CIERRE = [
  { key: "sePresentoCita",  id: "mXKBwOYrchFLnzyllrwf", label: "¿El prospecto se presentó?",    type: "radio",   options: ["Sí","No","Reagendó"] },
  { key: "nivelInteresPost",id: "x1bW12U6t73E4Xh9RiI2", label: "Nivel de interés post-cita",     type: "radio",   options: ["Alto","Medio","Bajo","Sin interés"] },
  { key: "queFaltaCerrar",  id: "H8SyacUea1rwdbx8JzEU", label: "¿Qué falta para cerrar?",        type: "text"  },
  { key: "requiereCloser",  id: "mPBM192trmYBC5ZY0xxo", label: "¿Requiere closer u otro equipo?",type: "radio",   options: ["Sí","No"] },
  { key: "fechaSeguimiento",id: "TFPJmo94s7rXwhYmJNQb", label: "Fecha tentativa de cierre",       type: "date"  },
  { key: "notaCierre",      id: "KARIFTmgIzdlCPBYX0IL", label: "Nota cierre comercial",           type: "textarea" },
];

// ── Burbuja de mensaje ────────────────────────────────────────────────────────
function MessageBubble({ msg }) {
  if (msg.isCall) {
    const status   = msg.callStatus || "unknown";
    const answered = status === "completed" || status === "answered" || status === "connected";
    const missed   = status === "missed" || status === "no-answer" || status === "busy";
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
      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-xs ${out ? "bg-gold-500/15 text-gold-100 rounded-br-sm" : "bg-zinc-800 text-zinc-200 rounded-bl-sm"}`}>
        {msg.body
          ? <p className="whitespace-pre-wrap leading-relaxed">{stripHtml(msg.body)}</p>
          : <p className="italic opacity-50">{msg.attachments > 0 ? `📎 ${msg.attachments} adjunto(s)` : "(Sin texto)"}</p>}
        <p className={`mt-1 text-[10px] ${out ? "text-gold-400/50 text-right" : "text-zinc-500"}`}>{formatDateShort(msg.dateAdded)}</p>
      </div>
    </div>
  );
}

// ── Tab button ────────────────────────────────────────────────────────────────
function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${active ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"}`}>
      {children}
    </button>
  );
}

function StatPill({ icon: Icon, label, value, color = "zinc" }) {
  const colors = { zinc: "bg-zinc-800 text-zinc-300", gold: "bg-gold-500/15 text-gold-400", green: "bg-green-900/30 text-green-400", red: "bg-red-900/30 text-red-400" };
  return (
    <div className={`flex flex-col items-center gap-1 rounded-xl px-3 py-2 shrink-0 ${colors[color]}`}>
      <Icon size={13} className="opacity-60" />
      <span className="text-lg font-bold tabular-nums">{value}</span>
      <span className="text-[10px] opacity-70 text-center leading-tight">{label}</span>
    </div>
  );
}

// ── Sección de encuesta (con edición) ─────────────────────────────────────────
function SurveySection({ title, emoji, fields, contact, onSave, saving }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState({});
  const [saveError, setSaveError] = useState(null);
  const [saveOk, setSaveOk]   = useState(false);

  const filled  = fields.filter(f => hasValue(contact[f.key])).length;
  const pct     = Math.round((filled / fields.length) * 100);
  const barColor = pct >= 80 ? "bg-green-500" : pct >= 40 ? "bg-gold-500" : "bg-red-500/70";
  const txtColor = pct >= 80 ? "text-green-400" : pct >= 40 ? "text-gold-400" : "text-red-400";

  function startEdit() {
    const d = {};
    fields.forEach(f => { d[f.id] = hasValue(contact[f.key]) ? contact[f.key] : ""; });
    setDraft(d);
    setEditing(true);
    setSaveError(null);
    setSaveOk(false);
  }

  async function handleSave() {
    setSaveError(null);
    const result = await onSave(draft);
    if (result.ok) {
      setSaveOk(true);
      setEditing(false);
      setTimeout(() => setSaveOk(false), 3000);
    } else {
      setSaveError(result.error);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-zinc-800/40 border-b border-zinc-800">
        <span className="text-base">{emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-100">{title}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="h-1.5 w-24 rounded-full bg-zinc-700">
              <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
            <span className={`text-xs font-medium ${txtColor}`}>{filled}/{fields.length} campos · {pct}%</span>
          </div>
        </div>
        {!editing ? (
          <button onClick={startEdit} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 rounded-lg px-2 py-1 transition-colors">
            <Pencil size={11} /> Editar
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded-lg px-2 py-1 transition-colors">
              <XCircle size={11} /> Cancelar
            </button>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 text-xs text-gold-400 hover:text-gold-300 border border-gold-500/40 rounded-lg px-2 py-1 transition-colors disabled:opacity-50">
              <Save size={11} /> {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        )}
      </div>

      {/* Error de guardado */}
      {saveError && (
        <div className="px-4 py-2 text-xs text-red-400 bg-red-900/20 border-b border-red-800/30">
          ❌ {saveError}
        </div>
      )}
      {saveOk && (
        <div className="px-4 py-2 text-xs text-green-400 bg-green-900/20 border-b border-green-800/30 flex items-center gap-1">
          <CheckCircle size={11} /> Guardado correctamente
        </div>
      )}

      {/* Campos */}
      <div className="divide-y divide-zinc-800/60">
        {fields.map(f => {
          const val = contact[f.key];
          const draftVal = draft[f.id] ?? "";

          return (
            <div key={f.key} className="flex gap-3 px-4 py-2.5 items-start">
              <span className="text-xs text-zinc-500 w-40 shrink-0 pt-0.5">{f.label}</span>
              {editing ? (
                <div className="flex-1">
                  {f.type === "radio" ? (
                    <div className="flex flex-wrap gap-1.5">
                      {f.options.map(opt => (
                        <button
                          key={opt}
                          onClick={() => setDraft(d => ({ ...d, [f.id]: opt }))}
                          className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${draftVal === opt ? "bg-gold-500/20 border-gold-500/50 text-gold-300" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"}`}
                        >
                          {opt}
                        </button>
                      ))}
                      {draftVal && <button onClick={() => setDraft(d => ({ ...d, [f.id]: "" }))} className="text-[10px] text-zinc-600 hover:text-zinc-400 px-1">✕ limpiar</button>}
                    </div>
                  ) : f.type === "textarea" ? (
                    <textarea
                      value={draftVal}
                      onChange={e => setDraft(d => ({ ...d, [f.id]: e.target.value }))}
                      rows={3}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-gold-500/50 resize-none"
                      placeholder="Escribe aquí…"
                    />
                  ) : f.type === "date" ? (
                    <input
                      type="date"
                      value={draftVal}
                      onChange={e => setDraft(d => ({ ...d, [f.id]: e.target.value }))}
                      className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-gold-500/50"
                    />
                  ) : (
                    <input
                      type="text"
                      value={draftVal}
                      onChange={e => setDraft(d => ({ ...d, [f.id]: e.target.value }))}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-gold-500/50"
                      placeholder="Escribe aquí…"
                    />
                  )}
                </div>
              ) : (
                <span className={`text-xs flex-1 ${hasValue(val) ? "text-zinc-100" : "text-zinc-600"}`}>
                  {hasValue(val) ? val : "—"}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Modal principal ───────────────────────────────────────────────────────────
export default function ContactModal({ contact, onClose }) {
  const [detail,  setDetail]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [tab,     setTab]     = useState("mensajes");
  const [showAll, setShowAll] = useState(false);
  const [saving,      setSaving]      = useState(false);
  // Quick note state
  const [noteText,    setNoteText]    = useState("");
  const [savingNote,  setSavingNote]  = useState(false);
  const [noteError,   setNoteError]   = useState(null);
  const [noteSuccess, setNoteSuccess] = useState(false);
  // Local copy of contact to reflect edits immediately
  const [localContact, setLocalContact] = useState(contact);

  useEffect(() => { setLocalContact(contact); }, [contact]);

  const load = useCallback(async () => {
    if (!contact?.id) return;
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/contact-detail?contactId=${contact.id}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      if (!json.ok) throw new Error(json.error);
      setDetail(json);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [contact?.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const handleSave = useCallback(async (fieldMap) => {
    setSaving(true);
    try {
      const r = await fetch("/api/contact-update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: contact.id, fields: fieldMap }),
      });
      const json = await r.json();
      if (!json.ok) return { ok: false, error: json.error };
      // Actualizar localContact con los nuevos valores
      // Buscar la key del campo en ENCUESTA_PC / ENCUESTA_CIERRE por su id
      const allFields = [...ENCUESTA_PC, ...ENCUESTA_CIERRE];
      setLocalContact(prev => {
        const updated = { ...prev };
        Object.entries(fieldMap).forEach(([fieldId, value]) => {
          const def = allFields.find(f => f.id === fieldId);
          if (def) updated[def.key] = value;
        });
        return updated;
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      setSaving(false);
    }
  }, [contact?.id]);

  const handleAddNote = useCallback(async () => {
    if (!noteText.trim()) return;
    setSavingNote(true); setNoteError(null); setNoteSuccess(false);
    try {
      const r = await fetch("/api/note-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: contact.id, body: noteText.trim() }),
      });
      const json = await r.json();
      if (!json.ok) { setNoteError(json.error); return; }
      setNoteText("");
      setNoteSuccess(true);
      setTimeout(() => setNoteSuccess(false), 3000);
      // Recargar notas
      load();
    } catch (e) {
      setNoteError(e.message);
    } finally {
      setSavingNote(false);
    }
  }, [contact?.id, noteText, load]);

  if (!contact) return null;

  const nombre = `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "(Sin nombre)";
  const msgs   = detail?.messages || [];
  const notes  = detail?.notes    || [];
  const s      = detail?.stats    || {};
  const visibleMsgs = showAll ? msgs : msgs.slice(0, 20);

  // Calcular completitud de ambas encuestas
  const pcFilled     = ENCUESTA_PC.filter(f => hasValue(localContact[f.key])).length;
  const cierreFilled = ENCUESTA_CIERRE.filter(f => hasValue(localContact[f.key])).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden">

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
          <button onClick={onClose} className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Stats rápidas */}
        {!loading && detail && (
          <div className="flex gap-2 px-5 py-3 border-b border-zinc-800 shrink-0 overflow-x-auto">
            <StatPill icon={MessageSquare} label="Enviados"    value={s.sentMessages  ?? 0} color="gold"  />
            <StatPill icon={MessageSquare} label="Recibidos"   value={s.recvMessages  ?? 0} color="zinc"  />
            <StatPill icon={Phone}         label="Llamadas"    value={s.totalCalls    ?? 0} color="zinc"  />
            <StatPill icon={PhoneCall}     label="Contest."    value={s.answeredCalls ?? 0} color="green" />
            <StatPill icon={PhoneMissed}   label="Perdidas"    value={s.missedCalls   ?? 0} color="red"   />
            <StatPill icon={FileText}      label="Notas GHL"   value={s.totalNotes    ?? 0} color="zinc"  />
            {/* Completitud encuestas */}
            <div className="flex flex-col items-center gap-1 rounded-xl px-3 py-2 shrink-0 bg-zinc-800 text-zinc-300">
              <span className="text-[10px] opacity-70">Enc. PC</span>
              <span className={`text-lg font-bold ${pcFilled === ENCUESTA_PC.length ? "text-green-400" : pcFilled > 0 ? "text-gold-400" : "text-zinc-500"}`}>
                {pcFilled}/{ENCUESTA_PC.length}
              </span>
            </div>
            <div className="flex flex-col items-center gap-1 rounded-xl px-3 py-2 shrink-0 bg-zinc-800 text-zinc-300">
              <span className="text-[10px] opacity-70">Enc. Cierre</span>
              <span className={`text-lg font-bold ${cierreFilled === ENCUESTA_CIERRE.length ? "text-green-400" : cierreFilled > 0 ? "text-gold-400" : "text-zinc-500"}`}>
                {cierreFilled}/{ENCUESTA_CIERRE.length}
              </span>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3 pb-2 border-b border-zinc-800 shrink-0 overflow-x-auto">
          <TabBtn active={tab === "mensajes"} onClick={() => setTab("mensajes")}>
            💬 Mensajes {!loading && <span className="opacity-60">({msgs.length})</span>}
          </TabBtn>
          <TabBtn active={tab === "encuestas"} onClick={() => setTab("encuestas")}>
            📋 Encuestas
            {!loading && (pcFilled + cierreFilled > 0) && (
              <span className="ml-1 opacity-60">({pcFilled + cierreFilled}/{ENCUESTA_PC.length + ENCUESTA_CIERRE.length})</span>
            )}
          </TabBtn>
          <TabBtn active={tab === "notas"} onClick={() => setTab("notas")}>
            📝 Notas {!loading && <span className="opacity-60">({notes.length})</span>}
          </TabBtn>
          <TabBtn active={tab === "info"} onClick={() => setTab("info")}>👤 Info</TabBtn>
        </div>

        {/* Contenido scrollable */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center h-40 gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-gold-500" />
              <span className="text-sm text-zinc-400">Cargando…</span>
            </div>
          )}
          {!loading && error && (
            <div className="m-4 rounded-xl border border-red-800 bg-red-900/20 p-4 text-sm text-red-400">❌ {error}</div>
          )}

          {/* ── TAB: Mensajes ── */}
          {!loading && !error && tab === "mensajes" && (
            <div className="flex flex-col gap-2 p-4">
              {msgs.length === 0 ? (
                <p className="text-center text-sm text-zinc-500 py-8">Sin mensajes registrados</p>
              ) : (
                <>
                  {visibleMsgs.map((m, i) => <MessageBubble key={m.id || i} msg={m} />)}
                  {msgs.length > 20 && (
                    <button onClick={() => setShowAll(s => !s)} className="flex items-center justify-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 py-2 transition-colors">
                      {showAll ? <><ChevronUp size={12} /> Mostrar menos</> : <><ChevronDown size={12} /> Ver {msgs.length - 20} más</>}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── TAB: Encuestas ── */}
          {!loading && !error && tab === "encuestas" && (
            <div className="flex flex-col gap-4 p-4">
              <SurveySection
                title="Encuesta de Primer Contacto"
                emoji="📋"
                fields={ENCUESTA_PC}
                contact={localContact}
                onSave={handleSave}
                saving={saving}
              />
              <SurveySection
                title="Encuesta de Cierre Comercial"
                emoji="🏁"
                fields={ENCUESTA_CIERRE}
                contact={localContact}
                onSave={handleSave}
                saving={saving}
              />
            </div>
          )}

          {/* ── TAB: Notas ── */}
          {!loading && !error && tab === "notas" && (
            <div className="flex flex-col gap-3 p-4">

              {/* ── Agregar nota rápida ── */}
              <div className="rounded-xl border border-zinc-700 bg-zinc-800/30 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700/60 bg-zinc-800/50">
                  <Plus size={13} className="text-gold-400" />
                  <span className="text-xs font-semibold text-zinc-200">Nueva nota</span>
                </div>
                <div className="p-3 flex flex-col gap-2">
                  <textarea
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    rows={3}
                    placeholder="Escribe una nota para este contacto…"
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-gold-500/50 resize-none"
                  />
                  {noteError && (
                    <p className="text-xs text-red-400 flex items-center gap-1">❌ {noteError}</p>
                  )}
                  {noteSuccess && (
                    <p className="text-xs text-green-400 flex items-center gap-1"><CheckCircle size={11} /> Nota guardada correctamente</p>
                  )}
                  <div className="flex justify-end">
                    <button
                      onClick={handleAddNote}
                      disabled={savingNote || !noteText.trim()}
                      className="flex items-center gap-1.5 text-xs font-medium text-gold-400 hover:text-gold-300 border border-gold-500/40 hover:border-gold-500/70 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Send size={11} />
                      {savingNote ? "Guardando…" : "Guardar nota"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Contador */}
              {contact.sumaNotas && contact.sumaNotas !== "(No hay datos)" && (
                <div className="flex items-center gap-2 rounded-lg bg-gold-500/10 border border-gold-500/20 px-3 py-2">
                  <FileText size={13} className="text-gold-400 shrink-0" />
                  <span className="text-xs text-gold-300">
                    <strong className="text-gold-400">{contact.sumaNotas}</strong> notas registradas en total (campo GHL)
                  </span>
                </div>
              )}

              {/* Historial de notas */}
              {contact.historialNotas && contact.historialNotas !== "(No hay datos)" && (
                <div className="rounded-xl border border-zinc-700 bg-zinc-800/40 p-3">
                  <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider mb-2">📋 Historial de notas</p>
                  <p className="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">{stripHtml(contact.historialNotas)}</p>
                </div>
              )}

              {/* Notas GHL individuales */}
              {notes.length === 0 && (!contact.historialNotas || contact.historialNotas === "(No hay datos)") ? (
                <p className="text-center text-sm text-zinc-500 py-4">Sin notas registradas aún</p>
              ) : notes.length > 0 && (
                <>
                  <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider px-1">Notas GHL ({notes.length})</p>
                  {notes.map((n, i) => (
                    <div key={n.id || i} className="rounded-xl border border-zinc-800 bg-zinc-800/40 p-3">
                      <p className="text-xs text-zinc-500 mb-1.5">{formatDate(n.dateAdded)}</p>
                      <p className="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">{stripHtml(n.body) || "(Sin contenido)"}</p>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* ── TAB: Info ── */}
          {!loading && !error && tab === "info" && (
            <div className="p-4 space-y-2">
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
              ].filter(f => hasValue(f.value)).map(f => (
                <div key={f.label} className="flex gap-3 text-sm border-b border-zinc-800/60 pb-2">
                  <span className="text-zinc-500 w-36 shrink-0">{f.label}</span>
                  <span className="text-zinc-200">{f.value}</span>
                </div>
              ))}

              {/* Campos GHL brutos — debug */}
              {detail?.rawCustomFields?.length > 0 && (
                <details className="mt-4">
                  <summary className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-zinc-300 select-none py-1">
                    🔍 Campos GHL brutos ({detail.rawCustomFields.filter(f => f.value).length} con valor)
                  </summary>
                  <div className="mt-2 rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
                    {detail.rawCustomFields.filter(f => f.value !== null && f.value !== "").map((f, i) => (
                      <div key={i} className="flex gap-2 px-3 py-1.5 border-b border-zinc-800/60 last:border-0">
                        <span className="text-[10px] font-mono text-zinc-600 w-44 shrink-0 truncate" title={f.id}>{f.id}</span>
                        <span className="text-[10px] text-zinc-400 flex-1 truncate">{String(f.value)}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
