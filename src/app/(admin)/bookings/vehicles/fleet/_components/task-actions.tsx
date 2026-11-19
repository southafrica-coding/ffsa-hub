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
    if (!window.confirm(`Move ${trip.label} (${fmtRange(trip.from, trip.to)}) to ${to.name}? Let the person who booked it know about the change of vehicle.`)) return;
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
