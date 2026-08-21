import { useState, useEffect } from "react";
import { DataProvider } from "./contexts/DataContext.jsx";
import Navbar from "./components/Navbar.jsx";
import ZoomControl from "./components/ZoomControl.jsx";
import AdvisorWeeklyView from "./views/AdvisorWeeklyView.jsx";
import AuditView from "./views/AuditView.jsx";
import AdvisorReportView from "./views/AdvisorReportView.jsx";

const ZOOM_KEY = "tdl_zoom_level";
const ZOOM_MIN = 70, ZOOM_MAX = 150, ZOOM_STEP = 10;

function getWeekOf(anchor = new Date()) {
  const d   = new Date(anchor);
  const day = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  return { from: mon, to: sun };
}

function Dashboard() {
  const [view, setView]  = useState("weekly"); // "weekly" | "audit" | "reporte"
  const [week, setWeek] = useState(() => getWeekOf());

  // Zoom de toda la app — algunas pantallas se ven muy apretadas en ciertas PCs.
  const [zoom, setZoom] = useState(() => {
    try { return Number(localStorage.getItem(ZOOM_KEY)) || 100; } catch { return 100; }
  });
  useEffect(() => { try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch {} }, [zoom]);
  const zoomOut = () => setZoom(z => Math.max(ZOOM_MIN, z - ZOOM_STEP));
  const zoomIn  = () => setZoom(z => Math.min(ZOOM_MAX, z + ZOOM_STEP));
  const zoomReset = () => setZoom(100);
  const zoomProps = { zoom, onZoomOut: zoomOut, onZoomIn: zoomIn, onReset: zoomReset };

  const prevWeek    = () => setWeek(w => getWeekOf(new Date(w.from.getTime() - 7 * 86_400_000)));
  const nextWeek    = () => setWeek(w => getWeekOf(new Date(w.to.getTime() + 1)));
  const currentWeek = () => setWeek(getWeekOf());

  // Escuchar el evento de navegación a semana desde el historial
  useEffect(() => {
    const handler = (e) => setWeek({ from: new Date(e.detail.from), to: new Date(e.detail.to) });
    window.addEventListener("tdl:gotoweek", handler);
    return () => window.removeEventListener("tdl:gotoweek", handler);
  }, []);

  const isCurrentWeek = getWeekOf().from.toDateString() === week.from.toDateString();

  if (view === "audit") {
    return (
      <div style={{ zoom: `${zoom}%` }} className="min-h-screen bg-zinc-900">
        <div className="border-b border-zinc-800 px-6 py-3 flex items-center gap-4">
          <button
            onClick={() => setView("weekly")}
            className="text-sm text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
          >
            ← Volver al Dashboard
          </button>
          <div className="ml-auto"><ZoomControl {...zoomProps} /></div>
        </div>
        <AuditView />
      </div>
    );
  }

  if (view === "reporte") {
    return (
      <div style={{ zoom: `${zoom}%` }} className="min-h-screen bg-dark-950">
        <div className="border-b border-dark-700 px-6 py-3 flex items-center gap-4">
          <button
            onClick={() => setView("weekly")}
            className="text-sm text-cream-dim hover:text-cream flex items-center gap-1 transition-colors"
          >
            ← Volver al Dashboard
          </button>
          <div className="ml-auto"><ZoomControl {...zoomProps} /></div>
        </div>
        <main className="mx-auto max-w-screen-xl px-4 sm:px-6 py-8">
          <AdvisorReportView />
        </main>
      </div>
    );
  }

  return (
    <div style={{ zoom: `${zoom}%` }} className="min-h-screen bg-dark-950">
      <Navbar
        week={week}
        isCurrentWeek={isCurrentWeek}
        onPrev={prevWeek}
        onNext={nextWeek}
        onCurrent={currentWeek}
        onAudit={() => setView("audit")}
        onReport={() => setView("reporte")}
        zoomProps={zoomProps}
      />
      <main className="mx-auto max-w-screen-xl px-4 sm:px-6 py-8">
        <AdvisorWeeklyView week={week} />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <DataProvider>
      <Dashboard />
    </DataProvider>
  );
}
