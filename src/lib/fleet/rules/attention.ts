// "Keep an eye on": damage, recent repairs and points marked Monitor or Fix now (SPEC 6.8).
// Reference: KEYMAP, guessItems, attentionFor, attentionByItem in
// vehicles-module/app/ffsa-fleet.html.

import { REPAIR_KINDS, STATUS } from "./constants";
import { checklistIndex } from "./checklist";
import { addDays, has } from "./format";
import type { Checklist, FleetVehicle, ISODate, WorkshopVisit } from "./types";

const KEYMAP: [RegExp, string[]][] = [
  [/front bumper|grille/i, ["ext-front"]],
  [/rear bumper/i, ["ext-rear"]],
  [/bonnet/i, ["ext-bonnet"]],
  [/sliding door/i, ["ext-slide"]],
  [/tailgate|boot/i, ["ext-tail"]],
  [/roof lining|sun visor|\btrim\b/i, ["cab-trim"]],
  [/seat cover|upholst|stain|\btear/i, ["cab-upholst"]],
  [/\bseats?\b/i, ["cab-seats"]],
  [/windscreen|windshield/i, ["gls-wind"]],
  [/mirror/i, ["gls-mirrors"]],
  [/headlight/i, ["lgt-lens"]],
  [/tyre|tire/i, ["pre-tyres"]],
  [/brake/i, ["drv-brakes"]],
  [/suspension|shock/i, ["drv-noise", "drv-steer"]],
  [/aircon|air con|a\/c/i, ["cab-ac"]],
  [/radio/i, ["cab-radio"]],
  [/battery/i, ["eng-batt"]],
  [/\bkeys?\b/i, ["pst-keys"]],
  [/head gasket|coolant|overheat/i, ["eng-cool", "eng-oil", "drv-smoke"]],
  [/door hinge/i, ["ext-left", "ext-right"]],
  [/\bleft\b/i, ["ext-left"]],
  [/\bright\b/i, ["ext-right"]],
  [/floor/i, ["cab-mats"]],
  [/emergency equipment/i, ["saf-triangle", "saf-firstaid", "saf-extinguisher"]],
  [/rust/i, ["ext-rust"]],
  [/paint|respray|polish|touch-?up|scratch|dent|moulding/i, ["ext-walk"]],
];

export function guessItems(t?: string | null): string[] {
  const out: string[] = [];
  for (const [re, ids] of KEYMAP)
    if (re.test(t || ""))
      ids.forEach((i) => {
        if (!out.includes(i)) out.push(i);
      });
  return out;
}

export interface AttentionItem {
  t: string;
  k: string;
  d: ISODate | "";
  items: string[];
  src: "watch" | "record" | "flag";
  idx?: number;
}

/** visits: this vehicle's workshop visits, or undefined while they haven't loaded
 *  (the app then leaves out recent repairs). */
export function attentionFor(
  cl: Checklist,
  v: FleetVehicle | null | undefined,
  today: ISODate,
  visits?: WorkshopVisit[]
): AttentionItem[] {
  if (!v) return [];
  const out: AttentionItem[] = [];
  const ix = checklistIndex(cl);
  (v.watch || []).forEach((w, idx) =>
    out.push({ t: w.t, k: w.k || "issue", d: w.d || "", items: w.i ? [w.i] : guessItems(w.t), src: "watch", idx })
  );
  if (visits) {
    const since = addDays(today, -183);
    visits
      .filter((r) => r.vehicleId === v.id && r.status !== "booked" && (r.date || "") >= since && REPAIR_KINDS.includes(r.kind || ""))
      .forEach((r) => {
        const what = (r.work || []).map((w) => w.d).filter(has).join("; ") || r.description || r.kind || "";
        const t = `${r.kind}${r.provider ? " at " + r.provider : ""}: ${what}`;
        out.push({ t, k: "repair", d: r.date || "", items: guessItems(what + " " + (r.description || "")), src: "record" });
      });
  }
  for (const [id, c] of Object.entries(v.condition || {})) {
    if (!c || !ix[id] || (c.s !== "fix" && c.s !== "mon")) continue;
    out.push({ t: `${ix[id].t}: marked ${STATUS[c.s]}${c.n ? " (" + c.n + ")" : ""}`, k: c.s, d: c.d || "", items: [id], src: "flag" });
  }
  return out.sort((a, b) => (b.d || "").localeCompare(a.d || ""));
}

export function attentionByItem(cl: Checklist, v: FleetVehicle, today: ISODate, visits?: WorkshopVisit[]) {
  const m: Record<string, AttentionItem[]> = {};
  attentionFor(cl, v, today, visits).forEach((a) =>
    a.items.forEach((id) => {
      if (a.src === "flag") return;
      (m[id] = m[id] || []).push(a);
    })
  );
  return m;
}
