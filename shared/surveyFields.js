// shared/surveyFields.js — Encuestas de agente (fuente única de verdad)
// Compartido entre api/sync.js, la ficha de contacto (ContactModal) y las
// tarjetas de asesor (AdvisorWeeklyView), para que los tres usen los mismos
// campos de GHL.
//
// Son 4 carpetas de campos personalizados en GHL. IDs, tipos, opciones y orden
// verificados contra /locations/{id}/customFields (orden = `position` en GHL).
// Las opciones deben coincidir EXACTO con GHL (incluyendo emojis) — si no, al
// editar desde la ficha se guardaría un valor que GHL no reconoce.
//
// Tipos: select/radio (botones de opción), text, textarea, number, date.
// Las fechas GHL las guarda como timestamp en ms (medianoche UTC).

export const SURVEY_GROUPS = [
  {
    key: "cicloVida", title: "Ciclo de vida", short: "CV", emoji: "🔄",
    fields: [
      { key: "cicloVida", id: "4WzQjRM0Jo3Plp37Y7IG", label: "Ciclo de Vida", type: "select",
        options: ["Suscriptor", "Lead", "MQL", "SQL", "Oportunidad", "Cliente", "Evangelista", "Otra"] },
    ],
  },
  {
    key: "perfil", title: "Perfil inmobiliario", short: "PI", emoji: "🏠",
    fields: [
      { key: "proyectoInteres", id: "GKbXkflRXnAqW9LIkQCS", label: "Proyecto de interés", type: "select",
        options: ["Oasis Ananta", "Aldea Ananta", "Mangata Golf & Living", "Wayak Club", "Ananta Baja Living", "Casa El Cielo", "Listing", "Sin definir"] },
      { key: "tipoPropiedad", id: "R4XkVRs6tU3ZiV88PIrs", label: "Tipo de propiedad", type: "select",
        options: ["Departamento", "Villa", "Casa", "Lote residencial", "Penthouse", "Sin definir"] },
      { key: "presupuesto", id: "XPJiJOI5nVLNXzEXlrDp", label: "💸 Presupuesto estimado", type: "text" },
      { key: "recamaras", id: "XBMYNBgExtbYbkls0Q2J", label: "Número de recámaras", type: "number" },
      { key: "formaPago", id: "JG2MqOtInCJ4gS521wTV", label: "Forma de pago", type: "select",
        options: ["Recursos propios", "Crédito hipotecario", "Financiamiento TDL", "Mixto", "Sin definir"] },
      { key: "preventaEntrega", id: "TodpdMfU9ToLF4VxtZG6", label: "¿Busca preventa o entrega inmediata?", type: "select",
        options: ["Preventa", "Entrega inmediata", "Indiferente", "Sin definir"] },
      { key: "medioContacto", id: "D1bAtBu1yhE3aigqdLCj", label: "Medio de contacto de preferencia", type: "radio",
        options: ["📞 Llamada", "💬 WhatsApp", "📧 Correo electrónico", "🎥 Zoom", "🔄 Otro"] },
      { key: "notaPrimerContacto", id: "UaloobEyDQTsCu41WUnU", label: "Comentario de NOTA primer contacto", type: "textarea" },
    ],
  },
  {
    key: "cita", title: "Cita", short: "CT", emoji: "📅",
    fields: [
      { key: "deseaCita", id: "GhEmwRVvGcPSap7NnZsP", label: "📆 ¿Desea agendar una cita?", type: "radio",
        options: ["✅ Sí", "❌ No"] },
      { key: "sePresentoCita", id: "dsbgL3vWgCuiHPThBrj0", label: "¿Se presentó a la cita?", type: "select",
        options: ["Sí", "No", "Reagendó", "Pendiente"] },
      { key: "tipoCita", id: "Kfx8xOs1NC9hIuTXAFor", label: "📍 Tipo de cita", type: "radio",
        options: ["👥 Presencial", "📞 Llamada", "🎥 Zoom"] },
    ],
  },
  {
    key: "seguimiento", title: "Seguimiento comercial", short: "SC", emoji: "🏁",
    fields: [
      { key: "resultadoSeguimiento", id: "jPs7FluMqwHaA7mkZHvD", label: "Resultado del seguimiento", type: "select",
        options: ["Contactado", "Sin respuesta", "Seguimiento acordado", "No interesado", "En proceso de compra", "Descartar"] },
      { key: "requiereCloser", id: "mPBM192trmYBC5ZY0xxo", label: "🔁 ¿Requiere intervención de un closer u otro equipo?", type: "radio",
        options: ["✅ Sí", "❌ No"] },
      { key: "fechaCierre", id: "TFPJmo94s7rXwhYmJNQb", label: "🗓️ Fecha tentativa de compra/cierre", type: "date" },
      { key: "notaAsesor", id: "KARIFTmgIzdlCPBYX0IL", label: "Nota del asesor", type: "textarea" },
    ],
  },
];

export const SURVEY_FIELDS = SURVEY_GROUPS.flatMap(g => g.fields);

// Campos de texto libre que cuentan como "nota del asesor" en el dashboard
export const NOTE_FIELDS = [
  { key: "notaPrimerContacto", label: "Primer contacto" },
  { key: "notaAsesor",         label: "Nota del asesor" },
];

export function hasSurveyValue(v) {
  return v !== null && v !== undefined && v !== "" && v !== "(No hay datos)" && v !== "--";
}

// Fecha GHL (timestamp ms, medianoche UTC) → "26 jul 2026". Se formatea en UTC:
// en Mazatlán (UTC-7) new Date(ms) caería en el día anterior.
export function formatSurveyDate(v) {
  if (!hasSurveyValue(v)) return null;
  const n = Number(v);
  const d = Number.isFinite(n) && String(v).length >= 10 ? new Date(n) : new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// Fecha GHL → "YYYY-MM-DD" para <input type="date">
export function surveyDateToInput(v) {
  if (!hasSurveyValue(v)) return "";
  const n = Number(v);
  const d = Number.isFinite(n) && String(v).length >= 10 ? new Date(n) : new Date(v);
  return isNaN(d) ? "" : d.toISOString().slice(0, 10);
}

// Completitud de cada encuesta para un contacto: { cicloVida: {filled,total,pct}, ..., total: {...} }
export function surveyCompletion(contact) {
  const out = {};
  let filled = 0, total = 0;
  for (const g of SURVEY_GROUPS) {
    const f = g.fields.filter(x => hasSurveyValue(contact?.[x.key])).length;
    out[g.key] = { filled: f, total: g.fields.length, pct: Math.round((f / g.fields.length) * 100) };
    filled += f; total += g.fields.length;
  }
  out.total = { filled, total, pct: Math.round((filled / total) * 100) };
  return out;
}
