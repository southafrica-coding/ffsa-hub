import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getArrivingEnrollments } from "@/services/schools";
import { getArrivalInsuranceInfo } from "@/lib/schools/arrival-insurance";

export type ArrivalAlert = {
  userId: string;
  name: string;
  programId: string;
  programName: string;
  kind: "no_profile" | "insurance_missing" | "insurance_expired";
};

// Arriving students (waiting_for_arrival / arrived) who either have no profile
// yet or whose health insurance is missing/expired — scoped to the programs the
// viewer can see. The RLS-scoped getArrivingEnrollments IS the permission check:
// a user without schools access gets no rows, hence no alerts.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: enrollments } = await getArrivingEnrollments(supabase);
  if (!enrollments || enrollments.length === 0) {
    return NextResponse.json({ alerts: [] });
  }

  // Identity + PII fields on users are RLS-nulled for non-admins, so hydrate
  // via the service-role client. Only what the widget shows leaves the server.
  const admin = createAdminClient();
  const userIds = enrollments.map((e: { user_id: string }) => e.user_id);
  const programIds = Array.from(
    new Set(enrollments.map((e: { program_id: string }) => e.program_id))
  );

  const [arrival, { data: programs }, { data: users }] = await Promise.all([
    getArrivalInsuranceInfo(admin, userIds),
    admin.from("programs").select("id, name").in("id", programIds),
    admin
      .from("users")
      .select("id, first_name, last_name, preferred_name, email")
      .in("id", userIds),
  ]);

  const programName = new Map<string, string>(
    (programs ?? []).map((p: { id: string; name: string }) => [p.id, p.name])
  );
  const nameById = new Map<string, string>(
    (users ?? []).map(
      (u: {
        id: string;
        first_name: string | null;
        last_name: string | null;
        preferred_name: string | null;
        email: string | null;
      }) => [
        u.id,
        u.preferred_name ||
          [u.first_name, u.last_name].filter(Boolean).join(" ") ||
          u.email ||
          "Unknown",
      ]
    )
  );

  const alerts: ArrivalAlert[] = [];
  for (const e of enrollments) {
    const info = arrival[e.user_id];
    const base = {
      userId: e.user_id,
      name: nameById.get(e.user_id) ?? "Unknown",
      programId: e.program_id,
      programName: programName.get(e.program_id) ?? "School",
    };
    if (info?.profileStage === "invited") {
      alerts.push({ ...base, kind: "no_profile" });
      continue; // no profile → insurance is necessarily absent; one flag is enough
    }
    const state = info?.insurance.state;
    if (state === "missing") alerts.push({ ...base, kind: "insurance_missing" });
    else if (state === "expired") alerts.push({ ...base, kind: "insurance_expired" });
  }

  // No-profile first, then missing, then expired; alphabetical within each.
  const order: Record<ArrivalAlert["kind"], number> = {
    no_profile: 0,
    insurance_missing: 1,
    insurance_expired: 2,
  };
  alerts.sort(
    (a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name)
  );

  return NextResponse.json({ alerts });
}
