"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtDate, fmtKm } from "@/lib/fleet/rules/format";
import { ActionButton, Plate } from "./ui";
import { fleetFetch, minsSince } from "./client-api";

export interface KmVehicle {
  id: string;
  name: string;
  reg?: string | null;
  odometer?: number | null;
  odometerDate?: string | null;
}

const lastLine = (v?: KmVehicle) =>
  v && v.odometer != null
    ? "Last recorded: " + fmtKm(v.odometer) + (v.odometerDate ? " on " + fmtDate(v.odometerDate) : "")
    : "No reading recorded yet";

const field = "min-h-11 w-full border border-rule-strong bg-white px-3 py-2 text-[15px] focus:border-ink focus:outline-none";

/** "Log a km reading" (the Fleet app's kmModal). Pass `vehicle` to fix the vehicle, or
 *  `vehicles` to let the person choose. */
export function KmDialog({
  open,
  onOpenChange,
  vehicle,
  vehicles,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicle?: KmVehicle;
  vehicles?: KmVehicle[];
  today: string;
}) {
  const router = useRouter();
  const [vid, setVid] = useState("");
  const [km, setKm] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const v = vehicle || vehicles?.find((x) => x.id === vid);

  function change(o: boolean) {
    if (o) {
      setVid("");
      setKm("");
      setDate(today);
      setNote("");
      setOpenedAt(Date.now());
    }
    onOpenChange(o);
  }

  async function save() {
    if (!v) return toast.error("Choose the vehicle.");
    const n = Number(km.replace(/\D/g, ""));
    if (!(n > 0)) return toast.error("Enter the odometer reading in km.");
    if (v.odometer != null && n < v.odometer && !window.confirm(`${fmtKm(n)} is lower than the last recorded ${fmtKm(v.odometer)}. Save it anyway?`)) return;
    setSaving(true);
    try {
      const r = await fleetFetch<{ message: string; sev: string | null }>(`/api/vehicles/fleet/vehicles/${v.id}/km`, {
        body: { km: n, date, note, mins: minsSince(openedAt) },
      });
      if (r.sev === "crit") toast.error(r.message);
      else toast.success(r.message);
      onOpenChange(false);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Log a km reading</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          {vehicle ? (
            <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
              {vehicle.name} <Plate reg={vehicle.reg} />
            </p>
          ) : (
            <label className="grid gap-1.5">
              <span className="mono-label">Vehicle</span>
              <select className={field} value={vid} onChange={(e) => setVid(e.target.value)}>
                <option value="">Choose the vehicle</option>
                {(vehicles || []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                    {x.reg ? " · " + x.reg : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="grid gap-1.5">
            <span className="mono-label">Odometer (km)</span>
            <input className={field} type="text" inputMode="numeric" autoComplete="off" placeholder="e.g. 230150" value={km} onChange={(e) => setKm(e.target.value)} />
            <span className="text-[12px] text-[#55524A]">{v ? lastLine(v) : ""}</span>
          </label>
          <label className="grid gap-1.5">
            <span className="mono-label">Date</span>
            <input className={field} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="grid gap-1.5">
            <span className="mono-label">Note (optional)</span>
            <input className={field} type="text" placeholder="e.g. Handed back after HULC" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <p className="text-[12px] text-[#55524A]">
            Takes a few seconds: read the odometer on the dashboard when a vehicle goes out or comes back. Service and inspection warnings are worked out from the latest reading.
          </p>
        </div>
        <DialogFooter className="gap-2">
          <ActionButton onClick={() => change(false)}>Cancel</ActionButton>
          <ActionButton tone="solid" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
