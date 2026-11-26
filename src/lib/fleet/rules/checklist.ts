// Which points belong to which check, and a vehicle's condition counts.
// Reference: inType, IX, itemsFor, condCounts in vehicles-module/app/ffsa-fleet.html.

import type { Checklist, ChecklistItem, FleetVehicle } from "./types";

export type IndexedItem = ChecklistItem & { sec: string; secName: string };

/** A monthly check covers the weekly points plus the once-a-month points. */
export const inType = (it: { in?: string[] } | undefined, type: string): boolean => {
  const i = (it && it.in) || [];
  return type === "monthly" ? i.includes("weekly") || i.includes("monthly") : i.includes(type);
};

const cache = new WeakMap<Checklist, { ix: Record<string, IndexedItem>; order: string[] }>();
function build(cl: Checklist) {
  let c = cache.get(cl);
  if (!c) {
    const ix: Record<string, IndexedItem> = {};
    const order: string[] = [];
    for (const sec of cl.sections || [])
      for (const it of sec.items || []) {
        ix[it.id] = Object.assign({}, it, { sec: sec.id, secName: sec.name });
        order.push(it.id);
      }
    c = { ix, order };
    cache.set(cl, c);
  }
  return c;
}

export const checklistIndex = (cl: Checklist) => build(cl).ix;
export const checklistOrder = (cl: Checklist) => build(cl).order;
export function itemsFor(cl: Checklist, type: string): string[] {
  const { ix, order } = build(cl);
  return order.filter((id) => inType(ix[id], type));
}
export const totalPoints = (cl: Checklist) => build(cl).order.length;

export function condCounts(cl: Checklist, v: FleetVehicle) {
  const { ix, order } = build(cl);
  const c = { ok: 0, mon: 0, fix: 0, na: 0, checked: 0, total: order.length, unchecked: 0 };
  const cond = v.condition || {};
  for (const id in cond) {
    if (!ix[id]) continue;
    const s = cond[id] && cond[id].s;
    if (s === "ok" || s === "mon" || s === "fix" || s === "na") {
      c[s]++;
      c.checked++;
    }
  }
  c.unchecked = c.total - c.checked;
  return c;
}
