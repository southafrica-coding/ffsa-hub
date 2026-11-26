"use client";

// The one-button actions on Today and the Calendar (the Fleet app's startBtn,
// ws-dropoff and move-trip). Book, Collected and "Move the workshop visit to …" open the
// workshop visit form (VisitButton) with the right values.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { draftKey } from "@/lib/fleet/inspection";
import { fmtRange } from "@/lib/fleet/rules/format";
import { cn } from "@/lib/utils/cn";
import { fleetFetch } from "./client-api";
import { ActionButton, FLEET } from "./ui";

const small = "inline-flex min-h-11 items-center justify-center border px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em]";

/** Start a check of this type, or Continue when this device holds a draft for the vehicle. */
export function StartButton({ vehicleId, type, label = "Start" }: { vehicleId: string; type: string; label?: string }) {
  const [draft, setDraft] = useState(false);
  useEffect(() => {
    try {
      setDraft(!!window.localStorage.getItem(draftKey(vehicleId)));
    } catch {
      setDraft(false);
    }
  }, [vehicleId]);
  return (
    <Link
      href={draft ? `${FLEET}/${vehicleId}/inspect` : `${FLEET}/${vehicleId}/inspect?type=${type}`}
      className={cn(small, "border-ink bg-ink text-white hover:bg-[#262622] hover:text-white")}
    >
      {draft ? "Continue" : label}
    </Link>
  );
}

/** "Dropped off": the vehicle is at the workshop from today. */
export function DropOffButton({ vehicleId, today }: { vehicleId: string; today: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      await fleetFetch(`/api/vehicles/fleet/vehicles/${vehicleId}`, { method: "PATCH", body: { patch: { status: "In workshop", statusSince: today } } });
      await fleetFetch("/api/vehicles/fleet/time", { body: { kind: "workshop", vehicleId, mins: 1 } }).catch(() => {});
      toast.success("Marked as at the workshop.");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ActionButton onClick={go} disabled={busy}>
      Dropped off
    </ActionButton>
  );
}

/** "Move <trip> to <vehicle>" on a clash: moves the Hub booking to a similar free vehicle. */
export function MoveTripButton({
  trip,
  to,
}: {
  trip: { id: string; label: string; from: string; to: string };
  to: { id: string; name: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!window.confirm(`Move ${trip.label} (${fmtRange(trip.from, trip.to)}) to ${to.name}? The person who booked it gets a message with the new vehicle and their booking details.`)) return;
    setBusy(true);
    try {
      const r = await fleetFetch<{ message: string }>("/api/vehicles/fleet/trips/move", { body: { tripId: trip.id, to: to.id } });
      toast.success(r.message);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ActionButton onClick={go} disabled={busy}>
      Move {trip.label} to {to.name}
    </ActionButton>
  );
}

/** "Let them know" on a clash or heads-up: sends the person who booked the notice below
 *  (SPEC 7.3), only when tapped, through the Hub's booking notice. */
export function NotifyBookerButton({ bookingId, visitId, text }: { bookingId: string; visitId: string; text: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function go() {
    if (!window.confirm(`Send this to the person who booked (Slack, or email if they're not on Slack)?\n\n${text}`)) return;
    setBusy(true);
    try {
      const r = await fleetFetch<{ message: string; told: boolean }>("/api/vehicles/fleet/notices", { body: { bookingId, visitId } });
      (r.told ? toast.success : toast.message)(r.message);
      setDone(r.told);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ActionButton onClick={go} disabled={busy || done}>
      {done ? "Told" : "Let them know"}
    </ActionButton>
  );
}

/** Fleet 5c: On hold / Resume / Cancel for a booking whose vehicle is out of action. */
export function OutOfActionButton({
  action,
  bookingId,
  label,
  confirm,
}: {
  action: "hold" | "resume" | "cancel";
  bookingId: string;
  label: string;
  confirm: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!window.confirm(confirm)) return;
    setBusy(true);
    try {
      const r = await fleetFetch<{ message: string; told: boolean }>("/api/vehicles/fleet/out-of-action", { body: { action, bookingId } });
      toast.success(r.message);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ActionButton onClick={go} disabled={busy}>
      {label}
    </ActionButton>
  );
}

/** Fleet 5c: mark a vehicle in for a repair, broken down, or back in service. The Hub
 *  marks it maintenance while it's out, and active again when it's back (migration 357). */
export function VehicleOutButtons({ vehicleId, vehicleName, status, today }: { vehicleId: string; vehicleName: string; status: string | null | undefined; today: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const out = status === "In workshop" || status === "Off the road";
  async function set(next: string, ask: string, done: string) {
    if (!window.confirm(ask)) return;
    setBusy(true);
    try {
      await fleetFetch(`/api/vehicles/fleet/vehicles/${vehicleId}`, { method: "PATCH", body: { patch: { status: next, statusSince: today } } });
      toast.success(done);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (out)
    return (
      <ActionButton disabled={busy} onClick={() => set("In service", `Mark ${vehicleName} back in service? It can be booked again from today.`, `${vehicleName} is back in service.`)}>
        Back in service
      </ActionButton>
    );
  if (status === "For sale") return null;
  return (
    <span className="flex flex-wrap gap-2">
      <ActionButton
        disabled={busy}
        onClick={() => set("In workshop", `Mark ${vehicleName} in for a repair? It can't be booked until you mark it back in service, and its bookings for the next 10 days are listed so you can sort them out.`, `${vehicleName} is in for a repair.`)}
      >
        In for a repair
      </ActionButton>
      <ActionButton
        disabled={busy}
        onClick={() => set("Off the road", `Mark ${vehicleName} as broken down? It can't be booked until you mark it back in service, and its bookings for the next 10 days are listed so you can sort them out.`, `${vehicleName} is marked broken down.`)}
      >
        Broken down
      </ActionButton>
    </span>
  );
}
