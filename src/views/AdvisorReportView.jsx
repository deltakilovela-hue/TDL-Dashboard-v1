import { useMemo, useState, useEffect } from "react";
import { Users, MessageSquare, Phone, PhoneCall, PhoneMissed, FileText, Mail, Smartphone, ChevronLeft, ChevronRight, Database, Sparkles, RefreshCw } from "lucide-react";
import { useData } from "../contexts/DataContext.jsx";
import { EXCLUDED_USERS } from "./AdvisorWeeklyView.jsx";
import ContactModal, { stripHtml, renderSummaryLine } from "../components/ContactModal.jsx";

const MAX_LEADS_FOR_SUMMARY = 25; // limite de resumenes IA por corrida, para no disparar el costo en rangos "historico"

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

  // GHL a veces guarda actividad bajo el userId crudo en vez del nombre del
  // asesor (ej. si /users/ falló momentáneamente en el job nocturno). Se
  // filtra por si acaso, aunque scripts/sync-deep.mjs ya no debería producirlos.
  const looksLikeRawId = s => !s.includes(" ") && /^[a-zA-Z0-9]{15,}$/.test(s);

  const advisorNames = useMemo(() => {
    const names = new Set([
      ...(data?.usuarios || []).map(u => u.name).filter(Boolean),
      ...Object.keys(deepStats?.dailyStats || {}),
    ]);
    EXCLUDED_USERS.forEach(n => names.delete(n));
    names.delete("(Sin asignar)");
    return [...names].filter(n => !looksLikeRawId(n)).sort((a, b) => a.localeCompare(b, "es"));
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

  // GHL no guarda un historial de "cuándo se asignó" un lead — solo el estado
  // actual. Como proxy usamos dateAdded (cuándo entró el contacto), que en la
  // práctica coincide con cuándo se le asignó vía los flujos de distribución.
  // En "histórico" no se acota por fecha: es el total que tiene asignado hoy.
  const leadsAsignados = useMemo(() => {
    if (!data?.contacts) return 0;
    return data.contacts.filter(c => {
      if (c.assignedTo !== advisor) return false;
      if (rangeType === "historico") return true;
      const d = c.dateAdded && c.dateAdded !== "(No hay datos)" ? new Date(c.dateAdded) : null;
      return d && !isNaN(d) && from && d >= from && d <= to;
    }).length;
  }, [data, advisor, rangeType, from, to]);

  const usingDeep = !!deepStats?.dailyStats;
  const maxChannel = Math.max(agg.mensajesPorCanal.correo, agg.mensajesPorCanal.sms, agg.mensajesPorCanal.whatsappQr, agg.mensajesPorCanal.otros, 1);

  const contactsById = useMemo(() => {
    const map = {};
    (data?.contacts || []).forEach(c => { map[c.id] = c; });
    return map;
  }, [data]);

  // ── Detalle de notas (texto + contacto) — bajo demanda, no viene del cache ────
  const [noteDetail,        setNoteDetail]        = useState(null); // { byContact }
  const [noteDetailLoading, setNoteDetailLoading]  = useState(false);
  const [noteDetailError,   setNoteDetailError]    = useState(null);
  const [selectedContact,   setSelectedContact]    = useState(null);

  // ── Resumen de asesor por IA (usa el detalle de notas ya cargado) ────────────
  const [leadSummaries,        setLeadSummaries]        = useState(null); // [{contactId, name, dateAdded, summary|error}]
  const [leadSummariesLoading, setLeadSummariesLoading] = useState(false);

  // El detalle/resumen queda obsoleto si cambia el asesor o el rango
  useEffect(() => {
    setNoteDetail(null); setNoteDetailError(null);
    setLeadSummaries(null);
  }, [advisor, rangeType, from?.getTime(), to?.getTime()]);

  async function loadNoteDetail() {
    setNoteDetailLoading(true); setNoteDetailError(null);
    try {
      const contactIds = (data?.contacts || []).filter(c => c.assignedTo === advisor).map(c => c.id);
      if (contactIds.length === 0) { setNoteDetail({ byContact: {} }); return; }
      const r = await fetch("/api/advisor-notes-detail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds, from: from?.toISOString(), to: to?.toISOString() }),
      });
      const json = await r.json();
      if (!json.ok) { setNoteDetailError(json.error); return; }
      setNoteDetail(json);
    } catch (e) {
      setNoteDetailError(e.message);
    } finally {
      setNoteDetailLoading(false);
    }
  }

  const notesByDate = useMemo(() => {
    if (!noteDetail) return null;
    const map = {};
    Object.entries(noteDetail.byContact).forEach(([contactId, notes]) => {
      notes.forEach(n => {
        const day = (n.dateAdded || "").split("T")[0];
        if (!day) return;
        if (!map[day]) map[day] = [];
        map[day].push({ ...n, contactId });
      });
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [noteDetail]);

  async function generateLeadSummaries() {
    if (!noteDetail) return;
    const contactIds = Object.keys(noteDetail.byContact).slice(0, MAX_LEADS_FOR_SUMMARY);
    setLeadSummariesLoading(true);
    const results = [];
    const CONCURRENCY = 3;
    for (let i = 0; i < contactIds.length; i += CONCURRENCY) {
      const batch = contactIds.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(batch.map(async contactId => {
        const contact = contactsById[contactId];
        const name = contact ? (`${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "(Sin nombre)") : contactId;
        const notesText = noteDetail.byContact[contactId].map(n => stripHtml(n.body)).filter(Boolean).join("\n\n");
        try {
          const r = await fetch("/api/summarize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contactName: name, transcript: "", notes: notesText }),
          });
          const json = await r.json();
          if (!json.ok) return { contactId, name, contact, error: json.error };
          return { contactId, name, contact, summary: json.summary };
        } catch (e) {
          return { contactId, name, contact, error: e.message };
        }
      }));
      results.push(...batchResults);
    }
    setLeadSummaries(results);
    setLeadSummariesLoading(false);
  }

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
            <KpiCard icon={Users}         label="Leads asignados"    value={leadsAsignados}          sub={rangeType === "historico" ? "total actual" : "nuevos en el rango"} />
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
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-dark-700">
              <p className="text-sm font-semibold text-cream">Notas agregadas por fecha</p>
              {agg.notasTotal > 0 && !noteDetail && (
                <button
                  onClick={loadNoteDetail}
                  disabled={noteDetailLoading}
                  className="flex items-center gap-1.5 text-xs font-medium text-gold-400 hover:text-gold-300 border border-gold-500/40 hover:border-gold-500/70 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50 shrink-0"
                >
                  {noteDetailLoading
                    ? <><div className="h-3 w-3 animate-spin rounded-full border-2 border-gold-500/30 border-t-gold-400" /> Cargando…</>
                    : "Ver notas y contactos"}
                </button>
              )}
            </div>

            {noteDetailError && (
              <div className="px-5 py-3 text-xs text-danger-400 bg-danger-400/10 border-b border-danger-400/20">❌ {noteDetailError}</div>
            )}

            {agg.notasPorFecha.length === 0 ? (
              <p className="p-5 text-center text-sm text-cream-dim">Sin notas registradas en este rango.</p>
            ) : !notesByDate ? (
              // Vista rápida: solo conteos (viene del cache del job nocturno, sin costo)
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
            ) : (
              // Vista detallada: texto real + contacto (bajo demanda, en vivo desde GHL)
              <div className="max-h-[32rem] overflow-y-auto divide-y divide-dark-700/50">
                {notesByDate.map(([date, notes]) => (
                  <div key={date}>
                    <div className="sticky top-0 bg-dark-800/90 backdrop-blur-sm px-5 py-1.5 text-[11px] font-medium text-cream-dim uppercase tracking-wide">
                      {new Date(date).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · {notes.length} nota{notes.length !== 1 ? "s" : ""}
                    </div>
                    {notes.map(note => {
                      const contact = contactsById[note.contactId];
                      const name = contact ? (`${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "(Sin nombre)") : "(Contacto no encontrado)";
                      return (
                        <div key={note.id} className="px-5 py-2.5 border-t border-dark-700/30">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <button
                              onClick={() => contact && setSelectedContact(contact)}
                              className="text-sm font-medium text-cream hover:text-gold-400 transition-colors truncate disabled:cursor-default"
                              disabled={!contact}
                            >
                              {name}
                            </button>
                            <span className="text-[10px] text-cream-dim shrink-0">
                              {new Date(note.dateAdded).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <p className="text-xs text-cream-muted leading-relaxed line-clamp-3">{stripHtml(note.body) || "(Sin contenido)"}</p>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Resumen de asesor (IA) ── */}
          {noteDetail && Object.keys(noteDetail.byContact).length > 0 && (
            <div className="rounded-xl border border-gold-500/20 bg-dark-900 overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-dark-700">
                <div>
                  <p className="text-sm font-semibold text-cream flex items-center gap-1.5"><Sparkles size={14} className="text-gold-400" /> Resumen de asesor (IA)</p>
                  <p className="text-xs text-cream-dim mt-0.5">
                    Por cada lead con notas en el rango: cuándo se le asignó y un resumen de lo registrado.
                    {Object.keys(noteDetail.byContact).length > MAX_LEADS_FOR_SUMMARY && ` Limitado a los primeros ${MAX_LEADS_FOR_SUMMARY} leads — reduce el rango para cubrir el resto.`}
                  </p>
                </div>
                <button
                  onClick={generateLeadSummaries}
                  disabled={leadSummariesLoading}
                  className="flex items-center gap-1.5 text-xs font-medium text-gold-400 hover:text-gold-300 border border-gold-500/40 hover:border-gold-500/70 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50 shrink-0"
                >
                  {leadSummariesLoading
                    ? <><div className="h-3 w-3 animate-spin rounded-full border-2 border-gold-500/30 border-t-gold-400" /> Generando…</>
                    : leadSummaries
                      ? <><RefreshCw size={12} /> Regenerar</>
                      : <><Sparkles size={12} /> Generar resumen por lead</>}
                </button>
              </div>

              {leadSummaries && (
                <div className="max-h-[40rem] overflow-y-auto divide-y divide-dark-700/50">
                  {leadSummaries.map(({ contactId, name, contact, summary, error }) => (
                    <div key={contactId} className="px-5 py-4">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <button
                          onClick={() => contact && setSelectedContact(contact)}
                          className="text-sm font-semibold text-cream hover:text-gold-400 transition-colors disabled:cursor-default"
                          disabled={!contact}
                        >
                          {name}
                        </button>
                        {contact?.dateAdded && contact.dateAdded !== "(No hay datos)" && (
                          <span className="text-[11px] text-cream-dim shrink-0">
                            Asignado: {new Date(contact.dateAdded).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
                          </span>
                        )}
                      </div>
                      {error ? (
                        <p className="text-xs text-danger-400">❌ {error}</p>
                      ) : (
                        <div className="text-xs text-cream-muted">
                          {summary.split("\n").filter(l => l.trim()).map(renderSummaryLine)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {selectedContact && (
        <ContactModal contact={selectedContact} onClose={() => setSelectedContact(null)} />
      )}
    </div>
  );
}
