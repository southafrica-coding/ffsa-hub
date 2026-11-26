"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import type { FailureKind } from "./api";
import type { ConfirmSummary, Person } from "./followup";
import { failureCopy } from "./ui";
import styles from "./l10.module.css";

export type QuickKind = "todo" | "issue" | "headline";

export interface QuickValues {
  title: string;
  ownerId: string | null;
  dueOn: string | null;
}

export type SubmitOutcome =
  | { ok: true }
  | { ok: false; kind: FailureKind; fieldErrors: Record<string, string>; code?: string | null };

const HEADINGS: Record<QuickKind, string> = { todo: "New to-do", issue: "New issue", headline: "New headline" };
const SUBMIT: Record<QuickKind, string> = { todo: "Add to-do", issue: "Add issue", headline: "Add headline" };

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/** Bottom sheet for + To-do / + Issue / + Headline. The meeting stays on its segment. */
export function QuickAddSheet({
  kind,
  people,
  defaultOwner,
  defaultDue,
  initialTitle = "",
  heading,
  submitLabel,
  onSubmit,
  onClose,
}: {
  kind: QuickKind;
  people: readonly Person[];
  defaultOwner: string | null;
  defaultDue: string;
  initialTitle?: string;
  heading?: string;
  submitLabel?: string;
  onSubmit: (values: QuickValues) => Promise<SubmitOutcome>;
  onClose: () => void;
}) {
  const id = useId();
  const [title, setTitle] = useState(initialTitle);
  const [ownerId, setOwnerId] = useState(defaultOwner ?? "");
  const [dueOn, setDueOn] = useState(defaultDue);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<FailureKind | null>(null);
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEscape(onClose);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!title.trim()) local.title = "Say what it is.";
    if (kind === "todo" && !ownerId) local.owner_id = "Pick who owns it.";
    setErrors(local);
    setFailure(null);
    setFailureCode(null);
    if (Object.keys(local).length > 0) return;
    setSaving(true);
    const outcome = await onSubmit({
      title: title.trim(),
      ownerId: ownerId || null,
      dueOn: kind === "todo" ? dueOn || null : null,
    });
    setSaving(false);
    if (outcome.ok) return onClose();
    setErrors(outcome.fieldErrors);
    if (Object.keys(outcome.fieldErrors).length === 0) {
      setFailure(outcome.kind);
      setFailureCode(outcome.code ?? null);
    }
  }

  const ownerLabel = kind === "headline" ? "Whose" : "Owner";
  const ownerError = errors.owner_id ?? errors.author_id;

  return (
    <div className={styles.scrim} onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-h`}
        className={styles.sheet}
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
        noValidate
      >
        <h2 id={`${id}-h`} className={styles.sheetTitle}>
          {heading ?? HEADINGS[kind]}
        </h2>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>What</span>
          <input
            className={styles.input}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
            maxLength={500}
            aria-invalid={errors.title || errors.body ? true : undefined}
          />
          {errors.title || errors.body ? <p className={styles.fieldError}>{errors.title ?? errors.body}</p> : null}
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{ownerLabel}</span>
          <select
            className={styles.select}
            value={ownerId}
            onChange={(event) => setOwnerId(event.target.value)}
            aria-invalid={ownerError ? true : undefined}
          >
            <option value="">{kind === "todo" ? "Pick someone" : "No one in particular"}</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          {ownerError ? <p className={styles.fieldError}>{ownerError}</p> : null}
        </label>
        {kind === "todo" ? (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Due · next L10 by default</span>
            <input
              type="date"
              className={styles.input}
              value={dueOn}
              onChange={(event) => setDueOn(event.target.value)}
              aria-invalid={errors.due_on ? true : undefined}
            />
            {errors.due_on ? <p className={styles.fieldError}>{errors.due_on}</p> : null}
          </label>
        ) : null}
        {failure ? <p className={styles.fieldError}>{failureCopy(failure, failureCode)}</p> : null}
        <div className={styles.sheetActions}>
          <button type="button" className={styles.btn} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles.btnPrimary} disabled={saving}>
            {saving ? "Adding…" : (submitLabel ?? SUBMIT[kind])}
          </button>
        </div>
      </form>
    </div>
  );
}

function SumRow({ label, value, unit }: { label: string; value: number; unit: ReactNode }) {
  return (
    <div className={styles.sumRow}>
      <span className="min-w-0">{label}</span>
      <span className="flex-none">
        <span className={styles.sumNum}>{value}</span> <span className={styles.mono}>{unit}</span>
      </span>
    </div>
  );
}

/** "End meeting?" over Conclude. Nothing is sent until End & send. */
export function ConfirmDialog({
  summary,
  recapChannel = null,
  ending,
  failure,
  failureCode = null,
  onBack,
  onConfirm,
}: {
  summary: ConfirmSummary;
  /** recapChannelLabel(team), e.g. "Live channel". Null: no recap line at all. */
  recapChannel?: string | null;
  ending: boolean;
  failure: FailureKind | null;
  /** #741 `code` from the failed end, mapped to our copy before the kind fallback. */
  failureCode?: string | null;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const id = useId();
  useEscape(ending ? () => undefined : onBack);
  const unrated = summary.unratedNames;
  return (
    <div className={styles.scrimCenter}>
      <div role="alertdialog" aria-modal="true" aria-labelledby={`${id}-h`} aria-describedby={`${id}-d`} className={styles.dialog}>
        <h2 id={`${id}-h`} className={styles.sheetTitle}>
          End meeting?
        </h2>
        <p id={`${id}-d`} className="text-sm">
          Everyone with an open to-do gets a Slack DM listing theirs
          {summary.recapPosts > 0 ? `, and the recap goes to the ${recapChannel ?? "team channel"}.` : "."}
        </p>
        {unrated.length > 0 ? (
          <p className={styles.warn}>
            <strong>{unrated.join(", ")}</strong> {unrated.length === 1 ? "hasn't" : "haven't"} rated yet. Ending now
            leaves {unrated.length === 1 ? "that rating" : "those ratings"} out of the average.
          </p>
        ) : null}
        <div className="mt-2">
          <SumRow label="DMs with to-dos" value={summary.dmCount} unit={summary.dmCount === 1 ? "person" : "people"} />
          {recapChannel ? (
            <SumRow
              label={`Recap to ${recapChannel}`}
              value={summary.recapPosts}
              unit={summary.recapPosts === 1 ? "post" : "posts"}
            />
          ) : null}
          <SumRow label="Issues kept for next week" value={summary.issuesKept} unit={summary.issuesKept === 1 ? "issue" : "issues"} />
        </div>
        {failure ? <p className={styles.fieldError}>{failureCopy(failure, failureCode)}</p> : null}
        <div className={styles.sheetActions}>
          <button type="button" className={styles.btn} onClick={onBack} disabled={ending}>
            Back
          </button>
          <button type="button" className={styles.btnYellow} onClick={onConfirm} disabled={ending}>
            {ending ? "Sending…" : "End & send"}
          </button>
        </div>
      </div>
    </div>
  );
}
