"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { OkrKeyResult } from "@/types/okrs";

/**
 * Create or edit one key result.
 *
 * The metric is opt-in and all-or-nothing: a start and a target together, or
 * neither. That is the same rule the okr_kr_metric_ck constraint enforces, and
 * it is what keeps a progress bar from appearing over a number nobody set.
 *
 * There is no status field here — status only ever moves through a check-in,
 * so that every change carries a date, an author and a reason.
 */
export function KeyResultDialog({
  objectiveId,
  keyResult,
  onClose,
}: {
  objectiveId: string;
  keyResult: OkrKeyResult | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [description, setDescription] = useState(keyResult?.description ?? "");
  const [label, setLabel] = useState(keyResult?.label ?? "");
  const [timeline, setTimeline] = useState(keyResult?.timeline ?? "");
  const [notes, setNotes] = useState(keyResult?.notes ?? "");
  const [tracked, setTracked] = useState(keyResult?.metric_target !== null && keyResult?.metric_target !== undefined);
  const [metricStart, setMetricStart] = useState(
    keyResult?.metric_start !== null && keyResult?.metric_start !== undefined
      ? String(keyResult.metric_start)
      : "0"
  );
  const [metricTarget, setMetricTarget] = useState(
    keyResult?.metric_target !== null && keyResult?.metric_target !== undefined
      ? String(keyResult.metric_target)
      : ""
  );
  const [metricUnit, setMetricUnit] = useState(keyResult?.metric_unit ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const metricInvalid =
    tracked &&
    (metricStart.trim() === "" ||
      metricTarget.trim() === "" ||
      Number(metricStart) === Number(metricTarget));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (metricInvalid) {
      setError("A tracked key result needs a start and a target, and they must differ.");
      return;
    }
    setSaving(true);
    setError(null);

    const body = {
      description: description.trim(),
      label: label.trim() || null,
      timeline: timeline.trim() || null,
      notes: notes.trim() || null,
      metric_start: tracked ? Number(metricStart) : null,
      metric_target: tracked ? Number(metricTarget) : null,
      metric_unit: tracked ? metricUnit.trim() || null : null,
    };

    const res = await fetch(
      keyResult
        ? `/api/okrs/key-results/${keyResult.id}`
        : `/api/okrs/objectives/${objectiveId}/key-results`,
      {
        method: keyResult ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    setSaving(false);

    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Could not save that key result");
      return;
    }
    onClose();
    router.refresh();
  }

  async function remove() {
    if (!keyResult) return;
    if (!confirm("Delete this key result and its check-in history? This cannot be undone.")) return;
    const res = await fetch(`/api/okrs/key-results/${keyResult.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error ?? "Could not delete that key result");
      return;
    }
    toast.success("Key result deleted");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{keyResult ? "Edit key result" : "New key result"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="kr-description">Key result</Label>
            <Textarea
              id="kr-description"
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Train 180+ individuals across FFSA's formal schools"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="kr-label">Reference</Label>
              <Input
                id="kr-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Optional — e.g. KR 2.2"
              />
            </div>
            <div>
              <Label htmlFor="kr-timeline">Timeline</Label>
              <Input
                id="kr-timeline"
                value={timeline}
                onChange={(e) => setTimeline(e.target.value)}
                placeholder="Optional — e.g. by June 2026"
              />
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <label className="flex items-start gap-2.5">
              <Checkbox
                checked={tracked}
                onCheckedChange={(c) => setTracked(c === true)}
                aria-label="Track this key result with a number"
              />
              <span className="text-sm">
                Track this with a number
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Only tick this when there is a real figure to count. Without it the key result
                  shows a status and no progress bar — which is the honest answer for most.
                </span>
              </span>
            </label>

            {tracked && (
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="kr-start">Starting from</Label>
                  <Input
                    id="kr-start"
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={metricStart}
                    onChange={(e) => setMetricStart(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="kr-target">Target</Label>
                  <Input
                    id="kr-target"
                    type="number"
                    step="any"
                    inputMode="decimal"
                    value={metricTarget}
                    onChange={(e) => setMetricTarget(e.target.value)}
                    placeholder="180"
                  />
                </div>
                <div>
                  <Label htmlFor="kr-unit">Unit</Label>
                  <Input
                    id="kr-unit"
                    value={metricUnit}
                    onChange={(e) => setMetricUnit(e.target.value)}
                    placeholder="people"
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="kr-notes">Notes</Label>
            <Textarea
              id="kr-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional — standing context. Progress updates belong in check-ins."
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-between gap-2">
            {keyResult ? (
              <Button type="button" variant="outline" onClick={remove}>
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || description.trim() === ""}>
                {saving ? "Saving…" : keyResult ? "Save changes" : "Add key result"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
