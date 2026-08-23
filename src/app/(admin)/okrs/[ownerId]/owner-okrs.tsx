"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Bar, Drawer, MastheadButton, SectionBar, StatusPill } from "@/components/ffsa";
import { krProgress, metricCaption, statusLabel, statusTone } from "@/lib/okrs/progress";
import type { OkrKeyResult, OkrObjective } from "@/types/okrs";
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

  async function deleteObjective(id: string, title: string) {
    if (!confirm(`Delete “${title}” and all of its key results? This cannot be undone.`)) return;
    const res = await fetch(`/api/okrs/objectives/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error ?? "Could not delete that objective");
      return;
    }
    toast.success("Objective deleted");
    router.refresh();
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

                {(o.description || o.timeline || o.owner_note) && (
                  <p className="border-x border-rule bg-bone px-4 py-2.5 text-[12.5px] text-[color:var(--text-secondary)] md:px-5">
                    {o.description}
                    {o.timeline && <span className="ml-2 font-mono text-[10px]">{o.timeline}</span>}
                    {o.owner_note && <span className="ml-2 font-mono text-[10px]">{o.owner_note}</span>}
                  </p>
                )}

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
                  <div className="mt-2 flex flex-wrap gap-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em]">
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
                    <button
                      type="button"
                      className="text-destructive underline hover:opacity-70"
                      onClick={() => deleteObjective(o.id, o.title)}
                    >
                      Delete
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

      {(kr.timeline || kr.notes) && (
        <span className="font-mono text-[10px] tracking-[0.08em] text-[#7C786C]">
          {kr.timeline}
          {kr.timeline && kr.notes ? " · " : ""}
          {kr.notes}
        </span>
      )}
    </button>
  );
}
