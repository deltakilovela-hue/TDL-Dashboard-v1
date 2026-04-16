import { RefreshCw, LayoutList, Activity, BarChart2, Wifi, WifiOff } from "lucide-react";
import { useData } from "../contexts/DataContext.jsx";

const TABS = [
  { id: "leads",     label: "Leads",           icon: LayoutList },
  { id: "actividad", label: "Actividad",        icon: Activity   },
  { id: "resumen",   label: "Resumen",          icon: BarChart2  },
];

function relativeTime(date) {
  if (!date) return null;
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60)        return "hace un momento";
  if (diff < 3600)      return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400)     return `hace ${Math.floor(diff / 3600)} h`;
  return `hace ${Math.floor(diff / 86400)} d`;
}

export default function Navbar({ activeTab, onTabChange }) {
  const { data, loading, error, lastSync, refresh } = useData();

  return (
    <header className="sticky top-0 z-50 border-b border-dark-700 bg-dark-950/90 backdrop-blur-md">
      <div className="mx-auto max-w-screen-2xl px-4 sm:px-6">
        <div className="flex h-14 items-center gap-6">

          {/* Logo */}
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gold-500/20 ring-1 ring-gold-500/40">
              <span className="font-serif text-sm font-bold text-gold-400">T</span>
            </div>
            <span className="hidden font-serif text-base font-semibold tracking-wide text-gold-400 sm:block">
              TDL Dashboard
            </span>
          </div>

          {/* Separador vertical */}
          <div className="hidden h-6 w-px bg-dark-600 sm:block" />

          {/* Tabs de navegación */}
          <nav className="flex flex-1 items-center gap-1">
            {TABS.map(({ id, label, icon: Icon }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => onTabChange(id)}
                  className={[
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                    active
                      ? "bg-gold-500/15 text-gold-400 ring-1 ring-gold-500/30"
                      : "text-cream-muted hover:bg-dark-700 hover:text-cream",
                  ].join(" ")}
                >
                  <Icon size={14} />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              );
            })}
          </nav>

          {/* Estado + botón sync */}
          <div className="flex shrink-0 items-center gap-3">
            {/* Indicador de estado */}
            <div className="hidden items-center gap-1.5 sm:flex">
              {error ? (
                <><WifiOff size={13} className="text-danger-400" />
                  <span className="text-xs text-danger-400">Error de conexión</span></>
              ) : data ? (
                <><Wifi size={13} className="text-success-400" />
                  <span className="text-xs text-cream-dim">
                    {lastSync ? relativeTime(lastSync) : ""}
                    {data.total ? ` · ${data.total} leads` : ""}
                  </span></>
              ) : null}
            </div>

            {/* Botón sincronizar */}
            <button
              onClick={refresh}
              disabled={loading}
              className={[
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium ring-1 transition-all",
                loading
                  ? "cursor-not-allowed opacity-50 ring-dark-500 text-cream-dim"
                  : "ring-gold-500/40 text-gold-400 hover:bg-gold-500/10 hover:ring-gold-500/60 active:scale-95",
              ].join(" ")}
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              <span className="hidden sm:inline">{loading ? "Sincronizando…" : "Sincronizar"}</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
