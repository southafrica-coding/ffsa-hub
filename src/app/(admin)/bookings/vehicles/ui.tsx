// Small presentational helpers shared across the vehicle-rental views.

import { statusLabel, statusPillStyle } from "@/lib/vehicles/status";

export function StatusPill({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const s = statusPillStyle(status);
  return (
    <span
      className={
        "inline-flex items-center rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] whitespace-nowrap " +
        (className ?? "")
      }
      style={{
        background: s.background,
        color: s.color,
        textDecoration: s.textDecoration,
        opacity: s.opacity,
      }}
    >
      {statusLabel(status)}
    </span>
  );
}

export function ColorDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={"inline-block h-2.5 w-2.5 shrink-0 rounded-full " + (className ?? "")}
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
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {vehicles.map((v) => (
        <span key={v.id} className="inline-flex items-center gap-1.5 text-foreground">
          <ColorDot color={v.color} />
          {v.name}
        </span>
      ))}
    </span>
  );
}
