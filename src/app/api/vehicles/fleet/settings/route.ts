import { NextResponse } from "next/server";
import { bad, fleetAuth, isIsoDate, readJson } from "@/lib/fleet/api";
import { updateFleetSettings } from "@/services/fleet";

/* eslint-disable @typescript-eslint/no-explicit-any */

function validChecklist(c: any): string | null {
  if (!c || !Array.isArray(c.sections)) return "The checklist needs sections.";
  const ids = new Set<string>();
  for (const s of c.sections) {
    if (!s || typeof s.id !== "string" || typeof s.name !== "string" || !Array.isArray(s.items)) return "Every section needs an id, a name and points.";
    for (const it of s.items) {
      if (!it || typeof it.id !== "string" || typeof it.t !== "string" || !it.t.trim()) return "Every point needs wording.";
      if (ids.has(it.id)) return `Two points share the id ${it.id}.`;
      ids.add(it.id);
      if (it.in !== undefined && !Array.isArray(it.in)) return "A point's checks must be a list.";
    }
  }
  return null;
}

// PATCH /api/vehicles/fleet/settings — the checklist, inspection days, most per day,
// time budget, weekly-only weeks and reminder switches. Each given field replaces the
// stored one. Past inspections keep the wording they were saved with.
export async function PATCH(request: Request) {
  const auth = await fleetAuth("manage");
  if (!auth.ok) return auth.response;
  const b = await readJson<Record<string, any>>(request);
  if (!b) return bad("Expected JSON");

  const patch: Record<string, unknown> = {};
  if ("checklist" in b) {
    const e = validChecklist(b.checklist);
    if (e) return bad(e);
    patch.checklist = b.checklist;
  }
  if ("days" in b) {
    if (!Array.isArray(b.days) || !b.days.every((d: unknown) => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 7)) return bad("Inspection days are 1 (Monday) to 7 (Sunday).");
    patch.days = Array.from(new Set(b.days as number[])).sort();
  }
  if ("maxPerDay" in b) {
    if (!(Number.isInteger(b.maxPerDay) && b.maxPerDay >= 1 && b.maxPerDay <= 10)) return bad("Most per day must be 1 to 10.");
    patch.max_per_day = b.maxPerDay;
  }
  if ("budgetHours" in b) {
    if (!(Number(b.budgetHours) > 0 && Number(b.budgetHours) <= 40)) return bad("The time budget must be between 0 and 40 hours.");
    patch.budget_hours = Number(b.budgetHours);
  }
  if ("weeklyOnly" in b) {
    if (!Array.isArray(b.weeklyOnly) || !b.weeklyOnly.every(isIsoDate)) return bad("Weekly-only weeks must be dates.");
    patch.weekly_only = b.weeklyOnly;
  }
  if ("notify" in b) {
    patch.notify = { email: !!b.notify?.email, slack: !!b.notify?.slack };
  }
  if (!Object.keys(patch).length) return bad("Nothing to change");
  patch.updated_by = auth.user.id;

  const { data, error } = await updateFleetSettings(auth.supabase, patch);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, settings: data });
}
