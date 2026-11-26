// Vehicle profiles, "Where things are" and the in-car guide's printed status (SPEC 6.9).
// Reference: profileOf, whereList, hashStr, cardSig, cardStatus in
// vehicles-module/app/ffsa-fleet.html. cardSig must stay byte-for-byte the same as the app's,
// or every guide printed from the app shows as out of date after the move.

import profiles from "../content/vehicle-profiles.json";
import { CARDVER } from "./constants";
import { addDays, fmtDate, has } from "./format";
import type { FleetVehicle, ISODate, Notify } from "./types";

export interface Profile {
  name: string;
  fuel: string;
  where: [string, string][];
  weak: [string, string][];
  item: Record<string, string>;
  na: string[];
}
const PROFILES = profiles as unknown as Record<string, Profile>;

export function profileOf(v?: FleetVehicle | null): Profile | null {
  if (!v) return null;
  if (v.profile && PROFILES[v.profile]) return PROFILES[v.profile];
  const m = ((v.make || "") + " " + (v.model || "")).toLowerCase();
  if (m.includes("hyundai")) return PROFILES.h1;
  if (m.includes("volkswagen") || m.includes("vw ") || m.includes("kombi") || m.includes("transporter")) return PROFILES.t5;
  if (m.includes("honda")) return PROFILES.crv;
  if (m.includes("nissan")) return PROFILES.almera;
  return null;
}

export function whereList(v: FleetVehicle): [string, string][] {
  const pr = profileOf(v);
  const out: [string, string][] = (pr ? pr.where : []).map((x) => [x[0], x[1]]);
  if (!pr && v.fuel) out.push(["Fuel", v.fuel.toUpperCase() + " only."]);
  const put = (k: string, t: string) => {
    const i = out.findIndex((x) => x[0].toLowerCase() === k.toLowerCase());
    if (i >= 0) out[i] = [out[i][0], t];
    else out.push([k, t]);
  };
  if (v.tyres) {
    const i = out.findIndex((x) => x[0] === "Tyre pressures");
    put("Tyre pressures", v.tyres + (i >= 0 ? ". " + out[i][1] : ""));
  }
  String(v.where || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(has)
    .forEach((line) => {
      const m = line.match(/^([^:]{2,40}):\s*(.+)$/);
      if (m) put(m[1].trim(), m[2].trim());
      else put("Note", line);
    });
  put(
    "Papers",
    "The licence disc is on the windscreen. The registration papers and insurance documents are kept in the legal office: for a trip outside South Africa, collect them first."
  );
  return out;
}

export function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** The co-ordinator printed on the guide. In the Hub: the Vehicle Co-ordinator role holder. */
export const coordOf = (n?: Notify | null) => ({ name: (n && n.coordName) || "", phone: (n && n.coordPhone) || "" });

export function cardSig(v: FleetVehicle, notify?: Notify | null): string {
  const pr = profileOf(v);
  const c = coordOf(notify);
  const base: unknown[] = [CARDVER, v.name, v.reg, (pr && pr.fuel) || v.fuel || "", whereList(v)];
  if (c.name || c.phone) base.push(c.name, c.phone);
  return hashStr(JSON.stringify(base));
}

export type CardState = "none" | "stale" | "old" | "ok";
export function cardStatus(v: FleetVehicle, notify: Notify | null | undefined, today: ISODate): { st: CardState; text: string } {
  const cp = v.cardPrinted;
  if (!cp || !cp.date) return { st: "none", text: "Not printed yet" };
  const due = addDays(cp.date, 182);
  if (cp.sig !== cardSig(v, notify) || cp.stale)
    return { st: "stale", text: `Printed ${fmtDate(cp.date)}, but this vehicle’s details have changed since: print a new one` };
  if (due <= today) return { st: "old", text: `Printed ${fmtDate(cp.date)}: 6 months old, print a new one` };
  return { st: "ok", text: `Printed ${fmtDate(cp.date)} · replace by ${fmtDate(due)}` };
}

/** Vehicles whose printed guide no longer matches (e.g. after the co-ordinator changed):
 *  the app marks these `cardPrinted.stale = true` (markStaleCards). */
export function staleCards(vehicles: FleetVehicle[], notify?: Notify | null): FleetVehicle[] {
  return vehicles.filter((v) => {
    const cp = v.cardPrinted;
    return !!(cp && cp.date && !cp.stale && cp.sig !== cardSig(v, notify));
  });
}
