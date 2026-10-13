// "Not arrived yet": people on a school roster as waiting_for_arrival who
// aren't marked arrived on any school. Shared by the Users page and the
// Slack links page, which both need to tell "on base" from "coming later".

import {
  listArrivalEnrollments,
  listCourseStartDates,
} from "@/services/schools";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type AwaitingArrival = { school: string; startsOn: string | null };

/** user_id → the soonest school they're accepted to but haven't arrived at.
 *  Pass a service-role client: this is a cross-user report. */
export async function getAwaitingArrivalByUser(
  admin: Client
): Promise<Record<string, AwaitingArrival>> {
  const [{ data: enrollments }, { data: courseStarts }] = await Promise.all([
    listArrivalEnrollments(admin),
    listCourseStartDates(admin),
  ]);

  const programStart = new Map<string, string>();
  for (const c of (courseStarts ?? []) as Array<{ program_id: string; start_date: string }>) {
    const prev = programStart.get(c.program_id);
    if (!prev || c.start_date < prev) programStart.set(c.program_id, c.start_date);
  }

  // Anyone arrived on some school is on base, so they don't count.
  const arrived = new Set<string>();
  const out: Record<string, AwaitingArrival> = {};
  for (const e of (enrollments ?? []) as Array<{
    user_id: string | null;
    status: string;
    program_id: string;
    programs: { name?: string | null } | { name?: string | null }[] | null;
  }>) {
    if (!e.user_id) continue;
    if (e.status === "arrived") {
      arrived.add(e.user_id);
      continue;
    }
    const program = Array.isArray(e.programs) ? e.programs[0] : e.programs;
    const startsOn = programStart.get(e.program_id) ?? null;
    const current = out[e.user_id];
    // Several upcoming schools → keep the soonest.
    if (!current || (startsOn && (!current.startsOn || startsOn < current.startsOn))) {
      out[e.user_id] = { school: program?.name?.trim() || "a school", startsOn };
    }
  }
  for (const id of arrived) delete out[id];
  return out;
}
