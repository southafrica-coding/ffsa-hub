"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";

type OkrKeyResult = {
  id: string;
  description: string;
  current_status: string;
};

export type OkrObjective = {
  id: string;
  title: string;
  description: string | null;
  timeline: string | null;
  staff_ministry_id: string | null;
  okr_key_results?: OkrKeyResult[];
};

const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  moving_forward: "Moving forward",
  stuck: "Stuck",
  complete: "Complete",
};

// Personal (individual-scope) OKRs on the staff CV card — a thin UI over the
// real OKR system (migration 182): objectives only for now, no key-result /
// metric authoring here yet. RLS on okr_objectives is the actual gate (self
// owns their own; their ministry leader or an admin can manage too — not the
// Leadership Team, since 271), so `canManage` here only decides which
// controls to render — a disallowed action still comes back as a clean 403.
export function PersonalOkrs({
  targetUserId,
  cycle,
  canManage,
  ministries,
  initialObjectives,
}: {
  targetUserId: string;
  cycle: { id: string; name: string } | null;
  canManage: boolean;
  ministries: { id: string; name: string }[];
  initialObjectives: OkrObjective[];
}) {
  const router = useRouter();
  const [objectives, setObjectives] = useState<OkrObjective[]>(initialObjectives);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftTimeline, setDraftTimeline] = useState("");
  const [draftMinistryId, setDraftMinistryId] = useState(ministries[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function beginAdd() {
    setAdding(true);
    setEditingId(null);
    setDraftTitle("");
    setDraftDescription("");
    setDraftTimeline("");
    setDraftMinistryId(ministries[0]?.id ?? "");
    setFormError(null);
  }

  function beginEdit(o: OkrObjective) {
    setEditingId(o.id);
    setAdding(false);
    setDraftTitle(o.title);
    setDraftDescription(o.description ?? "");
    setDraftTimeline(o.timeline ?? "");
    setFormError(null);
  }

  function cancelForm() {
    setAdding(false);
    setEditingId(null);
    setFormError(null);
  }

  async function submitAdd() {
    if (!cycle) return;
    if (!draftTitle.trim()) {
      setFormError("Please enter a title.");
      return;
    }
    if (!draftMinistryId) {
      setFormError("Choose which ministry this belongs to.");
      return;
    }
    setBusy(true);
    setFormError(null);
    const res = await fetch("/api/okrs/objectives", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cycle_id: cycle.id,
        staff_ministry_id: draftMinistryId,
        scope: "individual",
        owner_user_id: targetUserId,
        title: draftTitle.trim(),
        description: draftDescription.trim(),
        timeline: draftTimeline.trim(),
      }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setFormError(json.error ?? "Could not save.");
      return;
    }
    setObjectives((prev) => [...prev, { ...json.objective, okr_key_results: [] }]);
    setAdding(false);
  }

  async function submitEdit() {
    if (!editingId) return;
    if (!draftTitle.trim()) {
      setFormError("Please enter a title.");
      return;
    }
    setBusy(true);
    setFormError(null);
    const res = await fetch(`/api/okrs/objectives/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: draftTitle.trim(),
        description: draftDescription.trim(),
        timeline: draftTimeline.trim(),
      }),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setFormError(json.error ?? "Could not save.");
      return;
    }
    setObjectives((prev) =>
      prev.map((o) => (o.id === editingId ? { ...o, ...json.objective } : o))
    );
    setEditingId(null);
    router.refresh();
  }

  async function removeObjective(id: string): Promise<boolean> {
    setFormError(null);
    const res = await fetch(`/api/okrs/objectives/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setFormError(json.error ?? "Could not delete this objective.");
      return false;
    }
    setObjectives((prev) => prev.filter((o) => o.id !== id));
    setEditingId(null);
    return true;
  }

  const editing = editingId ? objectives.find((o) => o.id === editingId) ?? null : null;

  if (!cycle) {
    return <p className="text-sm text-muted-foreground">No OKR cycle is open right now.</p>;
  }

  const form = (
    <div className="mt-2 space-y-2 rounded-lg border p-3">
      <Input
        placeholder="Objective — what are you aiming for?"
        value={draftTitle}
        onChange={(e) => setDraftTitle(e.target.value)}
        autoFocus
      />
      <Textarea
        placeholder="Details (optional)"
        value={draftDescription}
        onChange={(e) => setDraftDescription(e.target.value)}
      />
      <Input
        placeholder="Timeline (optional, e.g. Q2)"
        value={draftTimeline}
        onChange={(e) => setDraftTimeline(e.target.value)}
      />
      {adding && ministries.length > 1 && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Ministry</label>
          {/* Native <select> on purpose — Radix popover selects don't open in Safari (PR #193). */}
          <select
            className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            value={draftMinistryId}
            onChange={(e) => setDraftMinistryId(e.target.value)}
          >
            {ministries.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {formError && <p className="text-sm text-destructive">{formError}</p>}
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={adding ? submitAdd : submitEdit}>
          {busy ? "Saving…" : editingId ? "Save" : "Add"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={cancelForm}>
          Cancel
        </Button>
        {/* Delete lives in the edit form, at the far end in danger styling,
            and only opens a confirmation that names the objective. */}
        {editing && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto border-destructive/40 text-destructive hover:bg-destructive hover:text-white"
            disabled={busy}
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 className="mr-1 h-4 w-4" aria-hidden /> Delete objective
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-2 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {cycle.name}
        </h3>
        {canManage && !adding && (
          <Button type="button" variant="outline" size="sm" onClick={beginAdd}>
            <Plus className="mr-1 h-4 w-4" /> Add objective
          </Button>
        )}
      </div>

      {objectives.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">No personal objectives yet this cycle.</p>
      ) : (
        <ul className="space-y-2">
          {objectives.map((o) =>
            editingId === o.id ? (
              <li key={o.id}>{form}</li>
            ) : (
              <li key={o.id} className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{o.title}</span>
                    {o.timeline && <Badge variant="secondary">{o.timeline}</Badge>}
                  </div>
                  {o.description && (
                    <p className="mt-0.5 text-sm text-muted-foreground">{o.description}</p>
                  )}
                  {(o.okr_key_results ?? []).length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {o.okr_key_results!.map((kr) => (
                        <li key={kr.id} className="text-xs text-muted-foreground">
                          · {kr.description}{" "}
                          <span className="text-muted-foreground/70">
                            ({STATUS_LABEL[kr.current_status] ?? kr.current_status})
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {canManage && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    aria-label="Edit"
                    onClick={() => beginEdit(o)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                )}
              </li>
            )
          )}
        </ul>
      )}

      {adding && form}

      {editing && confirmingDelete && (
        <ConfirmDeleteDialog
          open
          onOpenChange={(o) => !o && setConfirmingDelete(false)}
          title="Delete this objective?"
          itemName={editing.title}
          consequence={(() => {
            const n = editing.okr_key_results?.length ?? 0;
            return n > 0
              ? `Its ${n} key result${n === 1 ? "" : "s"} and their check-ins will be deleted with it. This can't be undone.`
              : "This can't be undone.";
          })()}
          confirmLabel="Delete objective"
          // Close either way: a refusal is shown as formError in the edit form
          // underneath, which the dialog would otherwise cover.
          onConfirm={async () => {
            await removeObjective(editing.id);
            return true;
          }}
        />
      )}
    </div>
  );
}
