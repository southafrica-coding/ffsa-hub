"use client";

// Edit vehicle details (the Fleet app's vehicleModal / saveVehicle). Registration, fuel
// and seats live on the Hub's vehicle list (Settings), so they are shown, not edited here.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtKm } from "@/lib/fleet/rules/format";
import { ActionButton, FLEET } from "../_components/ui";
import { fleetFetch, minsSince } from "../_components/client-api";
import { F, Fieldset, field, grid2 } from "./form-bits";
import { vehiclePatch, type VehicleForm } from "./vehicle-form";

export interface EditableVehicle extends VehicleForm {
  id: string;
  /** Shown in the title only: the name is edited on the Hub's vehicle list. */
  name: string;
  reg: string;
  fuel: string;
  seats: string;
  /** Kept when the service dates are edited (saveVehicle). */
  lastServiceProvider: string;
  lastB2BProvider: string;
}

type Fld = [keyof VehicleForm, string, { ph?: string; hint?: string; num?: boolean; date?: boolean; opts?: string[]; area?: boolean }?];

const GROUPS = (statuses: string[]): [string, Fld[]][] => [
  ["Identity", [["status", "Status", { opts: statuses }], ["base", "Based at / allocated to"]]],
  [
    "Vehicle",
    [
      ["make", "Make"],
      ["model", "Model"],
      ["year", "Year", { num: true }],
      ["colour", "Colour"],
      ["transmission", "Gearbox", { opts: ["", "Manual", "Automatic"] }],
      ["vin", "VIN (chassis number)"],
      ["engineNo", "Engine number"],
    ],
  ],
  [
    "Dates & service",
    [
      ["odometer", "Odometer (km)", { num: true }],
      ["licenceExpiry", "Licence disc expiry", { date: true }],
      ["lastServiceDate", "Last service date", { date: true }],
      ["lastServiceKm", "Last service odometer (km)", { num: true }],
      ["lastB2BDate", "Last bumper-to-bumper inspection date", { date: true }],
      ["lastB2BKm", "Last bumper-to-bumper odometer (km)", { num: true }],
      ["serviceKm", "Service every (km)", { num: true, hint: "Leave empty for the FFSA rule: every 10 000 km" }],
      ["serviceMonths", "Service every (months)", { num: true }],
    ],
  ],
  ["Insurance & tracking", [["insurer", "Insurer"], ["policyNo", "Policy number"], ["tracker", "Tracking company"]]],
  [
    "On this vehicle",
    [
      ["tyres", "Tyre pressures", { ph: "e.g. Front 2.4 bar, rear 2.8 bar (full load 3.0)", hint: "From the sticker on the door frame or inside the fuel flap" }],
      [
        "where",
        "Where things are",
        {
          area: true,
          ph: "One per line, e.g.\nJack and wheel spanner: under the front passenger seat",
          hint: "Adds to or corrects the standard list for this model. It appears in the in-car guide and the manual.",
        },
      ],
    ],
  ],
];

export function EditDetailsButton({ vehicle, statuses, today, label = "Edit details", link }: { vehicle: EditableVehicle; statuses: string[]; today: string; label?: string; link?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {link ? (
        <button type="button" className="min-h-11 underline" onClick={() => setOpen(true)}>
          {label}
        </button>
      ) : (
        <ActionButton onClick={() => setOpen(true)}>{label}</ActionButton>
      )}
      {open && <VehicleDialog vehicle={vehicle} statuses={statuses} today={today} onClose={() => setOpen(false)} />}
    </>
  );
}

function VehicleDialog({ vehicle, statuses, today, onClose }: { vehicle: EditableVehicle; statuses: string[]; today: string; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState<VehicleForm>(() => ({ ...vehicle }));
  const [openedAt] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);

  async function save() {
    const out = vehiclePatch(vehicle, f, today);
    if ("error" in out) return toast.error(out.error);
    const prevKm = vehicle.odometer ? Number(vehicle.odometer) : null;
    if (out.odometer !== null && prevKm !== null && out.odometer < prevKm && !window.confirm(`${fmtKm(out.odometer)} is lower than the last recorded ${fmtKm(prevKm)}. Save it anyway?`))
      return;
    setSaving(true);
    try {
      await fleetFetch(`/api/vehicles/fleet/vehicles/${vehicle.id}`, { method: "PATCH", body: { patch: out.patch } });
      // The odometer moves through its own route, so the reading is kept in the history.
      if (out.odometer !== null) await fleetFetch(`/api/vehicles/fleet/vehicles/${vehicle.id}/km`, { body: { km: out.odometer, date: today, mins: minsSince(openedAt) } });
      toast.success("Details saved.");
      onClose();
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {vehicle.name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5">
          {GROUPS(statuses).map(([g, fs]) => (
            <Fieldset key={g} legend={g}>
              {g === "Identity" && (
                <p className="text-[12px] text-[#55524A]">
                  Registration {vehicle.reg || "not captured"} · {vehicle.fuel || "fuel not set"} · {vehicle.seats ? vehicle.seats + " seats" : "seats not set"}. These are changed
                  in <Link href={`${FLEET}/settings`} className="underline">Settings</Link>.
                </p>
              )}
              <div className={grid2}>
                {fs.map(([k, label, o = {}]) => (
                  <F key={k} label={label} hint={o.hint} wide={o.area}>
                    {o.area ? (
                      <textarea className={field} rows={4} placeholder={o.ph} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
                    ) : o.opts ? (
                      <select className={field} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
                        {o.opts.map((x) => (
                          <option key={x} value={x}>
                            {x || "Not set"}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className={field}
                        type={o.date ? "date" : "text"}
                        inputMode={o.num ? "numeric" : undefined}
                        placeholder={o.ph}
                        value={f[k]}
                        onChange={(e) => setF({ ...f, [k]: e.target.value })}
                      />
                    )}
                  </F>
                ))}
              </div>
            </Fieldset>
          ))}
          <Fieldset legend="Notes">
            <F label="Anything the next person should know">
              <textarea className={field} rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            </F>
          </Fieldset>
        </div>
        <DialogFooter className="gap-2">
          <ActionButton onClick={onClose}>Cancel</ActionButton>
          <ActionButton tone="solid" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
