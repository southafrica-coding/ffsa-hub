// Display pieces shared by the Vehicles list and the vehicle page. Server-safe (no hooks).

import { cn } from "@/lib/utils/cn";
import { fileUrl } from "../_components/ui";
import type { CondBar } from "./model";

const SEG: Record<string, string> = { fix: "bg-destructive", mon: "bg-amber-border", ok: "bg-grass", na: "bg-rule-strong" };

/** The condition bar: fix now · monitor · OK · N/A, then what's left unchecked. */
export function CondBarView({ bar, className }: { bar: CondBar; className?: string }) {
  return (
    <div className={className}>
      <div aria-hidden className="flex h-2 w-full overflow-hidden bg-bone-3">
        {bar.segs.map((s) => (
          <span key={s.k} className={SEG[s.k]} style={{ width: s.pct + "%" }} />
        ))}
      </div>
      <p className="mt-1 text-[12px] leading-snug text-[#55524A]">{bar.legend}</p>
    </div>
  );
}

/** The vehicle's photo, or its model name on bone when there isn't one (the app's mono()). */
export function VehicleThumb({
  photo,
  mono,
  alt = "",
  className,
}: {
  photo: string | null;
  mono: string;
  alt?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-center overflow-hidden border border-rule bg-bone", className)}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- served by the Fleet files route
        <img src={fileUrl(photo)} alt={alt} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <span className="px-1 text-center font-display text-[13px] font-black uppercase leading-tight text-[#7C786C]">{mono}</span>
      )}
    </div>
  );
}
