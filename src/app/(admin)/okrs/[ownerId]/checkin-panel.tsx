"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Bar, StatusPill } from "@/components/ffsa";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { krProgress, metricCaption, statusLabel, statusTone } from "@/lib/okrs/progress";
import { detail, lastNotesEdit, summarise } from "@/lib/okrs/events";
import { formatRelativeTime } from "@/lib/users/lifecycle";
import {
  OKR_STATUSES,
  type OkrEvent,
  type OkrHistoryEntry,
  type OkrKeyResult,
  type OkrStatus,
} from "@/types/okrs";

const STATUS_OPTIONS = OKR_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }));

/**
 * The check-in history for one key result, plus the form that adds to it.
 *
 * Posting a check-in is the ONLY way current_status moves — the row's status
 * is derived from the latest entry by a database trigger, so there is no
 * "change status" control that would leave no trace of who changed it or why.
 */
export function CheckinPanel({
  kr,
  objectiveTitle,
  canEdit,
  onEditKeyResult,
}: {
  kr: OkrKeyResult;
  objectiveTitle: string;
  canEdit: boolean;
  onEditKeyResult?: () => void;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<OkrHistoryEntry[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [status, setStatus] = useState<OkrStatus>(kr.current_status);
  const [value, setValue] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState(kr.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);

  const hasMetric = kr.metric_start !== null && kr.metric_target !== null;
  const progress = krProgress(kr);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setTruncated(false);
    setStatus(kr.current_status);
    setValue("");
    setComment("");
    setNotes(kr.notes ?? "");

    fetch(`/api/okrs/key-results/${kr.id}/history`)
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((d) => {
        if (cancelled) return;
        setEntries((d.entries ?? []) as OkrHistoryEntry[]);
        setTruncated(Boolean(d.truncated));
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });

    return () => {
      cancelled = true;
    };
  }, [kr.id, kr.current_status, kr.notes]);

  // Who last touched the notes, read back out of the same history. Not from
  // updated_at, which the check-in trigger stamps on every progress update and
  // which would therefore date January's note to this morning.
  const notesEdit = lastNotesEdit(
    (entries ?? []).filter((e) => e.kind === "event").map((e) => (e as { event: OkrEvent }).event)
  );

  async function saveNotes() {
    setSavingNotes(true);
    const res = await fetch(`/api/okrs/key-results/${kr.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: notes.trim() || null }),
    });
    setSavingNotes(false);
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error ?? "Could not save those notes");
      return;
    }
    toast.success("Notes saved");
    router.refresh();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/okrs/key-results/${kr.id}/checkins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        value: hasMetric && value.trim() !== "" ? Number(value) : null,
        comment: comment.trim() || null,
      }),
    });
    setSaving(false);

    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error ?? "Could not save that check-in");
      return;
    }
    toast.success("Check-in saved");
    setComment("");
    setValue("");
    router.refresh();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-rule px-6 py-5">
        <p className="mono-label mb-2">{objectiveTitle}</p>
        <p className="text-[14px] leading-snug text-ink">{kr.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusPill tone={statusTone(kr.current_status)}>{statusLabel(kr.current_status)}</StatusPill>
          <span className="font-mono text-[10px] tracking-[0.08em] text-[#7C786C]">
            {kr.last_checkin_at ? formatRelativeTime(kr.last_checkin_at) : "never updated"}
          </span>
          {canEdit && onEditKeyResult && (
            <button
              type="button"
              onClick={onEditKeyResult}
              className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#55524A] underline hover:text-ink"
            >
              Edit
            </button>
          )}
        </div>
        {progress && (
          <div className="mt-3">
            <Bar pct={progress.pct} tone={progress.tone} />
            <span className="mt-1 block font-mono text-[10px] tracking-[0.08em] text-[#7C786C]">
              {metricCaption(kr)}
            </span>
          </div>
        )}
      </div>

      {canEdit && (
        <form onSubmit={submit} className="border-b border-rule bg-bone px-6 py-5">
          <p className="mono-label mb-3">New check-in</p>

          <div className="space-y-3">
            <div>
              <Label htmlFor="checkin-status">Status</Label>
              <SearchableSelect
                id="checkin-status"
                value={status}
                onChange={(v) => setStatus(v as OkrStatus)}
                options={STATUS_OPTIONS}
              />
            </div>

            {hasMetric && (
              <div>
                <Label htmlFor="checkin-value">
                  Where it stands now{kr.metric_unit ? ` (${kr.metric_unit})` : ""}
                </Label>
                <Input
                  id="checkin-value"
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={kr.current_value !== null ? String(kr.current_value) : ""}
                />
              </div>
            )}

            <div>
              <Label htmlFor="checkin-comment">What changed</Label>
              <Textarea
                id="checkin-comment"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Optional — the sentence a reviewer needs next month."
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white hover:bg-[#262622] disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save check-in"}
            </button>
          </div>
        </form>
      )}

      <div className="border-b border-rule px-6 py-5">
        <p className="mono-label mb-3">Notes</p>
        {canEdit ? (
          <>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Standing context — the things a reader needs to understand this key result. Progress updates belong in a check-in."
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={saveNotes}
                disabled={savingNotes || (notes.trim() || null) === (kr.notes ?? null)}
                className="border border-ink bg-white px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-ink hover:bg-bone disabled:opacity-40"
              >
                {savingNotes ? "Saving…" : "Save notes"}
              </button>
              {notesEdit && (
                <span className="font-mono text-[10px] tracking-[0.08em] text-[#7C786C]">
                  edited {formatRelativeTime(notesEdit.at)}
                  {notesEdit.actor ? ` · ${notesEdit.actor}` : ""}
                </span>
              )}
            </div>
          </>
        ) : kr.notes ? (
          <>
            <p className="whitespace-pre-wrap text-[12.5px] leading-snug text-ink">{kr.notes}</p>
            {notesEdit && (
              <span className="mt-2 block font-mono text-[10px] tracking-[0.08em] text-[#7C786C]">
                edited {formatRelativeTime(notesEdit.at)}
                {notesEdit.actor ? ` · ${notesEdit.actor}` : ""}
              </span>
            )}
          </>
        ) : (
          <p className="text-[12.5px] text-[color:var(--text-secondary)]">No notes yet.</p>
        )}
      </div>

      <div className="px-6 py-5">
        <p className="mono-label mb-3">History</p>
        {entries === null ? (
          <p className="text-[12.5px] text-[color:var(--text-secondary)]">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-[12.5px] text-[color:var(--text-secondary)]">
            Nothing yet. The first check-in will set this key result&rsquo;s status.
          </p>
        ) : (
          <>
            <ol className="space-y-3.5">
              {entries.map((entry) =>
                entry.kind === "checkin" ? (
                  <li key={`c-${entry.checkin.id}`} className="border-l-2 border-rule-strong pl-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={statusTone(entry.checkin.status)}>
                        {statusLabel(entry.checkin.status)}
                      </StatusPill>
                      <span className="font-mono text-[10px] tracking-[0.08em] text-[#7C786C]">
                        {/* checkin_on, not `at` — the date the author meant, not the row's. */}
                        {entry.checkin.checkin_on}
                        {entry.author ? ` · ${entry.author}` : ""}
                        {entry.checkin.value !== null && entry.checkin.value !== undefined
                          ? ` · ${entry.checkin.value}`
                          : ""}
                      </span>
                    </div>
                    {entry.checkin.comment && (
                      <p className="mt-1 text-[12.5px] leading-snug text-ink">
                        {entry.checkin.comment}
                      </p>
                    )}
                  </li>
                ) : (
                  /* Edits sit on a lighter rule than check-ins: same stream, but a
                     progress update is a statement and an edit is a footnote. */
                  <li key={`e-${entry.event.id}`} className="border-l-2 border-rule pl-3">
                    <p className="text-[12.5px] leading-snug text-ink">{summarise(entry.event)}</p>
                    <span className="mt-0.5 block font-mono text-[10px] tracking-[0.08em] text-[#7C786C]">
                      {formatRelativeTime(entry.at)}
                      {entry.author ? ` · ${entry.author}` : ""}
                    </span>
                    {detail(entry.event) && (
                      <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-snug text-[color:var(--text-secondary)]">
                        {detail(entry.event)}
                      </p>
                    )}
                  </li>
                )
              )}
            </ol>
            {truncated && (
              <p className="mt-3 font-mono text-[10px] tracking-[0.08em] text-[#7C786C]">
                Showing the most recent 100 entries.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
