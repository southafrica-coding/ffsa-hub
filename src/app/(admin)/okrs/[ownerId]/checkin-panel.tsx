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
import { OKR_STATUSES, type OkrCheckin, type OkrKeyResult, type OkrStatus } from "@/types/okrs";

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
  const [checkins, setCheckins] = useState<OkrCheckin[] | null>(null);
  const [status, setStatus] = useState<OkrStatus>(kr.current_status);
  const [value, setValue] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  const hasMetric = kr.metric_start !== null && kr.metric_target !== null;
  const progress = krProgress(kr);

  useEffect(() => {
    let cancelled = false;
    setCheckins(null);
    setStatus(kr.current_status);
    setValue("");
    setComment("");

    fetch(`/api/okrs/key-results/${kr.id}/checkins`)
      .then((r) => (r.ok ? r.json() : { checkins: [] }))
      .then((d) => {
        if (!cancelled) setCheckins((d.checkins ?? []) as OkrCheckin[]);
      })
      .catch(() => {
        if (!cancelled) setCheckins([]);
      });

    return () => {
      cancelled = true;
    };
  }, [kr.id, kr.current_status]);

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

      <div className="px-6 py-5">
        <p className="mono-label mb-3">History</p>
        {checkins === null ? (
          <p className="text-[12.5px] text-[color:var(--text-secondary)]">Loading…</p>
        ) : checkins.length === 0 ? (
          <p className="text-[12.5px] text-[color:var(--text-secondary)]">
            No check-ins yet. The first one will set this key result&rsquo;s status.
          </p>
        ) : (
          <ol className="space-y-3.5">
            {checkins.map((c) => (
              <li key={c.id} className="border-l-2 border-rule-strong pl-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={statusTone(c.status)}>{statusLabel(c.status)}</StatusPill>
                  <span className="font-mono text-[10px] tracking-[0.08em] text-[#7C786C]">
                    {c.checkin_on}
                    {c.author_name ? ` · ${c.author_name}` : ""}
                    {c.value !== null && c.value !== undefined ? ` · ${c.value}` : ""}
                  </span>
                </div>
                {c.comment && (
                  <p className="mt-1 text-[12.5px] leading-snug text-ink">{c.comment}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
