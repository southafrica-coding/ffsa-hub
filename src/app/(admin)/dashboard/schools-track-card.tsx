"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { WidgetShell } from "./widget-shell";

type TrackProgram = {
  id: string;
  name: string;
  code: string;
  accepted: number;
  whole: number;
  partYear: number;
  unknown: number;
  bySegment: Array<{ code: string; name: string; expected: number }>;
  combos: Array<{ label: string; count: number }>;
  applying: number;
  applyingTold: number;
};

// "Of the people accepted, who is doing the whole programme and who is doing
// which part?" — for school leaders planning each section. Self-hides for
// anyone the endpoint refuses and for anyone with no segmented school.
export function SchoolsTrackCard() {
  const [programs, setPrograms] = useState<TrackProgram[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/schools/track-summary", { cache: "no-store" });
        if (!res.ok) return setPrograms([]);
        const json = (await res.json()) as { programs: TrackProgram[] };
        setPrograms(json.programs);
      } catch {
        setPrograms([]);
      }
    })();
  }, []);

  if (!programs || programs.length === 0) return null;

  return (
    <WidgetShell title="Who's doing which part" href="/schools" hrefLabel="Schools">
      {programs.map((p) => (
        <Link
          key={p.id}
          href={`/schools/${p.id}?tab=track`}
          className="block border-b border-rule px-6 py-5 transition-colors duration-150 last:border-b-0 hover:bg-[color:var(--surface-2)]"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-bold text-ink">{p.name}</p>
            <p className="mono-label">
              {p.accepted} ACCEPTED
              {p.applying > 0 && ` · ${p.applying} STILL APPLYING (${p.applyingTold} TOLD US)`}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
            <Figure label="Whole programme" value={p.whole} />
            <Figure label="Part of the year" value={p.partYear} />
            <Figure label="Not reported yet" value={p.unknown} muted />
          </div>

          <p className="mono-label mb-2 mt-4">Accepted for this part only</p>
          <div className="grid grid-cols-2 gap-px border border-rule bg-[var(--rule)] md:grid-cols-4">
            {p.bySegment.map((s) => (
              <div key={s.code} className="bg-white px-4 py-3">
                <p className="mono-label">{s.code}</p>
                <p className="numeral mt-1 text-[32px] leading-[0.85]">{s.expected}</p>
              </div>
            ))}
          </div>

          {p.combos.length > 0 && (
            <p className="mt-4 text-[13px] text-[color:var(--text-secondary)]">
              <span className="mono-label mr-2">Part-year choices</span>
              {p.combos.map((c) => `${c.label}: ${c.count}`).join(" · ")}
            </p>
          )}
        </Link>
      ))}
    </WidgetShell>
  );
}

function Figure({ label, value, muted = false }: { label: string; value: number; muted?: boolean }) {
  return (
    <div>
      <p className="mono-label">{label}</p>
      <p className="numeral mt-1 text-[32px] leading-[0.85]" style={muted ? { color: "#9A9689" } : undefined}>
        {value}
      </p>
    </div>
  );
}
