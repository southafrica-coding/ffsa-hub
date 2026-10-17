"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { NeedsYou, SectionBar, StatusPill, type Tone } from "@/components/ffsa";
import type {
  ImportMatch,
  ImportMinistry,
  ImportPerson,
  ImportProposal,
  ImportRow,
  ImportStatus,
} from "@/services/org-import";

type View = "open" | "done" | "dismissed";

const PROPOSAL_LABEL: Record<ImportProposal, string> = {
  membership: "Member of",
  oversees: "Oversees",
  integrates: "Integrator for",
  alongside: "Alongside",
};

const MATCH: Record<ImportMatch, { label: string; tone: Tone }> = {
  exact: { label: "Exact name", tone: "good" },
  first_name: { label: "First name only", tone: "warn" },
  ambiguous: { label: "Several people", tone: "warn" },
  none: { label: "No match", tone: "bad" },
};

const STATUS: Record<Exclude<ImportStatus, "open">, { label: string; tone: Tone }> = {
  applied: { label: "Added", tone: "good" },
  already_true: { label: "Already there", tone: "quiet" },
  dismissed: { label: "Dismissed", tone: "quiet" },
};

// Native <select>: the Radix popover selects don't open in Safari (see
// components/ui/searchable-select.tsx), and this is a long list.
const SELECT =
  "h-11 w-full min-w-0 border border-rule-strong bg-white px-2 text-[13px] text-ink md:h-9";
const BUTTON =
  "h-11 shrink-0 border px-3 font-mono text-[9px] font-bold uppercase tracking-[0.14em] disabled:opacity-40 md:h-9";

type Draft = { userId: string; proposal: ImportProposal; ministryId: string };

