import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getSchoolsCountScopes,
  type CountLevel,
} from "@/lib/auth/schools-count-scopes";

// Dashboard tile: per-program application + acceptance + enrolment counts,
// scoped to the programs the caller has permission on. The caller's permission
// LEVEL decides how much they get back — "manage" callers also receive the
// per-status `breakdown`; "view" callers never do (so lower-level users can't
// infer detail from the payload).

// Enrolments that count as "took up the place": everyone who arrived or is due
// to, excluding those who never showed (dismissed) or left (decided_to_leave).
const ENROLLED_STATUSES = ["waiting_for_arrival", "arrived", "graduated"];

type ProgramCount = {
  programId: string;
  name: string;
  code: string;
  applications: number;
  accepted: number;
  enrolled: number;
  level: CountLevel;
  breakdown?: Record<string, number>;
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { globalLevel, programLevels } = await getSchoolsCountScopes(
    supabase,
    authUser.id
  );

  // No schools visibility at all → empty payload; the card self-hides.
  if (!globalLevel && Object.keys(programLevels).length === 0) {
    return NextResponse.json({ programs: [], global: false });
  }

  const adminSupabase = createAdminClient();

  // Resolve the set of in-scope programs (+ each one's effective level).
  const { data: programRows } = await adminSupabase
    .from("programs")
    .select("id, name, code")
    .eq("status", "active");

  const levelFor = (programId: string): CountLevel | null => {
    const scoped = programLevels[programId];
    if (globalLevel && scoped) return globalLevel === "manage" || scoped === "manage" ? "manage" : "view";
    if (globalLevel) return globalLevel;
    return scoped ?? null;
  };

  const scoped = (programRows ?? [])
    .map((p) => ({ ...p, level: levelFor(p.id) }))
    .filter((p): p is { id: string; name: string; code: string; level: CountLevel } => p.level !== null);

  if (scoped.length === 0) {
    return NextResponse.json({ programs: [], global: !!globalLevel });
  }

  const programIds = scoped.map((p) => p.id);

  const [appsResult, enrollResult] = await Promise.all([
    adminSupabase
      .from("application_responses")
      .select("program_id, status")
      .in("program_id", programIds)
      .is("removed_at", null),
    adminSupabase
      .from("enrollments")
      .select("program_id, status")
      .in("program_id", programIds),
  ]);

  // Aggregate applications: total + accepted + full status breakdown per program.
  const appAgg = new Map<string, { total: number; accepted: number; breakdown: Record<string, number> }>();
  for (const row of (appsResult.data as Array<{ program_id: string; status: string }> | null) ?? []) {
    const a = appAgg.get(row.program_id) ?? { total: 0, accepted: 0, breakdown: {} };
    a.total += 1;
    if (row.status === "accepted") a.accepted += 1;
    a.breakdown[row.status] = (a.breakdown[row.status] ?? 0) + 1;
    appAgg.set(row.program_id, a);
  }

  // Aggregate enrolments: those who took up the place.
  const enrollAgg = new Map<string, number>();
  for (const row of (enrollResult.data as Array<{ program_id: string; status: string }> | null) ?? []) {
    if (!ENROLLED_STATUSES.includes(row.status)) continue;
    enrollAgg.set(row.program_id, (enrollAgg.get(row.program_id) ?? 0) + 1);
  }

  const programs: ProgramCount[] = scoped.map((p) => {
    const a = appAgg.get(p.id);
    const row: ProgramCount = {
      programId: p.id,
      name: p.name,
      code: p.code,
      applications: a?.total ?? 0,
      accepted: a?.accepted ?? 0,
      enrolled: enrollAgg.get(p.id) ?? 0,
      level: p.level,
    };
    // Only managers see the per-status breakdown.
    if (p.level === "manage") row.breakdown = a?.breakdown ?? {};
    return row;
  });

  // Busiest programs first.
  programs.sort((x, y) => y.applications - x.applications);

  return NextResponse.json({ programs, global: !!globalLevel });
}
