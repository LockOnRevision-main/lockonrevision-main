import { RefreshCw } from "lucide-react";

export function LoadingSpinner({ size = "default", className = "" }) {
  const sizeClass = size === "lg" ? "loading-spinner-lg" : "loading-spinner";
  return (
    <div
      className={`${sizeClass} animate-spin-slow rounded-full border-primary/20 border-t-primary ${className}`}
      role="status"
      aria-label="Loading"
      style={{ willChange: "transform", transform: "translateZ(0)" }}
    />
  );
}

export function LoadingOverlay({ progress = 0, stage = "Processing...", visible = true }) {
  if (!visible) return null;
  const pct = Math.round(Math.min(100, Math.max(0, progress)));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface/80 backdrop-blur-sm p-4">
      <div className="loading-overlay-card flex flex-col items-center gap-4 text-center animate-fadeIn">
        <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center shadow-lg shadow-secondary/20 shrink-0" style={{ width: "clamp(3rem, 10vw, 4rem)", height: "clamp(3rem, 10vw, 4rem)" }}>
          <RefreshCw
            className="text-white animate-spin-slow"
            style={{ width: "clamp(1.5rem, 5vw, 2rem)", height: "clamp(1.5rem, 5vw, 2rem)", willChange: "transform" }}
            aria-hidden="true"
          />
        </div>

        <div className="space-y-1">
          <div className="loading-overlay-title font-bold text-text-primary leading-tight">{stage}</div>
          <div className="loading-overlay-subtitle font-medium text-text-secondary">{pct}% complete</div>
        </div>

        <div className="loading-progress-track bg-background rounded-full overflow-hidden border border-border/50">
          <div
            className="h-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>

        <div className="loading-step-text font-bold uppercase tracking-widest text-text-muted">
          Please wait — meaningful work is happening
        </div>
      </div>
    </div>
  );
}

export default LoadingOverlay;
