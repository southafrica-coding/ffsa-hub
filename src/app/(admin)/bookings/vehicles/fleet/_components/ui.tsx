// Small presentational pieces shared by the Fleet screens. Server-safe (no hooks).

import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import type { Alert, Sev } from "@/lib/fleet/rules";

export const FLEET = "/bookings/vehicles/fleet";
export const vehicleHref = (id: string, tab?: string) => `${FLEET}/${id}${tab && tab !== "overview" ? `?tab=${tab}` : ""}`;
/** Where a Fleet photo or PDF is served (the Fleet app's /_blob/<id>). */
export const fileUrl = (id: string) => `/api/vehicles/fleet/files/${id}`;

/** The registration as a small number plate. */
export function Plate({ reg, className }: { reg?: string | null; className?: string }) {
  if (!reg) return null;
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap border border-ink bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.08em] text-ink",
        className
      )}
    >
      {reg}
    </span>
  );
}

// crit = red, warn = amber, info = quiet; ok = green. Squares, like every mark here.
const SEV_BG: Record<string, string> = { crit: "bg-destructive", warn: "bg-amber-border", info: "bg-rule-strong", ok: "bg-grass" };
export function SevDot({ sev, className }: { sev: Sev | "ok"; className?: string }) {
  return <span aria-hidden className={cn("mt-1.5 inline-block h-2.5 w-2.5 shrink-0", SEV_BG[sev], className)} />;
}
export const sevLabel = (sev: Sev | "ok") => (sev === "crit" ? "Urgent" : sev === "warn" ? "Soon" : sev === "ok" ? "OK" : "Note");
export const sevTone = (sev: Sev | "ok") => (sev === "crit" ? "bad" : sev === "warn" ? "warn" : sev === "ok" ? "good" : "quiet") as "bad" | "warn" | "quiet" | "good";

/** A list of alerts, worst first, each with an optional link to the tab it's about. */
export function AlertList({ alerts, vehicleId, empty }: { alerts: Alert[]; vehicleId?: string; empty?: string }) {
  if (!alerts.length) return <p className="px-5 py-4 text-[13px] text-[#55524A] md:px-8">{empty || "Nothing needs attention."}</p>;
  return (
    <ul className="divide-y divide-rule">
      {alerts.map((a, i) => (
        <li key={i} className="flex gap-3 px-5 py-3 text-[14px] leading-snug md:px-8">
          <SevDot sev={a.sev} />
          <span className="min-w-0 flex-1">
            <span className="sr-only">{sevLabel(a.sev)}: </span>
            {a.text}
            {a.tab && vehicleId && (
              <>
                {" "}
                <Link href={vehicleHref(vehicleId, a.tab)} className="whitespace-nowrap font-mono text-[10px] font-bold uppercase tracking-[0.12em] underline">
                  Open
                </Link>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Label/value rows (vehicle details, key dates). Stacks on phones. */
export function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== false);
  if (!shown.length) return null;
  return (
    <dl className="divide-y divide-rule">
      {shown.map(([k, v]) => (
        <div key={k} className="grid grid-cols-1 gap-0.5 px-5 py-2.5 sm:grid-cols-[180px_1fr] sm:gap-4 md:px-8">
          <dt className="mono-label">{k}</dt>
          <dd className="min-w-0 break-words text-[14px]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A 44px+ square action button styled like the Hub's masthead buttons. */
export function ActionButton({
  children,
  onClick,
  tone = "outline",
  disabled,
  type = "button",
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: "solid" | "outline";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-11 items-center justify-center border px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] disabled:opacity-50",
        tone === "solid" ? "border-ink bg-ink text-white hover:bg-[#262622]" : "border-ink bg-white text-ink hover:bg-bone",
        className
      )}
    >
      {children}
    </button>
  );
}
