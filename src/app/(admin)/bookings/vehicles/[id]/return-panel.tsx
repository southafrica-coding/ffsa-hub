"use client";

// The return on a booking's page (Gideon, 24 Nov 2026): when it's due back, Return early
// for the people on the booking, and for the Vehicle Coordinator: Returned, the early-return
// decision and the post-rental inspection in Fleet. Same actions as the Slack buttons.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionBar } from "@/components/ffsa";

export interface ReturnPanelProps {
  bookingId: string;
  status: string;
  /** The day it's due back (return_date) and the last day it's needed. */
  dueBackLabel: string;
  dueBack: string;
  today: string;
  returnedLabel: string | null;
  early: { date: string; label: string; status: string; by: string } | null;
  isManager: boolean;
  isMember: boolean;
  /** After Returned: each vehicle, and its post-rental inspection if recorded. */
  inspections: { vehicleId: string; name: string; inspectionId: string | null }[];
  openEarly?: boolean;
  /** An International Team booking: the days its vehicles are held, and any release. */
  hold?: { days: { from: string; to: string } | null; released: { by: string; note: string } | null } | null;
}

const addDay = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function ReturnPanel(p: ReturnPanelProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const latest = addDay(p.dueBack, -1);
  const canAskEarly = p.status === "approved" && !p.returnedLabel && (p.isMember || p.isManager) && p.today <= latest && p.early?.status !== "requested";
  const [asking, setAsking] = useState(!!p.openEarly && canAskEarly);
  const [day, setDay] = useState(p.today <= latest ? p.today : latest);
  const [releasing, setReleasing] = useState(false);
  const [note, setNote] = useState("");

  if (p.status !== "approved" && p.status !== "completed") return null;

  async function post(path: string, body?: unknown, done?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/vehicles/bookings/${p.bookingId}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "That didn't work. Try again.");
        return;
      }
      toast.success(json.message || done || "Done");
      setAsking(false);
      setReleasing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-ink bg-white">
      <SectionBar title="Return" />
      <div className="space-y-4 p-6 text-[14px]">
        <p>
          <span className="font-semibold">Due back {p.dueBackLabel}, before 12:00</span>: washed inside and out, with a full tank and the
          return checks done.
        </p>

        {p.hold && (
          <div className="space-y-2 border-l-2 border-ink bg-bone px-4 py-3">
            <p className="font-semibold">International team: full valet wash and a hold</p>
            {p.hold.released ? (
              <>
                <p>
                  Released by {p.hold.released.by}: &ldquo;{p.hold.released.note}&rdquo;
                </p>
                <p>The vehicles are free after the due-back day.</p>
              </>
            ) : (
              p.hold.days && (
                <p>
                  The vehicles are held from {p.hold.days.from} to {p.hold.days.to} (3 working days) for the post-rental inspection
                  and a full valet wash. The Vehicle Coordinator books the valet as soon as they&apos;re back.
                </p>
              )
            )}
            {p.isManager && !p.hold.released && !releasing && (
              <Button variant="outline" onClick={() => setReleasing(true)}>
                Release the hold
              </Button>
            )}
            {releasing && (
              <div className="space-y-2">
                <Label htmlFor="hold-note">Why release it? *</Label>
                <textarea
                  id="hold-note"
                  rows={3}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. The same team is taking the vehicles again on Monday"
                  className="w-full border border-rule p-2"
                />
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy || !note.trim()} onClick={() => post("hold", { note })}>
                    Release the hold
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => setReleasing(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {p.returnedLabel && <p className="text-[color:var(--text-secondary)]">✅ {p.returnedLabel}</p>}

        {p.early && (
          <p className="text-[color:var(--text-secondary)]">
            {p.early.status === "requested"
              ? `↩️ ${p.early.by} asked to return it early, on ${p.early.label}. Waiting for the Vehicle Coordinator.`
              : p.early.status === "approved"
                ? `✅ Early return approved: due back ${p.early.label}.`
                : `📞 Early return on ${p.early.label}: the Vehicle Coordinator will call ${p.early.by}.`}
          </p>
        )}

        {p.isManager && p.early?.status === "requested" && (
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => post("early-return/decision", { approve: true }, "Early return approved")}>
              Approve early return
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => post("early-return/decision", { approve: false }, "They'll get a message that you'll call")}>
              I&apos;ll call them
            </Button>
          </div>
        )}

        {canAskEarly && !asking && (
          <div>
            <Button variant="outline" onClick={() => setAsking(true)}>
              Return early
            </Button>
          </div>
        )}
        {asking && (
          <div className="space-y-3 border border-rule p-4">
            <Label htmlFor="early-day">Which day can you bring it back?</Label>
            <Input id="early-day" type="date" value={day} min={p.today} max={latest} onChange={(e) => setDay(e.target.value)} className="h-11 w-48" />
            <p className="text-xs text-[color:var(--text-secondary)]">Before 12:00 that day. The Vehicle Coordinator confirms.</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !day} onClick={() => post("early-return", { date: day })}>
                Ask the Vehicle Coordinator
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setAsking(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {p.isManager && p.status === "approved" && !p.returnedLabel && (
          <div>
            <Button disabled={busy} onClick={() => post("returned", {}, "Marked returned. Next: the post-rental inspection.")}>
              Mark returned
            </Button>
          </div>
        )}

        {p.isManager && p.returnedLabel && p.inspections.length > 0 && (
          <div className="space-y-2">
            <p className="font-semibold">Post-rental inspection</p>
            <ul className="space-y-1.5">
              {p.inspections.map((v) => (
                <li key={v.vehicleId} className="flex flex-wrap items-center gap-2">
                  <span>{v.inspectionId ? "✅" : "⬜"} {v.name}</span>
                  {v.inspectionId ? (
                    <a className="underline" href={`/bookings/vehicles/fleet/inspections/${v.inspectionId}`}>
                      View
                    </a>
                  ) : (
                    p.status === "approved" && (
                      <a className="underline" href={`/bookings/vehicles/fleet/${v.vehicleId}/inspect?type=post&booking=${p.bookingId}`}>
                        Record it in Fleet
                      </a>
                    )
                  )}
                </li>
              ))}
            </ul>
            {p.status === "approved" && <p className="text-xs text-[color:var(--text-secondary)]">The booking is completed once every vehicle&apos;s post-rental inspection is saved.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
