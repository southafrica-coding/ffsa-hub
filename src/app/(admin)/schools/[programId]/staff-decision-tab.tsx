"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StaffDecisionRow } from "@/lib/schools/staff-decisions";
import {
  departmentChoice,
  labelForDepartment,
} from "@/lib/users/department-options";

// Leadership Track "accepted as staff?" (migration 247). Leadership Team only
// — the page decides whether this renders at all; the API re-checks.
//
// Recording a "yes" then offers to make the person staff and pick their
// department in the same dialog. Native radios and <select> on purpose —
// Radix/cmdk popovers don't open in Safari.

type Step = "decide" | "make-staff";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function StaffDecisionTab({
  rows,
  departmentOptions,
}: {
  rows: StaffDecisionRow[];
  departmentOptions: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [active, setActive] = useState<StaffDecisionRow | null>(null);
  const [step, setStep] = useState<Step>("decide");
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [department, setDepartment] = useState("");
  const [busy, setBusy] = useState(false);

  const yes = rows.filter((r) => r.decision?.accepted === true).length;
  const no = rows.filter((r) => r.decision?.accepted === false).length;
  const undecided = rows.length - yes - no;

  function openDecide(row: StaffDecisionRow) {
    setActive(row);
    setStep("decide");
    setAccepted(row.decision ? row.decision.accepted : null);
    setNote(row.decision?.note ?? "");
    setDepartment(departmentChoice(row.department, departmentOptions));
  }

  function openMakeStaff(row: StaffDecisionRow) {
    setActive(row);
    setStep("make-staff");
    setDepartment(departmentChoice(row.department, departmentOptions));
  }

  function close() {
    setActive(null);
  }

  const noteRequired = accepted === false;
  const canSave = accepted !== null && (!noteRequired || note.trim().length > 0);

  async function saveDecision() {
    if (!active || accepted === null) return;
    setBusy(true);
    const res = await fetch("/api/schools/staff-decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enrollment_id: active.enrollmentId, accepted, note }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      toast.error(b.error ?? "Could not save the decision");
      return;
    }
    toast.success("Decision saved");
    router.refresh();
    // A "yes" for someone who isn't staff yet → offer the role switch now.
    if (accepted && active.userId && !active.isStaff) setStep("make-staff");
    else close();
  }

  async function makeStaff() {
    if (!active) return;
    setBusy(true);
    const res = await fetch("/api/schools/staff-decisions/make-staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enrollment_id: active.enrollmentId, department }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      toast.error(b.error ?? "Could not make them staff");
      return;
    }
    toast.success(`${active.name} is now staff`);
    close();
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-[color:var(--text-secondary)]">
          Everyone who arrived at this school. Only the Leadership Team can see
          this tab — students never see their decision or note.
        </p>
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--text-secondary)]">
          {yes} yes · {no} no · {undecided} undecided
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="border border-rule px-4 py-6 text-[13px] text-[color:var(--text-secondary)]">
          Nobody is marked as arrived yet. Students show up here once they&rsquo;re
          set to Arrived on the Arrival tab.
        </p>
      ) : (
        <div className="overflow-x-auto border border-rule">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-ink bg-bone">
              <tr className="font-mono text-[10px] uppercase tracking-[0.14em]">
                <th className="px-3 py-2">Student</th>
                <th className="px-3 py-2">Accepted as staff</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2">Decided</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.enrollmentId} className="border-b border-rule align-top last:border-0">
                  <td className="px-3 py-3">
                    <div className="font-medium">{row.name}</div>
                    {row.email && (
                      <div className="text-[12px] text-[color:var(--text-secondary)]">{row.email}</div>
                    )}
                    {row.isStaff && (
                      <div className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-grass">
                        Staff
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {row.decision ? (
                      <span
                        className={
                          row.decision.accepted
                            ? "font-semibold text-grass"
                            : "font-semibold text-amber"
                        }
                      >
                        {row.decision.accepted ? "Yes" : "No"}
                      </span>
                    ) : (
                      <span className="text-[color:var(--text-secondary)]">Not decided</span>
                    )}
                  </td>
                  <td className="max-w-xs px-3 py-3 text-[color:var(--text-secondary)]">
                    <span className="line-clamp-3 whitespace-pre-line">
                      {row.decision?.note || "—"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-[12px] text-[color:var(--text-secondary)]">
                    {row.decision ? (
                      <>
                        {formatDate(row.decision.decidedAt)}
                        {row.decision.decidedByName && <div>by {row.decision.decidedByName}</div>}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {row.decision?.accepted && row.userId && !row.isStaff && (
                        <Button size="sm" variant="outline" onClick={() => openMakeStaff(row)}>
                          Make staff
                        </Button>
                      )}
                      <Button size="sm" variant={row.decision ? "ghost" : "default"} onClick={() => openDecide(row)}>
                        {row.decision ? "Change" : "Decide"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!active} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-md">
          {active && step === "decide" && (
            <>
              <DialogHeader>
                <DialogTitle>Accept {active.name} as staff?</DialogTitle>
                <DialogDescription>
                  Only the Leadership Team sees this decision and note.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <fieldset className="flex gap-6">
                  <legend className="sr-only">Accepted as staff</legend>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="staff-accepted"
                      checked={accepted === true}
                      onChange={() => setAccepted(true)}
                    />
                    Yes
                  </label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="staff-accepted"
                      checked={accepted === false}
                      onChange={() => setAccepted(false)}
                    />
                    No
                  </label>
                </fieldset>
                <div className="space-y-1.5">
                  <Label htmlFor="staff-decision-note">
                    Note {noteRequired ? "(required — why not?)" : "(optional)"}
                  </Label>
                  <Textarea
                    id="staff-decision-note"
                    rows={4}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={
                      noteRequired
                        ? "Why they weren't accepted onto staff…"
                        : "Anything worth remembering…"
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={close} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={saveDecision} disabled={busy || !canSave}>
                  {busy ? "Saving…" : "Save decision"}
                </Button>
              </DialogFooter>
            </>
          )}

          {active && step === "make-staff" && (
            <>
              <DialogHeader>
                <DialogTitle>Make {active.name} staff now?</DialogTitle>
                <DialogDescription>
                  This switches their Hub role from Student to Staff. You can
                  also do it later from this tab.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="staff-decision-department">Department</Label>
                {active.department &&
                  !departmentOptions.some((o) => o.value === active.department) && (
                    <p className="text-[13px] text-[color:var(--text-secondary)]">
                      Current department:{" "}
                      {labelForDepartment(active.department, departmentOptions)}
                    </p>
                  )}
                <select
                  id="staff-decision-department"
                  className="flex h-9 w-full border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                >
                  <option value="">Choose later…</option>
                  {departmentOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={close} disabled={busy}>
                  Not now
                </Button>
                <Button onClick={makeStaff} disabled={busy}>
                  {busy ? "Saving…" : "Make staff"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
