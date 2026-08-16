"use client";

/**
 * Curating the anchor bands — MORNING / NOON / NIGHT.
 *
 * Evaluators own this time centrally: they set the weekly focus and the band
 * lead, and the sets inside it are not claimable by members (enforced by the
 * policies in migration 171, not by hiding buttons here).
 *
 * A band is one template block per weekday, so edits apply per row and the
 * rows are grouped by name for editing.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { SectionBar } from "@/components/ffsa";

type Block = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  title: string | null;
  band_name?: string | null;
  weekly_focus?: string | null;
  is_curated?: boolean;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function BandCuration() {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [focus, setFocus] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/prayer-room/template");
    const data: Block[] = res.ok ? await res.json() : [];
    setBlocks(data);
    const seed: Record<string, string> = {};
    for (const b of data) {
      if (b.band_name) seed[b.band_name] = b.weekly_focus ?? "";
    }
    setFocus(seed);
    setReady(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const curated = blocks.filter((b) => b.is_curated && b.band_name);
  const names = [...new Set(curated.map((b) => b.band_name!))];

  /** The weekly focus belongs to the band, so it writes to every day's row. */
  async function saveFocus(name: string) {
    const rows = curated.filter((b) => b.band_name === name);
    setBusy(name);
    try {
      const results = await Promise.all(
        rows.map((r) =>
          fetch("/api/prayer-room/template", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: r.id, weekly_focus: focus[name] ?? "" }),
          })
        )
      );
      if (results.some((r) => !r.ok)) {
        toast.error("Could not update the band — evaluators only");
        return;
      }
      toast.success(`${name} updated`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!ready) return null;

  // Nothing curated yet: say how it becomes a band rather than showing an
  // empty box that looks broken.
  if (names.length === 0) {
    return (
      <div className="mb-6 border border-ink">
        <SectionBar title="Anchor bands" />
        <p className="px-4 py-4 text-[13px] text-[color:var(--text-secondary)]">
          No band is curated yet. Mark a weekly template block as a band
          (<span className="font-mono text-[11px]">is_curated</span>) and give it a name —
          MORNING, NOON or NIGHT — and it will anchor the wall and stop being claimable.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-6 border border-ink">
      <SectionBar title="Anchor bands" meta={`${names.length}`} />
      <div className="divide-y divide-[color:var(--surface-4)]">
        {names.map((name) => {
          const rows = curated.filter((b) => b.band_name === name);
          const first = rows[0];
          return (
            <div key={name} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-display text-[18px] font-black uppercase leading-none">
                  {name}
                </span>
                <span className="mono-label">
                  {first.start_time.slice(0, 5)}–{first.end_time.slice(0, 5)} ·{" "}
                  {rows
                    .map((r) => DAYS[r.day_of_week])
                    .join(" ")}
                </span>
              </div>

              <div className="mt-2.5 flex flex-wrap items-end gap-2">
                <div className="min-w-[240px] flex-1">
                  <Label htmlFor={`focus-${name}`}>This week&apos;s focus</Label>
                  <Input
                    id={`focus-${name}`}
                    value={focus[name] ?? ""}
                    onChange={(e) => setFocus((f) => ({ ...f, [name]: e.target.value }))}
                    placeholder="What this band is praying into"
                  />
                </div>
                <Button disabled={busy === name} onClick={() => saveFocus(name)}>
                  {busy === name ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
