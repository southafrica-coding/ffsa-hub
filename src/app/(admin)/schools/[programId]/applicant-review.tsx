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
  /** Mono sentence beside the decision buttons, stating what Accept does. */
  acceptConsequence: string;
  busy: boolean;
  /** Answers can be uploaded files; the parent owns the storage-aware render. */
  renderAnswer?: (answer: string) => React.ReactNode;
  onNoteChange: (value: string) => void;
  onDecision: (status: "rejected" | "waitlisted" | "accepted") => void;
  onClose: () => void;
  /** Reference chasing, email history, staff assignment — parent-owned. */
  extras?: React.ReactNode;
}) {
  const [showExtras, setShowExtras] = useState(false);
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

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* ── Pipeline strip ── */}
      <div className="flex shrink-0 items-stretch gap-px overflow-x-auto border-b border-ink bg-[#F7F5EE] px-5 py-3.5 md:px-6">
        {stages.map((s) => {
          const hot = s.key === currentStatus;
          return (
            <div
              key={s.key}
              className={cn(
                "min-w-[104px] flex-1 border px-3 py-2.5",
                hot ? "border-ink bg-yellow" : "border-rule bg-white"
              )}
            >
              <div className="numeral text-[26px] leading-none">{s.count}</div>
              <div className="mt-1 font-mono text-[8.5px] font-bold tracking-[0.14em] text-[color:var(--text-secondary)]">
                {s.label}
              </div>
            </div>
          );
        })}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close applicant review"
          className="ml-3 shrink-0 self-start px-2 py-2 font-mono text-[14px] text-ink hover:text-electric"
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
              <div className="py-4">
                <button
                  type="button"
                  onClick={() => setShowExtras((v) => !v)}
                  aria-expanded={showExtras}
                  className="mono-label border border-rule-strong px-3 py-2 hover:border-ink"
                >
                  {showExtras ? "Hide" : "Show"} reference chasing · email history · assignment
                </button>
                {showExtras && <div className="mt-4">{extras}</div>}
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

          <div className="mt-auto border-t border-rule bg-bone px-5 py-4">
            <div className="mono-label mb-2">{noteMeta ?? "Internal note"}</div>
            <textarea
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              rows={4}
              placeholder="What the team should know before deciding…"
              className="w-full resize-y border-0 border-l-[3px] border-ink bg-transparent pl-3 text-[14px] leading-[1.5] text-ink placeholder:text-[color:var(--text-tertiary)] focus:outline-none"
            />
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
            disabled={busy}
            onClick={() => onDecision("rejected")}
            className="border border-rule-strong px-4 py-2.5 font-mono text-[10px] font-bold tracking-[0.12em] text-[color:var(--text-secondary)] hover:border-ink hover:text-ink disabled:opacity-50"
          >
            REJECT
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecision("waitlisted")}
            className="border border-ink px-4 py-2.5 font-mono text-[10px] font-bold tracking-[0.12em] text-ink hover:bg-bone disabled:opacity-50"
          >
            WAITLIST
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecision("accepted")}
            className="bg-ink px-5 py-2.5 font-mono text-[10px] font-bold tracking-[0.14em] text-white hover:bg-[#262622] disabled:opacity-50"
          >
            {busy ? "SAVING…" : "ACCEPT →"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
