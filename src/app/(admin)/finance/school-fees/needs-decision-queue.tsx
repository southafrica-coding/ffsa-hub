"use client";

/**
 * Held charges — design frame 20b.
 *
 * A student accepted after a charge's invoice should already have gone out.
 * Her schedule is complete and correctly dated; these charges are simply held,
 * and a person decides what happens. The screen exists so that decision is made
 * once, deliberately, per student — rather than as a batch nobody chose.
 *
 * The three outcomes are named in the UI exactly as they are in the API and the
 * database, so what someone clicked is what the record says.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { SectionBar, Initials, StatusPill } from "@/components/ffsa";
import { cn } from "@/lib/utils/cn";

type HeldRow = {
  id: string;
  label: string;
  charge_type: string;
  amount_zar: number;
  due_date: string;
  scheduled_generation_date: string;
  plan?: {
    enrollment_id?: string;
    enrollment?: {
      user?: {
        id: string;
        first_name: string | null;
        last_name: string | null;
        preferred_name: string | null;
      } | null;
    } | null;
  } | null;
};

type Outcome = "catch_up_single" | "issue_separately" | "start_from_now";

const OUTCOMES: { key: Outcome; label: string; what: string }[] = [
  {
    key: "catch_up_single",
    label: "Catch up · one invoice",
    what: "Everything held becomes a single invoice, dated today.",
  },
  {
    key: "issue_separately",
    label: "Issue separately",
    what: "One invoice per charge, all dated today.",
  },
  {
    key: "start_from_now",
    label: "Start from now",
    what: "Drop these — she was not here for those periods. Kept in her history.",
  },
];

const money = (n: number) =>
  "R " + Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const day = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

function personName(r: HeldRow): string {
  const u = r.plan?.enrollment?.user;
  if (!u) return "Unknown student";
  return [u.first_name, u.last_name].filter(Boolean).join(" ") || "Unknown student";
}

export default function NeedsDecisionQueue({ programId }: { programId?: string }) {
  const [rows, setRows] = useState<HeldRow[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Which student's decision is open, and what has been chosen for them.
  const [choice, setChoice] = useState<Record<string, Outcome>>({});

  const load = useCallback(async () => {
    const qs = programId ? `?programId=${programId}` : "";
    const res = await fetch(`/api/finance/school-fees/needs-decision${qs}`);
    const data = res.ok ? await res.json() : { rows: [] };
    setRows(data.rows ?? []);
    setReady(true);
  }, [programId]);

  useEffect(() => {
    load();
  }, [load]);

  // One decision per student, not per charge — that is the whole point of 20b.
  const byStudent = new Map<string, HeldRow[]>();
  for (const r of rows) {
    const key = r.plan?.enrollment_id ?? "unknown";
    byStudent.set(key, [...(byStudent.get(key) ?? []), r]);
  }

  async function resolve(key: string, group: HeldRow[]) {
    const outcome = choice[key];
    if (!outcome) {
      toast.error("Choose what should happen first");
      return;
    }
    setBusy(key);
    try {
      const res = await fetch("/api/finance/school-fees/needs-decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, ids: group.map((g) => g.id) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(d.error || "Could not resolve those charges");
        return;
      }
      toast.success(d.note ?? "Resolved");
      await load();
    } finally {
      setBusy(null);
    }
  }

  // Nothing held is the normal state. No empty box for it.
  if (!ready || rows.length === 0) return null;

  return (
    <div className="mb-6 border border-ink">
      <SectionBar
        title="Held for a decision"
        meta={`${byStudent.size} student${byStudent.size === 1 ? "" : "s"} · ${rows.length} charge${rows.length === 1 ? "" : "s"}`}
      />

      <p className="border-b border-rule bg-bone px-5 py-3 text-[13px] text-[color:var(--text-secondary)]">
        These charges should already have been invoiced before the student was accepted.
        Nothing has been generated and no date has been changed. Choose what happens —
        nothing here is ever invoiced with a past date.
      </p>

      <div className="divide-y divide-[color:var(--surface-4)]">
        {[...byStudent.entries()].map(([key, group]) => {
          const total = group.reduce((s, r) => s + Number(r.amount_zar), 0);
          const picked = choice[key];
          return (
            <div key={key} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Initials name={personName(group[0])} size={32} />
                  <div className="min-w-0">
                    <div className="font-display text-[19px] font-black uppercase leading-none">
                      {personName(group[0])}
                    </div>
                    <div className="mono-label mt-1">
                      {group.length} charge{group.length === 1 ? "" : "s"} · {money(total)}
                    </div>
                  </div>
                </div>
                <StatusPill tone="warn">Held</StatusPill>
              </div>

              {/* What is actually held, with its real dates on show. */}
              <div className="mt-3 border border-rule">
                {group.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-3 border-b border-[color:var(--surface-4)] px-3 py-2 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium">{r.label}</div>
                      <div className="mono-label mt-0.5">
                        Was due {day(r.due_date)} · invoice was due out{" "}
                        {day(r.scheduled_generation_date)}
                      </div>
                    </div>
                    <span className="numeral shrink-0 text-[17px]">{money(r.amount_zar)}</span>
                  </div>
                ))}
              </div>

              <div className="mt-3 grid gap-1.5 sm:grid-cols-3">
                {OUTCOMES.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setChoice((c) => ({ ...c, [key]: o.key }))}
                    className={cn(
                      "border px-3 py-2 text-left transition-colors",
                      picked === o.key
                        ? "border-ink bg-ink text-white"
                        : "border-rule-strong bg-white hover:bg-bone"
                    )}
                  >
                    <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em]">
                      {o.label}
                    </div>
                    <div
                      className={cn(
                        "mt-1 text-[11px] leading-snug",
                        picked === o.key ? "text-[#C5C2AE]" : "text-[color:var(--text-tertiary)]"
                      )}
                    >
                      {o.what}
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-3 flex items-center justify-end gap-3">
                {picked && (
                  <span className="mono-label">
                    {picked === "start_from_now"
                      ? "Nothing will be invoiced"
                      : "Creates nothing yet — the invoice run still has to"}
                  </span>
                )}
                <Button disabled={!picked || busy === key} onClick={() => resolve(key, group)}>
                  {busy === key ? "Saving…" : "Apply"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
