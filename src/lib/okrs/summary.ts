// Roll-ups for the OKR wall.
//
// The wall renders every group's objectives for a cycle in one shot, so the
// counts are reduced in JS from the rows already fetched rather than asked for
// separately. RLS has already decided what is in that array, so the totals a
// viewer sees are the totals they are allowed to see.
//
// A "group" is a staff ministry OR an OKR-only team (The Watchmen, Hope Again,
// and the others that write OKRs without being ministries). The wall treats
// them identically — only edit rights tell them apart.

import { emptyStatusCounts } from "./progress";
import type { OkrOwner, OkrOwnerSummary, OkrObjective, OkrStatus } from "@/types/okrs";

export interface WallTotals {
  objectives: number;
  keyResults: number;
  byStatus: Record<OkrStatus, number>;
}

/** The id an objective is grouped under, whichever kind of owner it has. */
export function ownerIdOf(objective: OkrObjective): string | null {
  return objective.staff_ministry_id ?? objective.okr_team_id ?? null;
}

export function toOwners(
  ministries: { id: string; name: string; slug: string }[],
  teams: { id: string; name: string; slug: string }[]
): OkrOwner[] {
  return [
    ...ministries.map((m) => ({ ...m, kind: "ministry" as const })),
    ...teams.map((t) => ({ ...t, kind: "team" as const })),
  ];
}

export function summariseByOwner(
  objectives: OkrObjective[],
  owners: OkrOwner[]
): OkrOwnerSummary[] {
  const byId = new Map<string, OkrOwnerSummary>();
  for (const o of owners) {
    byId.set(o.id, { ...o, objectives: 0, keyResults: 0, byStatus: emptyStatusCounts() });
  }

  for (const objective of objectives) {
    const id = ownerIdOf(objective);
    const row = id ? byId.get(id) : undefined;
    // A ministry retired after its OKRs were written still has rows; skip
    // rather than invent a nameless card for it.
    if (!row) continue;
    row.objectives += 1;
    for (const kr of objective.okr_key_results ?? []) {
      row.keyResults += 1;
      row.byStatus[kr.current_status] += 1;
    }
  }

  // Every group is returned, including ones with nothing written yet, so the
  // wall can double as a to-do list for leaders. Started groups sort first;
  // the caller renders the rest under their own heading and is responsible for
  // labelling them "not started" rather than letting an empty card imply the
  // ministry has no OKRs at all.
  return [...byId.values()].sort(
    (a, b) => Number(b.objectives > 0) - Number(a.objectives > 0) || a.name.localeCompare(b.name)
  );
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
