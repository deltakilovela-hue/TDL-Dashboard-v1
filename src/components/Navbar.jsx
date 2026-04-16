import { ChevronLeft, ChevronRight, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useData } from "../contexts/DataContext.jsx";

function formatWeekLabel(week) {
  const opts = { day: "numeric", month: "short" };
  const from = week.from.toLocaleDateString("es-MX", opts);
  const to   = week.to.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
  return `${from} – ${to}`;
}

function relativeTime(date) {
  if (!date) return null;
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60)    return "hace un momento";
  if (diff < 3600)  return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return `hace ${Math.floor(diff / 86400)} d`;
}

export default function Navbar({ week, isCurrentWeek, onPrev, onNext, onCurrent }) {
  const { data, loading, error, lastSync, refresh } = useData();

  return (
    <header className="sticky top-0 z-50 border-b border-dark-700 bg-dark-950/90 backdrop-blur-md">
      <div className="mx-auto max-w-screen-xl px-4 sm:px-6">
        <div className="flex h-14 items-center gap-4">

          {/* Logo */}
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gold-500/20 ring-1 ring-gold-500/40">
              <span className="font-serif text-sm font-bold text-gold-400">T</span>
            </div>
            <span className="hidden font-serif text-base font-semibold tracking-wide text-gold-400 sm:block">
              TDL Dashboard
            </span>
          </div>

          <div className="hidden h-6 w-px bg-dark-600 sm:block" />

          {/* Navegador de semanas */}
          <div className="flex flex-1 items-center justify-center gap-1">
            <button
              onClick={onPrev}
              className="flex h-8 w-8 items-center justify-center rounded-md text-cream-muted transition-colors hover:bg-dark-700 hover:text-cream"
              title="Semana anterior"
            >
              <ChevronLeft size={16} />
            </button>

            <button
              onClick={onCurrent}
              className={[
                "min-w-[200px] rounded-md px-3 py-1.5 text-center text-sm font-medium transition-all",
                isCurrentWeek
                  ? "bg-gold-500/15 text-gold-400 ring-1 ring-gold-500/30"
                  : "text-cream-muted hover:bg-dark-700 hover:text-cream",
              ].join(" ")}
            >
              {isCurrentWeek ? "Esta semana · " : ""}{formatWeekLabel(week)}
            </button>

            <button
              onClick={onNext}
              disabled={isCurrentWeek}
              className="flex h-8 w-8 items-center justify-center rounded-md text-cream-muted transition-colors hover:bg-dark-700 hover:text-cream disabled:cursor-not-allowed disabled:opacity-30"
              title="Semana siguiente"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Derecha: estado + sync */}
          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden items-center gap-1.5 sm:flex">
              {error ? (
                <><WifiOff size={13} className="text-danger-400" /><span className="text-xs text-danger-400">Error</span></>
              ) : data ? (
                <><Wifi size={13} className="text-success-400" />
                  <span className="text-xs text-cream-dim">
                    {lastSync ? relativeTime(lastSync) : ""}{data.total ? ` · ${data.total} contactos` : ""}
                  </span></>
              ) : null}
            </div>

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
