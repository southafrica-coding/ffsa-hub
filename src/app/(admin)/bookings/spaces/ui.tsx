// Small presentational helpers shared across the bookings views. No hooks, so
// these are safe to render from both server and client components.

import { cn } from "@/lib/utils/cn";
import { statusLabel, statusBrandClass } from "@/lib/bookings/status";

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
        "inline-flex items-center rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] whitespace-nowrap",
        statusBrandClass(status),
        className
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

export function ColorDot({
  color,
  className,
}: {
  color: string;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color }}
    />
  );
}