export function ImportQueue({
  rows,
  people,
  ministries,
}: {
  rows: ImportRow[];
  people: ImportPerson[];
  ministries: ImportMinistry[];
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const ministryById = useMemo(() => new Map(ministries.map((m) => [m.id, m])), [ministries]);

  const open = rows.filter((r) => r.status === "open");
  const done = rows.filter((r) => r.status === "applied" || r.status === "already_true");
  const dismissed = rows.filter((r) => r.status === "dismissed");
  const exactOpen = open.filter(
    (r) => r.match_kind === "exact" && r.staff_ministry_id && r.suggested_user_ids.length === 1
  ).length;
  const visible = view === "open" ? open : view === "done" ? done : dismissed;

  function draftFor(r: ImportRow): Draft {
    return (
      drafts[r.id] ?? {
        // Pre-select only when there is exactly one candidate. With several,
        // a default would be a guess dressed up as a decision.
        userId: r.suggested_user_ids.length === 1 ? r.suggested_user_ids[0] : "",
        proposal: r.proposal,
        ministryId: r.staff_ministry_id ?? "",
      }
    );
  }

  function setDraft(r: ImportRow, patch: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [r.id]: { ...draftFor(r), ...patch } }));
  }

  async function post(key: string, body: Record<string, unknown>) {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/org-chart/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      router.refresh();
      return data.result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function applyExact() {
    const n = await post("exact", { action: "apply_exact" });
    if (typeof n === "number") setMessage(`Applied ${n} exact ${n === 1 ? "match" : "matches"}.`);
  }

  return (
    <div>
      {open.length > 0 && (
        <NeedsYou
          action={
            exactOpen > 0 ? (
              <button
                type="button"
                onClick={applyExact}
                disabled={busy !== null}
                className={`${BUTTON} border-ink bg-ink text-yellow hover:bg-[#262622]`}
              >
                {busy === "exact" ? "Applying…" : `Apply ${exactOpen} exact matches`}
              </button>
            ) : undefined
          }
        >
          {open.length} {open.length === 1 ? "name" : "names"} from the old chart still need a
          person
        </NeedsYou>
      )}

      <div className="flex flex-wrap gap-2 border-b border-rule px-5 py-3 md:px-8">
        {(
          [
            ["open", `Open · ${open.length}`],
            ["done", `Done · ${done.length}`],
            ["dismissed", `Dismissed · ${dismissed.length}`],
          ] as [View, string][]
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className="chip min-h-[44px] md:min-h-0"
            data-active={view === v ? "true" : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {(error || message) && (
        <p
          className={`border-b border-rule px-5 py-3 text-[13px] md:px-8 ${
            error ? "text-destructive" : "text-grass-text"
          }`}
        >
          {error ?? message}
        </p>
      )}

      <SectionBar
        title={view === "open" ? "Needs a person" : view === "done" ? "Done" : "Dismissed"}
        meta={`${visible.length} ${visible.length === 1 ? "row" : "rows"}`}
      />

      {visible.length === 0 ? (
        <p className="px-5 py-8 text-[13px] text-[color:var(--text-secondary)] md:px-8">
          {view === "open" ? "Every name on the old chart has been dealt with." : "Nothing here."}
        </p>
      ) : (
        <ul>
          {visible.map((r) => {
            const d = draftFor(r);
            const suggested = r.suggested_user_ids
              .map((id) => personById.get(id))
              .filter((p): p is ImportPerson => !!p);
            const resolvedPerson = r.resolved_user_id ? personById.get(r.resolved_user_id) : null;
            const resolvedMinistry = ministryById.get(
              r.resolved_ministry_id ?? r.staff_ministry_id ?? ""
            );
            return (
              <li
                key={r.id}
                className="grid gap-3 border-b border-rule px-5 py-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_auto] md:items-center md:px-8"
              >
                {/* What the chart said */}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-bold text-ink">{r.chart_label}</span>
                    {r.status === "open" ? (
                      <StatusPill tone={MATCH[r.match_kind].tone}>
                        {MATCH[r.match_kind].label}
                      </StatusPill>
                    ) : (
                      <StatusPill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</StatusPill>
                    )}
                  </div>
                  <div className="mt-1 text-[12px] text-[color:var(--text-secondary)]">
                    {r.source_kind === "edge" ? "Line on the chart" : "Box on the chart"}
                    {r.role_title ? ` · ${r.role_title}` : ""}
                    {r.chart_group ? ` · in ${r.chart_group}` : ""}
                  </div>
                </div>

                {r.status === "open" ? (
                  <>
                    <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1fr)]">
                      <select
                        aria-label={`Who is ${r.chart_label}?`}
                        value={d.userId}
                        onChange={(e) => setDraft(r, { userId: e.target.value })}
                        className={SELECT}
                      >
                        <option value="">Who is this?</option>
                        {suggested.length > 0 && (
                          <optgroup label="Suggested">
                            {suggested.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                                {p.email ? ` — ${p.email}` : ""}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="Everyone">
                          {people.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                      <select
                        aria-label="How they are linked"
                        value={d.proposal}
                        onChange={(e) =>
                          setDraft(r, { proposal: e.target.value as ImportProposal })
                        }
                        className={SELECT}
                      >
                        {(Object.keys(PROPOSAL_LABEL) as ImportProposal[]).map((p) => (
                          <option key={p} value={p}>
                            {PROPOSAL_LABEL[p]}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Ministry"
                        value={d.ministryId}
                        onChange={(e) => setDraft(r, { ministryId: e.target.value })}
                        className={SELECT}
                      >
                        <option value="">Ministry…</option>
                        {ministries.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy !== null || !d.userId || !d.ministryId}
                        onClick={() =>
                          post(r.id, {
                            action: "apply",
                            id: r.id,
                            user_id: d.userId,
                            proposal: d.proposal,
                            ministry_id: d.ministryId,
                          })
                        }
                        className={`${BUTTON} flex-1 border-ink bg-ink text-white hover:bg-[#262622] md:flex-none`}
                      >
                        {busy === r.id ? "Saving…" : "Apply"}
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          const note = window.prompt(
                            `Why is "${r.chart_label}" not going onto a roster? (optional)`
                          );
                          if (note === null) return;
                          post(`dismiss-${r.id}`, { action: "dismiss", id: r.id, note });
                        }}
                        className={`${BUTTON} flex-1 border-ink bg-bone text-ink hover:bg-bone-2 md:flex-none`}
                      >
                        Dismiss
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="min-w-0 text-[13px] text-ink">
                      {r.status === "dismissed" ? (
                        <span className="text-[color:var(--text-secondary)]">
                          {r.note || "No reason given"}
                        </span>
                      ) : (
                        <>
                          <span className="font-bold">{resolvedPerson?.name ?? "Someone"}</span>
                          {" · "}
                          {PROPOSAL_LABEL[r.resolved_proposal ?? r.proposal].toLowerCase()}{" "}
                          {resolvedMinistry?.name ?? "a ministry"}
                        </>
                      )}
                    </div>
                    <div>
                      {r.status === "dismissed" && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => post(r.id, { action: "reopen", id: r.id })}
                          className={`${BUTTON} border-ink bg-bone text-ink hover:bg-bone-2`}
                        >
                          {busy === r.id ? "…" : "Reopen"}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
