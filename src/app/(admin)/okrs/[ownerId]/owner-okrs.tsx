"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";

import { Bar, MastheadButton, SectionBar, StatusPill } from "@/components/ffsa";
import { Drawer } from "@/components/ffsa/client";
import { krProgress, metricCaption, statusLabel, statusTone } from "@/lib/okrs/progress";
import { formatRelativeTime } from "@/lib/users/lifecycle";
import type { OkrKeyResult, OkrObjective } from "@/types/okrs";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { CheckinPanel } from "./checkin-panel";
import { ObjectiveDialog } from "./objective-dialog";
import { KeyResultDialog } from "./key-result-dialog";

/**
 * One group's objectives and key results — a staff ministry or an OKR-only
 * team, it renders the same either way.
 *
 * Scope-agnostic on purpose: it takes objectives and a canEdit flag, nothing
 * about who owns them, so the individual-OKR build can reuse it as-is.
 */
export function OwnerOkrs({
  objectives,
  canEdit,
  cycleId,
  ministryId,
  teamId,
}: {
  objectives: OkrObjective[];
  canEdit: boolean;
  cycleId: string;
  ministryId: string | null;
  teamId: string | null;
}) {
  const router = useRouter();
  const [openKrId, setOpenKrId] = useState<string | null>(null);
  const [editingObjective, setEditingObjective] = useState<OkrObjective | "new" | null>(null);
  const [editingKr, setEditingKr] = useState<{ objectiveId: string; kr: OkrKeyResult | null } | null>(
    null
  );

  // Flat order drives the drawer's prev/next, so a monthly review can walk the
  // whole ministry without closing the panel.
  const flatKrs = useMemo(
    () => objectives.flatMap((o) => (o.okr_key_results ?? []).map((kr) => ({ kr, objective: o }))),
    [objectives]
  );
  const openIndex = flatKrs.findIndex((e) => e.kr.id === openKrId);
  const open = openIndex >= 0 ? flatKrs[openIndex] : null;

  const [deletingObjective, setDeletingObjective] = useState<OkrObjective | null>(null);

  async function deleteObjective(id: string): Promise<boolean> {
    const res = await fetch(`/api/okrs/objectives/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error ?? "Could not delete that objective");
      return false;
    }
    toast.success("Objective deleted");
    router.refresh();
    return true;
  }

  return (
    <>
      {canEdit && (
        <div className="mb-5">
          <MastheadButton onClick={() => setEditingObjective("new")}>New objective</MastheadButton>
        </div>
      )}

      {objectives.length === 0 ? (
        // Every ministry is linked from the wall now, including ones nobody has
        // written yet, so a reader without edit rights lands here often. Say who
        // can fill it in rather than leaving them at a dead end.
        <p className="text-[13px] text-[color:var(--text-secondary)]">
          {canEdit
            ? "No objectives yet — add the first one to get started."
            : "No objectives have been written for this cycle yet."}
        </p>
      ) : (
        <div className="space-y-7">
          {objectives.map((o) => {
            const krs = o.okr_key_results ?? [];
            return (
              <section key={o.id}>
                <SectionBar
                  title={`${o.position}. ${o.title}`}
                  meta={`${krs.length} KR${krs.length === 1 ? "" : "s"}`}
                />

                {(o.description || o.timeline) && (
                  <p className="border-x border-rule bg-bone px-4 py-2.5 text-[12.5px] text-[color:var(--text-secondary)] md:px-5">
                    {o.description}
                    {o.timeline && <span className="ml-2 font-mono text-[10px]">{o.timeline}</span>}
                  </p>
                )}

                {/* Notes are their own thing, not a footnote on the description
                    and not the same as owner_note ("who is carrying it"). */}
                <ObjectiveNotes objective={o} canEdit={canEdit} />

                <div className="border-x border-b border-rule">
                  {krs.length === 0 ? (
                    <p className="px-4 py-3 text-[12.5px] text-[color:var(--text-secondary)] md:px-5">
                      No key results written for this objective yet.
                    </p>
                  ) : (
                    krs.map((kr) => (
                      <KeyResultRow key={kr.id} kr={kr} onOpen={() => setOpenKrId(kr.id)} />
                    ))
                  )}
                </div>

                {canEdit && (
                  <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em]">
                    <button
                      type="button"
                      className="text-[#55524A] underline hover:text-ink"
                      onClick={() => setEditingKr({ objectiveId: o.id, kr: null })}
                    >
                      + Key result
                    </button>
                    <button
                      type="button"
                      className="text-[#55524A] underline hover:text-ink"
                      onClick={() => setEditingObjective(o)}
                    >
                      Edit objective
                    </button>
                    {/* Pushed to the far end and set apart, so it is never
                        the button next to Edit. It only opens a confirmation. */}
                    <button
                      type="button"
                      className="ml-auto inline-flex items-center gap-1.5 border border-destructive/40 px-2 py-1 text-destructive hover:bg-destructive hover:text-white"
                      onClick={() => setDeletingObjective(o)}
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                      Delete objective
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <Drawer
        open={open !== null}
        onClose={() => setOpenKrId(null)}
        label={open ? open.kr.label || "Key result" : "Key result"}
        onPrev={openIndex > 0 ? () => setOpenKrId(flatKrs[openIndex - 1].kr.id) : undefined}
        onNext={
          openIndex >= 0 && openIndex < flatKrs.length - 1
            ? () => setOpenKrId(flatKrs[openIndex + 1].kr.id)
            : undefined
        }
      >
        {open && (
          <CheckinPanel
            kr={open.kr}
            objectiveTitle={open.objective.title}
            canEdit={canEdit}
            onEditKeyResult={
              canEdit ? () => setEditingKr({ objectiveId: open.objective.id, kr: open.kr }) : undefined
            }
          />
        )}
      </Drawer>

      {editingObjective !== null && (
        <ObjectiveDialog
          objective={editingObjective === "new" ? null : editingObjective}
          cycleId={cycleId}
          ministryId={ministryId}
          teamId={teamId}
          onClose={() => setEditingObjective(null)}
        />
      )}

      {deletingObjective !== null && (
        <ConfirmDeleteDialog
          open
          onOpenChange={(o) => !o && setDeletingObjective(null)}
          title="Delete this objective?"
          itemName={deletingObjective.title}
          consequence={(() => {
            const n = deletingObjective.okr_key_results?.length ?? 0;
            return n > 0
              ? `Its ${n} key result${n === 1 ? "" : "s"} and all of their check-ins will be deleted with it. This can't be undone.`
              : "This can't be undone.";
          })()}
          confirmLabel="Delete objective"
          onConfirm={() => deleteObjective(deletingObjective.id)}
        />
      )}

      {editingKr !== null && (
        <KeyResultDialog
          objectiveId={editingKr.objectiveId}
          keyResult={editingKr.kr}
          onClose={() => setEditingKr(null)}
        />
      )}
    </>
  );
}

