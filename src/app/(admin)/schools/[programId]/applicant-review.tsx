"use client";

/**
 * Frame 14c — applicant review.
 *
 * Everything about one applicant on one screen: the pipeline across the top,
 * her answers down the middle, references and readiness on the right, and a
 * decision bar pinned to the bottom OUTSIDE the scroll so it is never scrolled
 * away from.
 *
 * The size of the answer text is not decoration. 15px/1.5 body copy is the
 * point of this screen — it is the one place in the Hub where reading matters
 * more than density, so do not shrink answers to fit more in.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  INTERVIEW_OUTCOME_LABEL,
  INTERVIEW_OUTCOMES,
  type InterviewOutcome,
} from "@/lib/schools/interview-outcomes";
import { cn } from "@/lib/utils/cn";

export type ReviewAnswer = { question_id: string; question_label: string; answer: string };

export type ReviewReference = {
  id: string;
  slotLabel: string;
  status: string;
  refereeName: string;
  org: string | null;
};

export type ReviewCheck = { label: string; value: string; ok: boolean };

export type PipelineStage = { key: string; label: string; count: number };

export type ShownInterviewReview = {
  id: string;
  authorName: string;
  outcome: InterviewOutcome;
  notes: string | null;
  /** Already formatted for the row, e.g. "09 NOV 2026". */
  when: string;
  mine: boolean;
};

function saveButton(label: string, saving: boolean, onClick: () => void, disabled: boolean) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 border border-ink bg-ink px-3 py-2 font-mono text-[10px] font-bold tracking-[0.12em] text-white hover:bg-[var(--ink-bg-hover)] disabled:opacity-50"
    >
      {saving ? "SAVING…" : label}
    </button>
  );
}

