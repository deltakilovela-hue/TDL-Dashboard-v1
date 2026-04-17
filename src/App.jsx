import { useState } from "react";
import { DataProvider } from "./contexts/DataContext.jsx";
import Navbar from "./components/Navbar.jsx";
import AdvisorWeeklyView from "./views/AdvisorWeeklyView.jsx";
import AuditView from "./views/AuditView.jsx";

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
  const [view, setView]  = useState("weekly"); // "weekly" | "audit"
  const [week, setWeek] = useState(() => getWeekOf());

  const prevWeek    = () => setWeek(w => getWeekOf(new Date(w.from.getTime() - 7 * 86_400_000)));
  const nextWeek    = () => setWeek(w => getWeekOf(new Date(w.to.getTime() + 1)));
  const currentWeek = () => setWeek(getWeekOf());

  const isCurrentWeek = getWeekOf().from.toDateString() === week.from.toDateString();

  if (view === "audit") {
    return (
      <div className="min-h-screen bg-zinc-900">
        <div className="border-b border-zinc-800 px-6 py-3 flex items-center gap-4">
          <button
            onClick={() => setView("weekly")}
            className="text-sm text-zinc-400 hover:text-white flex items-center gap-1 transition-colors"
          >
            ← Volver al Dashboard
          </button>
        </div>
        <AuditView />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-950">
      <Navbar
        week={week}
        isCurrentWeek={isCurrentWeek}
        onPrev={prevWeek}
        onNext={nextWeek}
        onCurrent={currentWeek}
        onAudit={() => setView("audit")}
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