function KeyResultRow({ kr, onOpen }: { kr: OkrKeyResult; onOpen: () => void }) {
  // No ratio, no bar: krProgress is null for prose key results, and the row
  // renders no track at all rather than an empty one.
  const progress = krProgress(kr);
  const caption = metricCaption(kr);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-2 border-b border-rule px-4 py-3.5 text-left last:border-b-0 hover:bg-bone md:px-5"
    >
      <div className="flex w-full flex-wrap items-start justify-between gap-3">
        <span className="min-w-0 flex-1 text-[13.5px] leading-snug text-ink">
          {kr.label && (
            <span className="mr-2 font-mono text-[10px] tracking-[0.08em] text-[#7C786C]">
              {kr.label}
            </span>
          )}
          {kr.description}
        </span>
        <StatusPill tone={statusTone(kr.current_status)}>{statusLabel(kr.current_status)}</StatusPill>
      </div>

      {progress && (
        <div className="w-full max-w-sm">
          <Bar pct={progress.pct} tone={progress.tone} />
          <span className="mt-1 block font-mono text-[10px] tracking-[0.08em] text-[#7C786C]">
            {caption}
          </span>
        </div>
      )}

      {/* Recency is the point of the row: a key result nobody has touched for
          six months should not look like one updated yesterday. Notes are no
          longer crammed in here — they have their own box in the drawer. */}
      <span className="font-mono text-[10px] tracking-[0.08em] text-[#7C786C]">
        {kr.timeline && <>{kr.timeline} · </>}
        {kr.last_checkin_at ? `updated ${formatRelativeTime(kr.last_checkin_at)}` : "never updated"}
        {kr.notes ? " · has notes" : ""}
      </span>
    </button>
  );
}

/**
 * An objective's standing notes — context for the whole group of key results,
 * as opposed to a progress update on any one of them.
 *
 * Its own column, added in migration 197 — `description` is "why this
 * matters" and `owner_note` is who is carrying it, both already surfaced and
 * labelled, so neither could absorb this without losing its meaning.
 *
 * Collapsed by default when empty and not editable, so a ministry with no
 * objective notes does not carry an empty box under every heading.
 */
function ObjectiveNotes({
  objective,
  canEdit,
}: {
  objective: OkrObjective;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(objective.notes ?? "");
  const [saving, setSaving] = useState(false);

  const stored = objective.notes ?? null;
  if (!stored && !canEdit) return null;

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/okrs/objectives/${objective.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: notes.trim() || null }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error ?? "Could not save those notes");
      return;
    }
    toast.success("Notes saved");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <div className="border-x border-rule px-4 py-2 md:px-5">
        {stored ? (
          <p className="whitespace-pre-wrap text-[12.5px] leading-snug text-[color:var(--text-secondary)]">
            {stored}
            {canEdit && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="ml-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#55524A] underline hover:text-ink"
              >
                Edit
              </button>
            )}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-[#55524A] underline hover:text-ink"
          >
            + Notes
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="border-x border-rule px-4 py-3 md:px-5">
      <Textarea
        rows={3}
        value={notes}
        autoFocus
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Context for this objective as a whole."
      />
      <div className="mt-2 flex gap-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em]">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="text-ink underline disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setNotes(stored ?? "");
            setOpen(false);
          }}
          className="text-[#55524A] underline hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
