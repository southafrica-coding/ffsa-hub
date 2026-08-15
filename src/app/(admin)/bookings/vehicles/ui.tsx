// Small presentational helpers shared across the vehicle-rental views.

import { cn } from "@/lib/utils/cn";
import { statusLabel } from "@/lib/vehicles/status";

// Tone mapping lives here rather than in src/lib/vehicles/status.ts because the
// lib helper still returns the old dark-theme fills; the design system's pills
// are outlined only. "Completed" reads quiet — it is done, not pending action.
const TONE: Record<string, string> = {
  approved: "border-grass text-grass-text",
  pending: "border-amber-border text-amber",
  denied: "border-destructive text-destructive",
  cancelled: "border-rule-strong text-[#55524A]",
  completed: "border-rule-strong text-[#55524A]",
};

export function StatusPill({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap border px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em]",
        TONE[status] ?? TONE.cancelled,
        className
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

export function ColorDot({ color, className }: { color: string; className?: string }) {
  // Square, like every other mark in the system — the vehicle colour is data,
  // so it stays, but the shape does not.
  return (
    <span
      className={cn("inline-block h-2.5 w-2.5 shrink-0", className)}
      style={{ backgroundColor: color }}
    />
  );
}

/** Renders the vehicles assigned to a booking (dots + names), or a dash. */
export function AssignedVehicles({
  assignments,
}: {
  assignments?: { vehicle: { id: string; name: string; color: string } | null }[] | null;
}) {
  const vehicles = (assignments ?? []).map((a) => a.vehicle).filter(Boolean) as {
    id: string;
    name: string;
    color: string;
  }[];
  if (vehicles.length === 0) {
    return <span className="text-[color:var(--text-tertiary)]">—</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {vehicles.map((v) => (
        <span key={v.id} className="inline-flex items-center gap-1.5 text-[color:var(--text-primary)]">
          <ColorDot color={v.color} />
          {v.name}
        </span>
      ))}
    </span>
  );
}
