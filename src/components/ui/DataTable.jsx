import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 20;

// columns: [{ key, label, render?, sortable?, width? }]
// rows: array of objects
export default function DataTable({ columns, rows, emptyMessage = "Sin datos", className = "" }) {
  const [sortKey, setSortKey]   = useState(null);
  const [sortDir, setSortDir]   = useState("asc");
  const [page,    setPage]      = useState(1);

  // Ordenamiento
  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const av = String(a[sortKey] ?? "").toLowerCase();
      const bv = String(b[sortKey] ?? "").toLowerCase();
      const n  = av.localeCompare(bv, "es", { numeric: true });
      return sortDir === "asc" ? n : -n;
    });
  }, [rows, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const slice      = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  }

  function SortIcon({ colKey }) {
    if (sortKey !== colKey) return <ChevronsUpDown size={12} className="text-cream-dim" />;
    return sortDir === "asc"
      ? <ChevronUp size={12} className="text-gold-400" />
      : <ChevronDown size={12} className="text-gold-400" />;
  }

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Tabla */}
      <div className="overflow-x-auto rounded-xl border border-dark-700">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b border-dark-700 bg-dark-800">
              {columns.map(col => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width, minWidth: col.width } : { minWidth: 100 }}
                  className={[
                    "px-4 py-2.5 text-left font-medium",
                    col.sortable !== false
                      ? "cursor-pointer select-none text-cream-muted hover:text-cream"
                      : "text-cream-dim",
                  ].join(" ")}
                  onClick={() => col.sortable !== false && handleSort(col.key)}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] uppercase tracking-wider">{col.label}</span>
                    {col.sortable !== false && <SortIcon colKey={col.key} />}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-16 text-center text-cream-dim">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              slice.map((row, i) => (
                <tr
                  key={row.id ?? i}
                  className="border-b border-dark-700/50 transition-colors last:border-0 hover:bg-dark-750"
                >
                  {columns.map(col => (
                    <td key={col.key} className="px-4 py-3 text-sm text-cream">
                      {col.render ? col.render(row[col.key], row) : (
                        <span className={!row[col.key] || row[col.key] === "(No hay datos)"
                          ? "text-cream-dim" : ""}>
                          {row[col.key] ?? "—"}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-cream-dim">
          <span>
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} de {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-dark-600 transition-colors hover:border-dark-500 hover:text-cream disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={13} />
            </button>
            <span className="px-2 tabular-nums">{page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-dark-600 transition-colors hover:border-dark-500 hover:text-cream disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
