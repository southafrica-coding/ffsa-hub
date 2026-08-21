// Roll-ups for the OKR wall.
//
// The wall renders every ministry's objectives for a cycle in one shot, so the
// counts are reduced in JS from the rows already fetched rather than asked for
// separately. RLS has already decided what is in that array, so the totals a
// viewer sees are the totals they are allowed to see.

import { emptyStatusCounts } from "./progress";
import type { MinistryOkrSummary, OkrObjective, OkrStatus } from "@/types/okrs";

export interface WallTotals {
  objectives: number;
  keyResults: number;
  byStatus: Record<OkrStatus, number>;
}

export function summariseByMinistry(
  objectives: OkrObjective[],
  ministries: { id: string; name: string; slug: string }[]
): MinistryOkrSummary[] {
  const byId = new Map<string, MinistryOkrSummary>();
  for (const m of ministries) {
    byId.set(m.id, {
      staff_ministry_id: m.id,
      name: m.name,
      slug: m.slug,
      objectives: 0,
      keyResults: 0,
      byStatus: emptyStatusCounts(),
    });
  }

  for (const o of objectives) {
    const row = byId.get(o.staff_ministry_id);
    // A ministry that was retired after its OKRs were written still has rows;
    // skip rather than invent a nameless card for it.
    if (!row) continue;
    row.objectives += 1;
    for (const kr of o.okr_key_results ?? []) {
      row.keyResults += 1;
      row.byStatus[kr.current_status] += 1;
    }
  }

  // Ministries with nothing written for this cycle are dropped — an empty card
  // reads as "this ministry has no OKRs" when the truth is "not yet entered".
  return [...byId.values()]
    .filter((r) => r.objectives > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function totals(objectives: OkrObjective[]): WallTotals {
  const byStatus = emptyStatusCounts();
  let keyResults = 0;
  for (const o of objectives) {
    for (const kr of o.okr_key_results ?? []) {
      keyResults += 1;
      byStatus[kr.current_status] += 1;
    }
  }
  return { objectives: objectives.length, keyResults, byStatus };
}
