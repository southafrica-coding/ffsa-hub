"use client";

/**
 * Track — who in this school's pipeline is doing which part of it.
 *
 * For a school split into segments (FFX: FFX / FFBX / FFWX) this is the landing
 * place for the answer to "whole programme, or which sections?" — from the
 * application form, from the survey email, or set by finance on a student's
 * billing page. Whole-programme people are counted once, under Whole
 * programme; each course's tile is only the people doing that course without
 * the rest. Staff set each student's track on the Students tab.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Chip, Initials, Kpi, KpiStrip, SectionBar } from "@/components/ffsa";
import type { PipelinePerson, TrackSummary } from "@/lib/schools/track-pipeline";
import { PIPELINE_STATUS_LABELS } from "@/lib/schools/track-pipeline";
import { cn } from "@/lib/utils/cn";

type Mode = "send" | "remind";
type Preview = { mode: Mode; count: number; recipients: Array<{ name: string; email: string; status: string }> };

function trackLabel(p: PipelinePerson): string {
  if (p.track.kind === "whole") return "Whole programme";
  if (p.track.kind === "segments") return p.track.codes.join(" + ") || "—";
  return "—";
}

function surveyLabel(p: PipelinePerson): { text: string; tone: "done" | "wait" | "none" } {
  if (p.track.source === "enrollment" || p.track.source === "application") {
    return p.survey.state === "answered"
      ? { text: "ANSWERED", tone: "done" }
      : { text: "ON FILE", tone: "done" };
  }
  if (p.survey.state === "answered") return { text: "ANSWERED", tone: "done" };
  if (p.survey.state === "sent") {
    return { text: p.survey.remindedAt ? "REMINDED" : "EMAILED", tone: "wait" };
  }
  return { text: p.email ? "NOT ASKED" : "NO EMAIL", tone: "none" };
}

export function TrackTab({
  programId,
  segments,
  summary,
  people,
}: {
  programId: string;
  segments: Array<{ code: string; name: string }>;
  summary: TrackSummary;
  people: PipelinePerson[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("all");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<Mode | "sending" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ sent: number; failed: Array<{ email: string; detail: string }> } | null>(null);

  const visible = useMemo(() => {
    switch (filter) {
      case "all":
        return people;
      case "whole":
        return people.filter((p) => p.track.kind === "whole");
      case "unknown":
        return people.filter((p) => p.track.kind === "unknown");
      default:
        return people.filter((p) => p.track.kind === "segments" && p.track.codes.includes(filter));
    }
  }, [filter, people]);

  const remindable = people.filter(
    (p) => p.email && p.track.kind === "unknown" && p.survey.state === "sent" && !p.survey.remindedAt
  ).length;

  async function openPreview(mode: Mode) {
    setBusy(mode);
    setError(null);
    setOutcome(null);
    try {
      const res = await fetch(`/api/schools/programs/${programId}/track-intent?mode=${mode}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not build the list");
        return;
      }
      setPreview(data);
    } catch {
      setError("Network error");
    } finally {
      setBusy(null);
    }
  }

  async function confirmSend() {
    if (!preview) return;
    setBusy("sending");
    setError(null);
    try {
      const res = await fetch(`/api/schools/programs/${programId}/track-intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: preview.mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Sending failed");
        return;
      }
      setOutcome({ sent: data.sent ?? 0, failed: data.failed ?? [] });
      setPreview(null);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(null);
    }
  }

  const pct = summary.total === 0 ? 0 : Math.round((summary.confirmed / summary.total) * 100);

  return (
    <div>
      <KpiStrip>
        <Kpi lead label="In the pipeline" value={String(summary.total)} foot={`${summary.accepted} ACCEPTED · ${summary.applying} APPLYING`} />
        <Kpi label="Track confirmed" value={`${summary.confirmed}`} foot={`${pct}% OF ${summary.total}`} bar={{ pct }} tick={false} />
        <Kpi label="Emailed, no answer" value={String(summary.awaiting)} foot="WAITING ON A REPLY" tick={false} />
        <Kpi label="Not asked yet" value={String(summary.notEmailed)} foot="NO TRACK, NO EMAIL SENT" tick={false} />
      </KpiStrip>

      <SectionBar title="Who's doing what" meta="COURSE TILES ARE PART-YEAR ONLY · WHOLE PROGRAMME COUNTED ONCE" />
      <div className="grid grid-cols-2 border-b border-ink md:grid-cols-4">
        {summary.bySegment.map((s) => (
          <div key={s.code} className="border-r border-rule px-5 py-4 last:border-r-0">
            <div className="mono-label">{s.code}</div>
            <div className="numeral mt-1 text-[44px] leading-none">{s.expected}</div>
            <div className="mt-1.5 font-mono text-[10px] tracking-[0.08em] text-[color:var(--text-muted)]">
              {s.accepted} ACCEPTED · {s.expected - s.accepted} APPLYING
            </div>
          </div>
        ))}
        <div className="border-r border-rule bg-bone px-5 py-4 last:border-r-0">
          <div className="mono-label">Whole programme</div>
          <div className="numeral mt-1 text-[44px] leading-none">{summary.whole}</div>
          <div className="mt-1.5 font-mono text-[10px] tracking-[0.08em] text-[color:var(--text-muted)]">
            {summary.unknown} STILL UNKNOWN
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-5 py-3 md:px-8">
        <button type="button" onClick={() => setFilter("all")}><Chip active={filter === "all"}>All {people.length}</Chip></button>
        <button type="button" onClick={() => setFilter("whole")}><Chip active={filter === "whole"}>Whole programme {summary.whole}</Chip></button>
        {segments.map((s) => (
          <button key={s.code} type="button" onClick={() => setFilter(s.code)}>
            <Chip active={filter === s.code}>
              {s.code} {people.filter((p) => p.track.kind === "segments" && p.track.codes.includes(s.code)).length}
            </Chip>
          </button>
        ))}
        <button type="button" onClick={() => setFilter("unknown")}><Chip active={filter === "unknown"}>Not answered {summary.unknown}</Chip></button>
        <span className="flex-1" />
        <button
          type="button"
          disabled={busy !== null || summary.notEmailed === 0}
          onClick={() => openPreview("send")}
          className="border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white hover:bg-[var(--ink-bg-hover)] disabled:opacity-40"
        >
          {busy === "send" ? "Loading…" : `Email the ${summary.notEmailed} not asked`}
        </button>
        <button
          type="button"
          disabled={busy !== null || remindable === 0}
          onClick={() => openPreview("remind")}
          className="border border-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ink hover:bg-bone disabled:opacity-40"
        >
          {busy === "remind" ? "Loading…" : `Remind the ${remindable} waiting`}
        </button>
      </div>

      {error && <p className="px-5 py-3 text-[13px] text-destructive md:px-8">{error}</p>}
      {outcome && (
        <p className="border-b border-rule px-5 py-3 text-[13px] text-ink md:px-8">
          Sent {outcome.sent} email{outcome.sent === 1 ? "" : "s"}.
          {outcome.failed.length > 0 &&
            ` ${outcome.failed.length} did not go: ${outcome.failed.map((f) => `${f.email} (${f.detail})`).join("; ")}`}
        </p>
      )}

      <div
        className="hidden border-b border-ink bg-bone px-8 py-2.5 md:grid"
        style={{ gridTemplateColumns: "minmax(0,1fr) 170px 160px 120px" }}
      >
        {["Person", "Stage", "Track", "Survey"].map((h) => (
          <span key={h} className="mono-label">{h}</span>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="mono-label px-8 py-10 text-center">No one matches this filter</p>
      ) : (
        visible.map((p) => {
          const survey = surveyLabel(p);
          return (
            <div
              key={p.applicationId}
              className="border-b border-rule px-5 py-3 md:grid md:items-center md:px-8"
              style={{ gridTemplateColumns: "minmax(0,1fr) 170px 160px 120px" }}
            >
              <div className="flex min-w-0 items-center gap-3">
                <Initials name={p.name} size={30} />
                <div className="min-w-0">
                  <div className="truncate text-[14.5px] font-bold text-ink">{p.name}</div>
                  <div className="truncate text-[12px] text-[color:var(--text-tertiary)]">{p.email ?? "no email on file"}</div>
                </div>
              </div>
              <div className="mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--text-secondary)] md:mt-0">
                {p.accepted ? "Accepted" : `Applying · ${PIPELINE_STATUS_LABELS[p.status] ?? p.status}`}
              </div>
              <div className={cn("mt-1 text-[13px] font-semibold md:mt-0", p.track.kind === "unknown" ? "text-[#B4B0A2]" : "text-ink")}>
                {trackLabel(p)}
              </div>
              <div
                className={cn(
                  "mt-1 font-mono text-[10px] font-bold tracking-[0.1em] md:mt-0",
                  survey.tone === "done" ? "text-[color:var(--green-text)]" : survey.tone === "wait" ? "text-[color:var(--amber)]" : "text-[color:var(--text-tertiary)]"
                )}
              >
                {survey.text}
              </div>
            </div>
          );
        })
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-6 pt-[8vh]" onClick={() => setPreview(null)}>
          <div onClick={(e) => e.stopPropagation()} className="flex max-h-[80vh] w-full max-w-[520px] flex-col border border-ink bg-white">
            <div className="section-bar">
              <span className="section-bar-title">
                {preview.mode === "send" ? "Email these people" : "Remind these people"}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <p className="text-[13px] text-[color:var(--text-secondary)]">
                {preview.count === 0
                  ? "Nobody to email."
                  : `${preview.count} ${preview.count === 1 ? "person" : "people"} will get one email each asking whether they're doing the whole programme or which sections. They answer from a personal link, and their answer lands on this tab.`}
              </p>
              <ul className="mt-3 divide-y divide-bone-3 border-y border-bone-3">
                {preview.recipients.map((r) => (
                  <li key={r.email} className="flex items-baseline justify-between gap-3 py-1.5 text-[13px]">
                    <span className="truncate font-semibold text-ink">{r.name}</span>
                    <span className="shrink-0 truncate text-[12px] text-[color:var(--text-tertiary)]">{r.email}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex justify-end gap-2 border-t border-rule p-4">
              <button type="button" onClick={() => setPreview(null)} className="border border-rule-strong px-3.5 py-2 font-mono text-[9.5px] font-bold tracking-[0.12em] text-[color:var(--text-secondary)] hover:border-ink hover:text-ink">
                CANCEL
              </button>
              <button
                type="button"
                disabled={busy === "sending" || preview.count === 0}
                onClick={confirmSend}
                className="bg-ink px-3.5 py-2 font-mono text-[9.5px] font-bold tracking-[0.12em] text-white hover:bg-[var(--ink-bg-hover)] disabled:opacity-50"
              >
                {busy === "sending" ? "SENDING…" : `SEND ${preview.count} EMAIL${preview.count === 1 ? "" : "S"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
