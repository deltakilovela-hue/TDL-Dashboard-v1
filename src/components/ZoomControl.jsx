import { ZoomIn, ZoomOut } from "lucide-react";

// Control de zoom de toda la app — usa CSS `zoom` (Chrome/Edge/Safari) sobre
// un wrapper en App.jsx. Se persiste en localStorage para que cada quien
// vea el dashboard a su tamaño preferido en cada PC.
export default function ZoomControl({ zoom, onZoomOut, onZoomIn, onReset }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-md ring-1 ring-white/15 px-0.5 py-0.5" title="Zoom del dashboard">
      <button
        onClick={onZoomOut}
        disabled={zoom <= 70}
        className="flex h-6 w-6 items-center justify-center rounded text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ZoomOut size={12} />
      </button>
      <button
        onClick={onReset}
        className="w-9 text-center text-[11px] tabular-nums text-white/60 hover:text-white transition-colors"
        title="Restablecer a 100%"
      >
        {zoom}%
      </button>
      <button
        onClick={onZoomIn}
        disabled={zoom >= 150}
        className="flex h-6 w-6 items-center justify-center rounded text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ZoomIn size={12} />
      </button>
    </div>
  );
}
