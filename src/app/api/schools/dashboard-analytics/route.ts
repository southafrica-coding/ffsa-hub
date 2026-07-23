import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSchoolsCountScopes } from "@/lib/auth/schools-count-scopes";
import {
  getApplicationStatusRows,
  getEnrollmentStatusRows,
  getScopedPrograms,
  type ApplicationRow,
  type EnrollmentRow,
} from "@/services/schools-analytics";

// Serves BOTH dashboard schools widgets (counts + pipeline) from one
// aggregation pass, so the two never double-query the same tables.
//
// This is the server-side half of the two-layer permission model: whatever a
// user's saved layout claims, they get data for exactly the programs
// `getSchoolsCountScopes` grants them, at the detail level it grants.

// Enrolment lifecycle (migration 032). "Enrolled" means on the roster now or
// finished — students who left are not enrolled, but they DID arrive.
const ENROLLED_STATUSES = ["waiting_for_arrival", "arrived", "graduated"];
const ARRIVED_STATUSES = ["arrived", "graduated"];

// Applications still moving through the pipeline — no decision taken yet.
const IN_FLIGHT_STATUSES = [
  "submitted",
  "waiting_for_references",
  "references_received",
  "interview_scheduled",
];

type ProgramRow = { id: string; name: string; code: string };

function emptyTally() {
  return {
    applications: 0,
    accepted: 0,
    rejected: 0,
    waitlisted: 0,
    cancelled: 0,
    inFlight: 0,
    enrolled: 0,
    arrived: 0,
    byStatus: {} as Record<string, number>,
  };
}

type Tally = ReturnType<typeof emptyTally>;

// accepted / (accepted + rejected) — decided applications only. Dividing by
// total would drag the rate down every time a new intake opens and the pile
// of undecided applications grows, which reads as "we got pickier" when
// nothing changed.
function acceptanceRate(t: Tally): number | null {
  const decided = t.accepted + t.rejected;
  return decided > 0 ? Math.round((t.accepted / decided) * 100) : null;
}

// arrived / accepted — how many accepted students actually turned up.
function arrivalRate(t: Tally): number | null {
  return t.accepted > 0 ? Math.round((t.arrived / t.accepted) * 100) : null;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { globalLevel, programLevels } = await getSchoolsCountScopes(
    supabase,
    user.id
  );

  const scopedIds = Object.keys(programLevels);
  if (globalLevel === null && scopedIds.length === 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: programs, error: programsError } = await getScopedPrograms(
    supabase,
    globalLevel !== null ? null : scopedIds
  );
  if (programsError) {
    return NextResponse.json({ error: programsError.message }, { status: 500 });
  }

  const programRows = (programs ?? []) as ProgramRow[];
  const programIds = programRows.map((p) => p.id);

  if (programIds.length === 0) {
    return NextResponse.json({
      programs: [],
      totals: null,
      canSeeAll: globalLevel !== null,
    });
  }

  const [appsResult, enrolResult] = await Promise.all([
    getApplicationStatusRows(supabase, programIds),
    getEnrollmentStatusRows(supabase, programIds),
  ]);
  if (appsResult.error) {
    return NextResponse.json({ error: appsResult.error.message }, { status: 500 });
  }
  if (enrolResult.error) {
    return NextResponse.json({ error: enrolResult.error.message }, { status: 500 });
  }

  const tallies = new Map<string, Tally>(
    programIds.map((id) => [id, emptyTally()])
  );

  for (const row of appsResult.data as ApplicationRow[]) {
    const t = tallies.get(row.program_id);
    if (!t) continue;
    t.applications++;
    t.byStatus[row.status] = (t.byStatus[row.status] ?? 0) + 1;
    if (row.status === "accepted") t.accepted++;
    else if (row.status === "rejected") t.rejected++;
    else if (row.status === "waitlisted") t.waitlisted++;
    else if (row.status === "cancelled") t.cancelled++;
    if (IN_FLIGHT_STATUSES.includes(row.status)) t.inFlight++;
  }

  for (const row of enrolResult.data as EnrollmentRow[]) {
    const t = tallies.get(row.program_id);
    if (!t) continue;
    if (ENROLLED_STATUSES.includes(row.status)) t.enrolled++;
    if (ARRIVED_STATUSES.includes(row.status)) t.arrived++;
  }

  const payload = programRows.map((program) => {
    const t = tallies.get(program.id) ?? emptyTally();
    // "view"-level grants see headcounts only; the per-status breakdown is a
    // management view, so it is omitted from the payload entirely rather than
    // hidden in the UI.
    const level = globalLevel ?? programLevels[program.id] ?? "view";
    return {
      id: program.id,
      name: program.name,
      code: program.code,
      applications: t.applications,
      accepted: t.accepted,
      enrolled: t.enrolled,
      arrived: t.arrived,
      inFlight: t.inFlight,
      acceptanceRate: acceptanceRate(t),
      arrivalRate: arrivalRate(t),
      byStatus: level === "manage" ? t.byStatus : null,
    };
  });

  // Aggregate strip, for viewers who can see every program. Rates are
  // recomputed from summed counts — averaging per-program percentages would
  // weight a 3-applicant school the same as a 300-applicant one.
  const combined = emptyTally();
  for (const t of tallies.values()) {
    combined.applications += t.applications;
    combined.accepted += t.accepted;
    combined.rejected += t.rejected;
    combined.inFlight += t.inFlight;
    combined.enrolled += t.enrolled;
    combined.arrived += t.arrived;
  }

  return NextResponse.json({
    programs: payload,
    totals:
      globalLevel !== null
        ? {
            applications: combined.applications,
            accepted: combined.accepted,
            enrolled: combined.enrolled,
            arrived: combined.arrived,
            inFlight: combined.inFlight,
            acceptanceRate: acceptanceRate(combined),
            arrivalRate: arrivalRate(combined),
          }
        : null,
    canSeeAll: globalLevel !== null,
  });
}
