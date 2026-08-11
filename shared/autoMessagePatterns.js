// shared/autoMessagePatterns.js — Filtro de mensajes automáticos / bots
// Compartido entre src/views/AdvisorWeeklyView.jsx (frontend) y
// scripts/sync-deep.mjs (job nocturno de GitHub Actions), para que ambos
// excluyan exactamente los mismos mensajes de bot al contar actividad.
//
// Excluye mensajes de sistema, NancyBot y secuencias de nutrición automatizada.
// Agrega más patrones aquí cuando sea necesario — un solo lugar para los dos consumidores.
export const AUTO_PATTERNS = [
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

  // ── Notificaciones de asignación de lead ─────────────────────────────────────
  /se asign[oó] el lead/i,
  /al agente:\s*.+/i,

  // ── Notificaciones de formulario Facebook / Wayak ────────────────────────────
  /un lead acaba de llenar el formulario de facebook de wayak/i,
  /para informarte que:/i,
  /una persona est[aá] preguntando por wayak/i,
  /su nombre es\s+\w+\s*\.?\s*$/i,
  /¿en que te gustar[ií]a invertir\?/i,

  // ── Notificación de recorrido completado (Wayak) ──────────────────────────────
  /complet[oó] el recorrido por el sistema para wayak/i,
  /ahora puedes contactarlo desde la aplicaci[oó]n/i,

  // ── Notificaciones genéricas de lead/sistema ──────────────────────────────────
  /el lead\s+\w.*complet[oó]/i,
  /nuevo lead\s+(registrado|asignado|recibido)/i,
  /lead\s+asignado\s+a/i,
  /se\s+ha\s+asignado\s+(un\s+)?lead/i,
  /formulario\s+de\s+(facebook|instagram|google|web)/i,
  /llen[oó]\s+el\s+formulario/i,

  // ── Seguimiento automático de citas ──────────────────────────────────────────
  /tu\s+cita\s+(ha\s+sido\s+)?(confirmada|cancelada|reagendada|programada)/i,
  /recordatorio\s+de\s+(tu\s+)?cita/i,
  /tienes\s+una\s+cita\s+(programada|confirmada)/i,
  /te\s+esperamos\s+(el|mañana|hoy)\s+en\s+(tu\s+)?cita/i,

  // ── Mensajes de bienvenida automatizados ─────────────────────────────────────
  /gracias\s+por\s+(tu\s+)?(inter[eé]s|contacto|mensaje)\s+en\s+(?:oasis|ananta|taller del ladrillo|wayak)/i,
  /bienvenido.*(?:oasis|ananta|taller del ladrillo|wayak)/i,
  /hola.*recib[íi](?:mos|)\s+tu\s+(solicitud|mensaje|formulario|información)/i,

  // ── Mensajes de seguimiento de pipeline ──────────────────────────────────────
  /pipeline\s+stage\s+changed/i,
  /etapa\s+cambiada?\s+a/i,
];

export function isAutoMessage(text) {
  if (!text || !text.trim()) return false;
  const t = text.trim();
  return AUTO_PATTERNS.some(p => p.test(t));
}

// ── messageType de GHL que son logs de sistema, no comunicación real ───────────
// (TYPE_ACTIVITY_OPPORTUNITY = "Opportunity updated", TYPE_ACTIVITY_EMPLOYEE_ACTION_LOG
// = "Employee action log created", etc. — confirmado contra la API real de GHL)
export function isSystemActivityType(messageType) {
  return /^TYPE_ACTIVITY_/i.test(String(messageType || ""));
}
