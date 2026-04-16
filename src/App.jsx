import { useState } from "react";
import { DataProvider, useData } from "./contexts/DataContext.jsx";
import Navbar from "./components/Navbar.jsx";
import LeadsView from "./views/LeadsView.jsx";
import ActividadView from "./views/ActividadView.jsx";
import ResumenView from "./views/ResumenView.jsx";
import { AlertTriangle, RefreshCw } from "lucide-react";

// ── Error banner ──────────────────────────────────────────────────────────────
function ErrorBanner() {
  const { error, refresh, loading } = useData();
  if (!error) return null;
  return (
    <div className="mx-auto mt-4 max-w-screen-2xl px-4 sm:px-6">
      <div className="flex items-center gap-3 rounded-xl border border-danger-400/30 bg-danger-400/10 px-4 py-3 text-sm text-danger-400">
        <AlertTriangle size={16} className="shrink-0" />
        <span className="flex-1">Error al conectar con GHL: {error}</span>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-md border border-danger-400/40 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-danger-400/10 disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          Reintentar
        </button>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState() {
  const { refresh, loading } = useData();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gold-500/10 ring-1 ring-gold-500/20">
        <span className="font-serif text-3xl text-gold-400">T</span>
      </div>
      <div>
        <h2 className="font-serif text-xl font-semibold text-cream">TDL Dashboard</h2>
        <p className="mt-2 max-w-sm text-sm text-cream-muted">
          Conecta con GoHighLevel para visualizar tus leads, actividad de asesores y resumen ejecutivo.
        </p>
      </div>
      <button
        onClick={refresh}
        disabled={loading}
        className="flex items-center gap-2 rounded-xl bg-gold-500 px-5 py-2.5 text-sm font-semibold text-dark-950 transition-all hover:bg-gold-400 active:scale-95 disabled:opacity-60"
      >
        <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        {loading ? "Sincronizando con GHL…" : "Sincronizar ahora"}
      </button>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-dark-800" />
        ))}
      </div>
      <div className="h-12 rounded-xl bg-dark-800" />
      <div className="h-72 rounded-xl bg-dark-800" />
    </div>
  );
}

// ── Dashboard (dentro del DataProvider) ──────────────────────────────────────
function Dashboard() {
  const [activeTab, setActiveTab] = useState("leads");
  const { data, loading } = useData();

  const showLoading = loading && !data;
  const showEmpty   = !loading && !data;

  return (
    <div className="min-h-screen bg-dark-900">
      <Navbar activeTab={activeTab} onTabChange={setActiveTab} />
      <ErrorBanner />

      <main className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6">
        {showLoading ? (
          <LoadingSkeleton />
        ) : showEmpty ? (
          <EmptyState />
        ) : (
          <>
            {activeTab === "leads"     && <LeadsView />}
            {activeTab === "actividad" && <ActividadView />}
            {activeTab === "resumen"   && <ResumenView />}
          </>
        )}
      </main>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <DataProvider>
      <Dashboard />
    </DataProvider>
  );
}
