// Badge — etiquetas de color para niveles, estados y sí/no.

function getInterestStyle(value) {
  const v = String(value || "").toLowerCase().trim();
  if (!v || v === "(no hay datos)" || v === "n/a" || v === "—")
    return "bg-dark-600/60 text-cream-dim border-dark-500";
  if (v.includes("alto") || v.includes("caliente") || v.includes("muy") || v === "5")
    return "bg-success-400/10 text-success-400 border-success-400/30";
  if (v.includes("medio") || v.includes("tibio") || v.includes("moderado") || v === "3" || v === "4")
    return "bg-gold-500/10 text-gold-400 border-gold-500/30";
  if (v.includes("bajo") || v.includes("frío") || v.includes("frio") || v.includes("poco") || v === "1" || v === "2")
    return "bg-info-400/10 text-info-400 border-info-400/30";
  return "bg-dark-600/60 text-cream-muted border-dark-500";
}

function getYesNoStyle(value) {
  const v = String(value || "").toLowerCase().trim();
  if (!v || v === "(no hay datos)") return "bg-dark-600/60 text-cream-dim border-dark-500";
  if (v === "sí" || v === "si" || v === "yes" || v === "true")
    return "bg-success-400/10 text-success-400 border-success-400/30";
  if (v === "no" || v === "false")
    return "bg-danger-400/10 text-danger-400 border-danger-400/30";
  return "bg-dark-600/60 text-cream-muted border-dark-500";
}

function getPipelineStyle(pipeline) {
  const p = String(pipeline || "").toLowerCase();
  if (p.includes("cierre") || p.includes("02"))    return "bg-success-400/10 text-success-400 border-success-400/30";
  if (p.includes("rentas") || p.includes("renta"))  return "bg-info-400/10 text-info-400 border-info-400/30";
  if (p.includes("desarrollos") || p.includes("01")) return "bg-gold-500/10 text-gold-400 border-gold-500/30";
  return "bg-dark-600/60 text-cream-muted border-dark-500";
}

export default function Badge({ value, type = "default", className = "" }) {
  const display = !value || value === "(No hay datos)" ? "—" : value;

  let style = "bg-dark-600/60 text-cream-muted border-dark-500";
  if (type === "interest")  style = getInterestStyle(value);
  if (type === "yesno")     style = getYesNoStyle(value);
  if (type === "pipeline")  style = getPipelineStyle(value);

  return (
    <span
      className={[
        "inline-block rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium leading-tight",
        style,
        className,
      ].join(" ")}
    >
      {display}
    </span>
  );
}
