// KPICard — tarjeta de métrica con ícono, valor y subtítulo opcional.
export default function KPICard({ icon: Icon, label, value, sub, color = "gold", className = "" }) {
  const colorMap = {
    gold:    { ring: "ring-gold-500/20",    bg: "bg-gold-500/10",    text: "text-gold-400"    },
    green:   { ring: "ring-success-400/20", bg: "bg-success-400/10", text: "text-success-400" },
    orange:  { ring: "ring-warning-400/20", bg: "bg-warning-400/10", text: "text-warning-400" },
    blue:    { ring: "ring-info-400/20",    bg: "bg-info-400/10",    text: "text-info-400"    },
    danger:  { ring: "ring-danger-400/20",  bg: "bg-danger-400/10",  text: "text-danger-400"  },
    neutral: { ring: "ring-dark-500",       bg: "bg-dark-700",       text: "text-cream-muted" },
  };
  const c = colorMap[color] ?? colorMap.neutral;

  return (
    <div className={`rounded-xl border border-dark-700 bg-dark-800 p-4 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-cream-dim">{label}</p>
          <p className={`truncate font-mono text-2xl font-semibold ${c.text}`}>{value ?? "—"}</p>
          {sub && <p className="mt-1 truncate text-xs text-cream-dim">{sub}</p>}
        </div>
        {Icon && (
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ${c.bg} ${c.ring}`}>
            <Icon size={17} className={c.text} />
          </div>
        )}
      </div>
    </div>
  );
}
