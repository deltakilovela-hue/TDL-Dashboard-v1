import { createContext, useContext, useState, useEffect, useCallback } from "react";

const DataContext = createContext(null);

const LS_KEY     = "tdl_ghl_v2";
const LS_TTL_MS  = 30 * 60 * 1000; // 30 min

function loadFromLS() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const { ts, payload } = JSON.parse(raw);
    if (Date.now() - ts > LS_TTL_MS) return null;
    return payload;
  } catch { return null; }
}

function saveToLS(payload) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ts: Date.now(), payload }));
  } catch {}
}

export function DataProvider({ children }) {
  const [data,     setData]     = useState(null);     // payload completo de /api/sync
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [lastSync, setLastSync] = useState(null);

  const fetchData = useCallback(async (force = false) => {
    // Si no es forzado, intentar desde localStorage
    if (!force) {
      const cached = loadFromLS();
      if (cached) {
        setData(cached);
        setLastSync(cached.updatedAt ? new Date(cached.updatedAt) : null);
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const url = force ? "/api/sync?force=true" : "/api/sync";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Error en /api/sync");

      setData(json);
      setLastSync(json.updatedAt ? new Date(json.updatedAt) : new Date());
      saveToLS(json);
    } catch (e) {
      console.error("DataContext fetch:", e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Carga inicial
  useEffect(() => { fetchData(false); }, [fetchData]);

  return (
    <DataContext.Provider value={{ data, loading, error, lastSync, refresh: () => fetchData(true) }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData debe usarse dentro de <DataProvider>");
  return ctx;
}