export function ApplicantReview({
  name,
  email,
  phone,
  contextLine,
  stages,
  currentStatus,
  answers,
  references,
  refsLoading,
  checks,
  note,
  noteMeta,
  noteSaving,
  noteFeedback,
  onSaveNote,
  interviewReviews,
  interviewLoading,
  interviewReady,
  interviewNotes,
  interviewOutcome,
  onInterviewNotesChange,
  onInterviewOutcomeChange,
  onSaveInterview,
  interviewSaving,
  interviewFeedback,
  acceptConsequence,
  busy,
  renderAnswer,
  onNoteChange,
  onDecision,
  onClose,
  extras,
}: {
  name: string;
  email: string;
  phone: string | null;
  /** Mono strap above the name: school · submitted · age · city. */
  contextLine: string;
  stages: PipelineStage[];
  currentStatus: string;
  answers: ReviewAnswer[];
  references: ReviewReference[];
  refsLoading: boolean;
  checks: ReviewCheck[];
  note: string;
  noteMeta: string | null;
  noteSaving: boolean;
  /** "Saved" or an error. Null when there is nothing to say. */
  noteFeedback: { tone: "ok" | "error"; text: string } | null;
  onSaveNote: () => void;
  interviewReviews: ShownInterviewReview[];
  interviewLoading: boolean;
  /** False until this applicant's reviews have loaded, so a save cannot blank one. */
  interviewReady: boolean;
  interviewNotes: string;
  interviewOutcome: InterviewOutcome;
  onInterviewNotesChange: (value: string) => void;
  onInterviewOutcomeChange: (value: InterviewOutcome) => void;
  onSaveInterview: () => void;
  interviewSaving: boolean;
  interviewFeedback: { tone: "ok" | "error"; text: string } | null;
  /** Mono sentence beside the decision buttons, stating what Accept does. */
  acceptConsequence: string;
  busy: boolean;
  /** Answers can be uploaded files; the parent owns the storage-aware render. */
  renderAnswer?: (answer: string) => React.ReactNode;
  onNoteChange: (value: string) => void;
  onDecision: (status: "rejected" | "waitlisted" | "accepted") => void;
  onClose: () => void;
  /** Reference chasing, email history, staff assignment — parent-owned. Rendered
   *  inline under the answers: it is all part of the application. */
  extras?: React.ReactNode;
}) {
  // The admin shell animates its content wrapper, and a transformed ancestor
  // becomes the containing block for `position: fixed` — which trapped this
  // screen inside the content column and let it grow past the viewport. It
  // portals to <body> so "one screen, decision bar pinned" actually holds.
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Escape closes, like every other overlay in the Hub.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The body must not scroll behind a screen that owns the viewport.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!mounted) return null;

  const locked = busy || noteSaving || interviewSaving;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* ── Pipeline strip. Wraps on a phone so eight stages stay on screen. ── */}
      <div className="flex shrink-0 items-start gap-2 border-b border-ink bg-[var(--surface-hover)] px-3 py-3 md:px-6">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {stages.map((s) => {
            const hot = s.key === currentStatus;
            return (
              <div
                key={s.key}
                className={cn(
                  "min-w-0 basis-[calc(50%-0.25rem)] border px-2 py-2 sm:basis-[140px] sm:flex-1",
                  hot ? "border-ink bg-yellow" : "border-rule bg-white"
                )}
              >
                <div className="numeral text-[22px] leading-none sm:text-[26px]">{s.count}</div>
                <div className="mt-1 break-words font-mono text-[8px] font-bold leading-tight tracking-[0.08em] text-[color:var(--text-secondary)] sm:text-[8.5px] sm:tracking-[0.12em]">
                  {s.label}
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close applicant review"
          className="shrink-0 px-2 py-2 font-mono text-[14px] text-ink hover:text-electric"
        >
          ✕
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 [grid-template-rows:minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── Her answers ── */}
        <div className="flex min-w-0 flex-col border-ink lg:border-r">
          <div className="shrink-0 border-b border-rule px-6 pb-4 pt-5 md:px-7">
            <div className="mb-2 flex items-center gap-2.5">
              <span className="h-[3px] w-4 shrink-0 bg-yellow" />
              <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.18em] text-[color:var(--text-secondary)]">
                {contextLine}
              </span>
            </div>
            <h2 className="m-0 font-display text-[46px] font-black uppercase leading-[0.92] text-ink">
              {name}
            </h2>
            <div className="mt-2 text-[13px] text-[color:var(--text-secondary)]">
              {email}
              {phone ? ` · ${phone}` : ""}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 md:px-7">
            {answers.length === 0 ? (
              <p className="mono-label py-10 text-center">No answers on this application</p>
            ) : (
              answers.map((a, i) => (
                <div key={`${a.question_id}-${i}`} className="border-b border-rule py-4">
                  <div className="mb-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--text-tertiary)]">
                    {a.question_label}
                  </div>
                  {/* 15px / 1.5. This is the whole point of the screen. */}
                  <div className="text-[15px] leading-[1.5] text-ink [text-wrap:pretty]">
                    {renderAnswer ? renderAnswer(a.answer) : a.answer}
                  </div>
                </div>
              ))
            )}

            {extras && (
              <div className="pb-6">
                {/* A deliberate seam. The answers above are hers; everything
                    below is what the team has done about them — and it is
                    styled from the pre-redesign screens, so it needs a
                    boundary rather than bleeding into her application. */}
                <div className="section-bar -mx-6 mt-2 md:-mx-7">
                  <span className="section-bar-title">Chasing, history &amp; assignment</span>
                </div>
                <div className="mt-5">{extras}</div>
              </div>
            )}
          </div>
        </div>

        {/* ── References · readiness · note ── */}
        <div className="flex min-w-0 flex-col overflow-y-auto border-t border-ink lg:border-t-0">
          <div className="section-bar">
            <span className="section-bar-title">References</span>
          </div>
          {refsLoading ? (
            <p className="mono-label px-5 py-4">Loading…</p>
          ) : references.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-[color:var(--text-tertiary)]">
              No references were provided with this application.
            </p>
          ) : (
            references.map((r) => (
              <div key={r.id} className="border-b border-rule px-5 py-3">
                <div className="flex items-baseline justify-between gap-2.5">
                  <span className="font-mono text-[9px] font-bold tracking-[0.16em] text-[color:var(--text-tertiary)]">
                    {r.slotLabel}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-[9px] font-bold tracking-[0.12em]",
                      r.status === "submitted"
                        ? "text-[color:var(--green-text)]"
                        : "text-[color:var(--amber)]"
                    )}
                  >
                    {r.status === "submitted" ? "IN" : r.status.replace(/_/g, " ").toUpperCase()}
                  </span>
                </div>
                <div className="mt-1 text-[14px] font-bold text-ink">{r.refereeName}</div>
                {r.org && (
                  <div className="text-[12.5px] text-[color:var(--text-secondary)]">{r.org}</div>
                )}
              </div>
            ))
          )}

          <div className="section-bar mt-3.5">
            <span className="section-bar-title">Readiness</span>
          </div>
          {checks.map((c) => (
            <div
              key={c.label}
              className="flex items-center justify-between gap-2.5 border-b border-rule px-5 py-2.5"
            >
              <span className="text-[14px] font-semibold text-ink">{c.label}</span>
              <span
                className={cn(
                  "shrink-0 font-mono text-[9px] font-bold tracking-[0.12em]",
                  c.ok ? "text-[color:var(--green-text)]" : "text-[color:var(--amber)]"
                )}
              >
                {c.value}
              </span>
            </div>
          ))}

          <div className="section-bar mt-3.5">
            <span className="section-bar-title">Interview notes</span>
          </div>
          {interviewLoading ? (
            <p className="mono-label px-5 py-4">Loading…</p>
          ) : interviewReviews.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-[color:var(--text-tertiary)]">
              No interview notes yet.
            </p>
          ) : (
            interviewReviews.map((review) => (
              <div key={review.id} className="border-b border-rule px-5 py-3">
                <div className="flex items-baseline justify-between gap-2.5">
                  <span className="text-[14px] font-bold text-ink">
                    {review.authorName}
                    {review.mine ? " · You" : ""}
                  </span>
                  <span className="shrink-0 text-right font-mono text-[9px] font-bold tracking-[0.12em] text-[color:var(--text-secondary)]">
                    {INTERVIEW_OUTCOME_LABEL[review.outcome].toUpperCase()}
                    {review.when ? ` · ${review.when}` : ""}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[14px] leading-[1.5] text-ink">
                  {review.notes?.trim() ? review.notes : "No written notes."}
                </p>
              </div>
            ))
          )}

          <div className="border-b border-rule px-5 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="mono-label">Your interview notes</div>
              {saveButton(
                "SAVE INTERVIEW NOTES",
                interviewSaving,
                onSaveInterview,
                locked || interviewLoading || !interviewReady
              )}
            </div>
            <label className="mb-3 block">
              <span className="mono-label mb-1.5 block">Interview outcome</span>
              <select
                value={interviewOutcome}
                disabled={interviewLoading || !interviewReady}
                onChange={(e) => onInterviewOutcomeChange(e.target.value as InterviewOutcome)}
                className="w-full border border-ink bg-white px-2 py-2 text-[14px] text-ink focus:outline-none disabled:opacity-50"
              >
                {INTERVIEW_OUTCOMES.map((value) => (
                  <option key={value} value={value}>
                    {INTERVIEW_OUTCOME_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
            <textarea
              value={interviewNotes}
              onChange={(e) => onInterviewNotesChange(e.target.value)}
              rows={4}
              disabled={interviewLoading || !interviewReady}
              placeholder="What you heard in the interview…"
              aria-label="Your interview notes"
              className="w-full resize-y border-0 border-l-[3px] border-ink bg-transparent pl-3 text-[14px] leading-[1.5] text-ink placeholder:text-[color:var(--text-tertiary)] focus:outline-none disabled:opacity-50"
            />
            {interviewFeedback && (
              <p
                className={cn(
                  "mt-2 text-[13px]",
                  interviewFeedback.tone === "ok"
                    ? "text-[color:var(--green-text)]"
                    : "text-destructive"
                )}
              >
                {interviewFeedback.text}
              </p>
            )}
          </div>

          <div className="mt-auto border-t border-rule bg-bone px-5 py-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="applicant-internal-note" className="mono-label">
                {noteMeta ?? "Internal note"}
              </label>
              {saveButton("SAVE NOTE", noteSaving, onSaveNote, locked)}
            </div>
            <textarea
              id="applicant-internal-note"
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              rows={4}
              placeholder="What the team should know before deciding…"
              className="w-full resize-y border-0 border-l-[3px] border-ink bg-transparent pl-3 text-[14px] leading-[1.5] text-ink placeholder:text-[color:var(--text-tertiary)] focus:outline-none"
            />
            <p className="mt-2 text-[12.5px] text-[color:var(--text-secondary)]">
              Saves the note only. This applicant&apos;s status stays as it is.
            </p>
            {noteFeedback && (
              <p
                className={cn(
                  "mt-2 text-[13px]",
                  noteFeedback.tone === "ok" ? "text-[color:var(--green-text)]" : "text-destructive"
                )}
              >
                {noteFeedback.text}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Decision bar — outside the scroll, always reachable ── */}
      <div className="flex shrink-0 flex-col gap-3 border-t border-ink bg-white px-5 py-3.5 md:flex-row md:items-center md:justify-between md:px-6">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--text-secondary)]">
          {acceptConsequence}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={locked}
            onClick={() => onDecision("rejected")}
            className="border border-rule-strong px-4 py-2.5 font-mono text-[10px] font-bold tracking-[0.12em] text-[color:var(--text-secondary)] hover:border-ink hover:text-ink disabled:opacity-50"
          >
            REJECT
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => onDecision("waitlisted")}
            className="border border-ink px-4 py-2.5 font-mono text-[10px] font-bold tracking-[0.12em] text-ink hover:bg-bone disabled:opacity-50"
          >
            WAITLIST
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => onDecision("accepted")}
            className="bg-ink px-5 py-2.5 font-mono text-[10px] font-bold tracking-[0.14em] text-white hover:bg-[var(--ink-bg-hover)] disabled:opacity-50"
          >
            {busy ? "SAVING…" : "ACCEPT →"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
