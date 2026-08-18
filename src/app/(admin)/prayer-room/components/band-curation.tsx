"use client";

/**
 * Curating the anchor bands — design frame 12b, left panel.
 *
 * MORNING / NOON / NIGHT run every weekday and cannot be claimed off the wall.
 * Evaluators set the time, the lead and the week's focus; everyone else just
 * shows up. The lock is enforced by the policies in migration 171, not by
 * hiding buttons here.
 *
 * A band is one template block per weekday, so an edit fans out across every
 * day the band runs — which is why the panel says so out loud.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";

type Block = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  title: string | null;
  band_name?: string | null;
  weekly_focus?: string | null;
  lead_user_id?: string | null;
  is_curated?: boolean;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function BandCuration({ canCreate = false }: { canCreate?: boolean }) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [draft, setDraft] = useState<Record<string, { focus: string; start: string; end: string }>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftNew, setDraftNew] = useState({ name: "", start: "08:00", end: "09:30", days: [1, 2, 3, 4, 5] });

  const load = useCallback(async () => {
    const res = await fetch("/api/prayer-room/template");
    const data: Block[] = res.ok ? await res.json() : [];
    setBlocks(data);
    const seed: Record<string, { focus: string; start: string; end: string }> = {};
    for (const b of data) {
      if (!b.band_name || seed[b.band_name]) continue;
      seed[b.band_name] = {
        focus: b.weekly_focus ?? "",
        start: (b.start_time ?? "").slice(0, 5),
        end: (b.end_time ?? "").slice(0, 5),
      };
    }
    setDraft(seed);
    setReady(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const curated = useMemo(() => blocks.filter((b) => b.is_curated && b.band_name), [blocks]);
  const names = useMemo(() => [...new Set(curated.map((b) => b.band_name!))], [curated]);

  /** A band attribute belongs to the band, so it writes to every day's row. */
  async function save(name: string, fields: Record<string, unknown>) {
    const rows = curated.filter((b) => b.band_name === name);
    setBusy(name);
    try {
      const results = await Promise.all(
        rows.map((r) =>
          fetch("/api/prayer-room/template", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: r.id, ...fields }),
          })
        )
      );
      if (results.some((r) => !r.ok)) {
        toast.error("Could not update the band — evaluators only");
        return;
      }
      toast.success(`${name} updated`);
      setEditing(null);
      await load();
    } finally {
      setBusy(null);
    }
  }

  /**
   * A band is one template block per weekday it runs, so creating one is N
   * inserts that share a name. Written as staff — RLS lets staff insert into
   * the template, while migration 171 lets evaluators edit a band afterwards.
   */
  async function createBand() {
    const name = draftNew.name.trim().toUpperCase();
    if (!name) {
      toast.error("Give the band a name");
      return;
    }
    if (names.includes(name)) {
      toast.error(`${name} already exists`);
      return;
    }
    if (draftNew.end <= draftNew.start) {
      toast.error("The band has to end after it starts");
      return;
    }
    if (draftNew.days.length === 0) {
      toast.error("Pick at least one day");
      return;
    }
    setBusy("new");
    try {
      const results = await Promise.all(
        draftNew.days.map((d) =>
          fetch("/api/prayer-room/template", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              day_of_week: d,
              start_time: draftNew.start,
              end_time: draftNew.end,
              title: name,
              band_name: name,
              is_curated: true,
            }),
          })
        )
      );
      if (results.some((r) => !r.ok)) {
        toast.error("Could not create the band — prayer room staff only");
        return;
      }
      toast.success(`${name} created on ${draftNew.days.length} days`);
      setCreating(false);
      setDraftNew({ name: "", start: "08:00", end: "09:30", days: [1, 2, 3, 4, 5] });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!ready) return null;

  return (
    <div className="border border-ink bg-white">
      <div className="flex items-center justify-between bg-ink px-6 py-3.5">
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.2em] text-yellow">
          Evaluators · the bands
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#8E8A7C]">
          {names.length} curated
        </span>
      </div>

      <div className="border-b border-surface-4 px-6 pb-4 pt-5">
        <h2 className="font-display text-[30px] font-black uppercase leading-[0.95] text-ink sm:text-[34px]">
          Morning, Noon
          <br />
          and Night
        </h2>
        <p className="mt-2.5 max-w-[520px] text-[14px] leading-[1.5] text-[color:var(--text-secondary)]">
          These run every weekday and can&apos;t be claimed off the wall. Evaluators set the time, the
          lead and the week&apos;s focus; everyone else just shows up.
        </p>
      </div>

      {names.length === 0 ? (
        <p className="px-6 py-5 text-[13px] leading-[1.55] text-[color:var(--text-secondary)]">
          No band is curated yet, so the wall draws no anchors — migration 171 added the columns
          but never filled them.{" "}
          {canCreate
            ? "Set up MORNING, NOON and NIGHT below and they will anchor the wall and stop being claimable."
            : "Prayer room staff can set up MORNING, NOON and NIGHT."}
        </p>
      ) : (
        names.map((name) => {
          const rows = curated.filter((b) => b.band_name === name);
          const first = rows[0];
          const d = draft[name] ?? { focus: "", start: "", end: "" };
          const open = editing === name;
          return (
            <div key={name} className="border-b border-surface-4 px-6 py-[18px]">
              <div className="flex flex-wrap items-center gap-3">
                <span className="border-[1.5px] border-ink bg-yellow px-2.5 py-1 font-display text-[22px] font-black uppercase leading-none tracking-[0.02em] text-ink">
                  {name}
                </span>
                <span className="font-mono text-[11px] font-bold tracking-[0.08em] text-ink">
                  {first.start_time.slice(0, 5)} — {first.end_time.slice(0, 5)}
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => setEditing(open ? null : name)}
                  className="border border-rule-strong px-2.5 py-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-[color:var(--text-secondary)]"
                >
                  {open ? "Close" : "Edit"}
                </button>
              </div>

              <div className="mt-3.5 grid gap-3.5 sm:grid-cols-2">
                <div>
                  <div className="font-mono text-[8.5px] font-bold uppercase tracking-[0.16em] text-[color:var(--text-tertiary)]">
                    This week&apos;s focus
                  </div>
                  <div className="mt-1 text-[14px] font-bold text-ink">
                    {first.weekly_focus || "No focus set"}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-[color:var(--text-secondary)]">
                    {rows.map((r) => DAYS[r.day_of_week]).join(" ")}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[8.5px] font-bold uppercase tracking-[0.16em] text-[color:var(--text-tertiary)]">
                    Runs
                  </div>
                  <div className="mt-1 text-[14px] font-bold text-ink">
                    {rows.length} {rows.length === 1 ? "day" : "days"} a week
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-[color:var(--text-secondary)]">
                    {first.title || "No title"}
                  </div>
                </div>
              </div>

              {open && (
                <div className="mt-4 border border-rule bg-bone p-3.5">
                  <label className="mono-label mb-1.5 block" htmlFor={`focus-${name}`}>
                    This week&apos;s focus
                  </label>
                  <input
                    id={`focus-${name}`}
                    value={d.focus}
                    onChange={(e) => setDraft((f) => ({ ...f, [name]: { ...d, focus: e.target.value } }))}
                    placeholder="What this band is praying into"
                    className="w-full border border-rule-strong bg-white px-3 py-2 text-[14px]"
                  />
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mono-label mb-1.5 block" htmlFor={`start-${name}`}>
                        Starts
                      </label>
                      <input
                        id={`start-${name}`}
                        type="time"
                        value={d.start}
                        onChange={(e) => setDraft((f) => ({ ...f, [name]: { ...d, start: e.target.value } }))}
                        className="w-full border border-rule-strong bg-white px-3 py-2 text-[14px]"
                      />
                    </div>
                    <div>
                      <label className="mono-label mb-1.5 block" htmlFor={`end-${name}`}>
                        Ends
                      </label>
                      <input
                        id={`end-${name}`}
                        type="time"
                        value={d.end}
                        onChange={(e) => setDraft((f) => ({ ...f, [name]: { ...d, end: e.target.value } }))}
                        className="w-full border border-rule-strong bg-white px-3 py-2 text-[14px]"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy === name}
                    onClick={() => {
                      if (d.end <= d.start) {
                        toast.error("The band has to end after it starts");
                        return;
                      }
                      save(name, { weekly_focus: d.focus, start_time: d.start, end_time: d.end });
                    }}
                    className={cn(
                      "mt-3.5 w-full bg-ink px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white",
                      busy === name && "opacity-40"
                    )}
                  >
                    {busy === name ? "Saving…" : `Save ${name} · all ${rows.length} days`}
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}

      {canCreate && (
        <div className="border-b border-surface-4 px-6 py-[18px]">
          {creating ? (
            <div className="border border-rule bg-bone p-3.5">
              <label className="mono-label mb-1.5 block" htmlFor="band-new-name">
                Band name
              </label>
              <input
                id="band-new-name"
                value={draftNew.name}
                onChange={(e) => setDraftNew((d) => ({ ...d, name: e.target.value }))}
                placeholder="MORNING"
                className="w-full border border-rule-strong bg-white px-3 py-2 text-[14px] uppercase"
              />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mono-label mb-1.5 block" htmlFor="band-new-start">
                    Starts
                  </label>
                  <input
                    id="band-new-start"
                    type="time"
                    value={draftNew.start}
                    onChange={(e) => setDraftNew((d) => ({ ...d, start: e.target.value }))}
                    className="w-full border border-rule-strong bg-white px-3 py-2 text-[14px]"
                  />
                </div>
                <div>
                  <label className="mono-label mb-1.5 block" htmlFor="band-new-end">
                    Ends
                  </label>
                  <input
                    id="band-new-end"
                    type="time"
                    value={draftNew.end}
                    onChange={(e) => setDraftNew((d) => ({ ...d, end: e.target.value }))}
                    className="w-full border border-rule-strong bg-white px-3 py-2 text-[14px]"
                  />
                </div>
              </div>
              <div className="mono-label mb-1.5 mt-3">Runs on</div>
              <div className="flex flex-wrap gap-1.5">
                {[1, 2, 3, 4, 5].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() =>
                      setDraftNew((s2) => ({
                        ...s2,
                        days: s2.days.includes(d) ? s2.days.filter((x) => x !== d) : [...s2.days, d].sort(),
                      }))
                    }
                    className={cn(
                      "px-2.5 py-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em]",
                      draftNew.days.includes(d)
                        ? "bg-ink text-white"
                        : "border border-rule-strong text-[color:var(--text-secondary)]"
                    )}
                  >
                    {DAYS[d]}
                  </button>
                ))}
              </div>
              <div className="mt-3.5 flex gap-2">
                <button
                  type="button"
                  disabled={busy === "new"}
                  onClick={createBand}
                  className="flex-1 bg-ink px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white disabled:opacity-40"
                >
                  {busy === "new" ? "Creating…" : `Create the band · ${draftNew.days.length} days`}
                </button>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="border border-ink px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="border border-ink px-3 py-2.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-ink hover:bg-bone"
            >
              + Set up a band
            </button>
          )}
        </div>
      )}

      <div className="bg-bone px-6 py-4">
        <p className="text-[13px] leading-[1.5] text-ink">
          Changing a band&apos;s time reshapes the wall for every day it runs. People already in a seat
          get told.
        </p>
      </div>
    </div>
  );
}
