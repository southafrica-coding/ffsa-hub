"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { OkrObjective } from "@/types/okrs";

/** Create or edit one objective. `objective` null means create. */
export function ObjectiveDialog({
  objective,
  cycleId,
  ministryId,
  teamId,
  onClose,
}: {
  objective: OkrObjective | null;
  cycleId: string;
  /** Exactly one of ministryId / teamId is set — see migration 182. */
  ministryId: string | null;
  teamId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(objective?.title ?? "");
  const [description, setDescription] = useState(objective?.description ?? "");
  const [timeline, setTimeline] = useState(objective?.timeline ?? "");
  const [ownerNote, setOwnerNote] = useState(objective?.owner_note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Key results written alongside a NEW objective. Editing an existing one
  // does not offer these — its key results are already on the page, where
  // adding and reordering them belongs.
  const [keyResults, setKeyResults] = useState<string[]>(["", "", ""]);

  const filledKeyResults = keyResults.filter((d) => d.trim() !== "").length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const body = {
      title: title.trim(),
      description: description.trim() || null,
      timeline: timeline.trim() || null,
      owner_note: ownerNote.trim() || null,
      ...(objective
        ? {}
        : {
            cycle_id: cycleId,
            ...(teamId ? { okr_team_id: teamId } : { staff_ministry_id: ministryId }),
            // Blank rows are dropped server-side too; sending only the filled
            // ones keeps the request honest about what was asked for.
            key_results: keyResults
              .map((d) => d.trim())
              .filter((d) => d !== "")
              .map((description) => ({ description })),
          }),
    };

    const res = await fetch(
      objective ? `/api/okrs/objectives/${objective.id}` : "/api/okrs/objectives",
      {
        method: objective ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    setSaving(false);

    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Could not save that objective");
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{objective ? "Edit objective" : "New objective"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="objective-title">Objective</Label>
            <Textarea
              id="objective-title"
              required
              rows={2}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Steward the spiritual culture of FFSA"
            />
          </div>

          <div>
            <Label htmlFor="objective-description">Why it matters</Label>
            <Textarea
              id="objective-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional — the sentence that explains the objective to someone outside the ministry."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="objective-timeline">Timeline</Label>
              <Input
                id="objective-timeline"
                value={timeline}
                onChange={(e) => setTimeline(e.target.value)}
                placeholder="Optional — e.g. by Q3"
              />
            </div>
            <div>
              <Label htmlFor="objective-owner">Who is carrying it</Label>
              <Input
                id="objective-owner"
                value={ownerNote}
                onChange={(e) => setOwnerNote(e.target.value)}
                placeholder="Optional — a name or a team"
              />
            </div>
          </div>

          {!objective && (
            <div className="border-t border-rule pt-4">
              <Label>Key results</Label>
              <p className="mb-2 text-[12.5px] text-[color:var(--text-secondary)]">
                Optional — you can add them here now, or on the page afterwards.
              </p>
              <div className="space-y-2">
                {keyResults.map((kr, i) => (
                  <Input
                    key={i}
                    value={kr}
                    onChange={(e) =>
                      setKeyResults((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                    }
                    placeholder={
                      i === 0 ? "Lead 12 base-wide moments of consecration" : "Another key result"
                    }
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => setKeyResults((prev) => [...prev, ""])}
                className="mt-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--text-muted)] underline hover:text-ink"
              >
                + Add another
              </button>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || title.trim() === ""}>
              {saving
                ? "Saving…"
                : objective
                  ? "Save changes"
                  : filledKeyResults > 0
                    ? `Create with ${filledKeyResults} key result${filledKeyResults === 1 ? "" : "s"}`
                    : "Create objective"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
