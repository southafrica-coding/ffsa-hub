import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUsers } from "@/services/users";
import { listMinistries, listActiveMinistryMemberships } from "@/services/ministries";
import {
  listActiveEnrollmentSchools,
  listArrivalEnrollments,
  listCourseStartDates,
} from "@/services/schools";
import { strongestMinistryRole, type MinistryRole } from "@/lib/users/derive-title";
import { getAuthSignIns } from "@/lib/users/auth-signins";
import { getAccountFlags } from "@/lib/users/account-flags";
import { UsersTable } from "./users-table";
import { InviteUserForm } from "./invite-user-form";
import { PublicSignupLinkCard } from "./public-signup-link-card";
import { headers } from "next/headers";
import { Masthead } from "@/components/ffsa";

export default async function UsersPage() {
  const supabase = await createClient();

  // Middleware already validated; read session from cookie (no Supabase
  // round-trip) and run the users-list fetch in parallel with the role check.
  const [
    usersResult,
    {
      data: { session },
    },
    authSignIns,
    { data: ministries },
  ] = await Promise.all([
    getUsers(supabase),
    supabase.auth.getSession(),
    getAuthSignIns(),
    // Department slug→name labels come from the Ministry tab (all ministries,
    // incl. retired, so a since-retired department still renders a proper name).
    listMinistries(supabase),
  ]);
  const departmentLabels: Record<string, string> = {};
  for (const m of (ministries ?? []) as Array<{ slug: string; name: string }>) {
    departmentLabels[m.slug] = m.name;
  }

  // Ministry role + school lookups drive the derived job title. Read via the
  // service-role client — this is a cross-user admin report, and the ministry /
  // enrollment RLS would otherwise hide rows for non-super-admin readers.
  const adminClientForTitles = createAdminClient();
  const [
    { data: ministryMemberships },
    { data: enrollmentSchools },
    { data: arrivalEnrollments },
    { data: courseStarts },
  ] = await Promise.all([
    listActiveMinistryMemberships(adminClientForTitles),
    listActiveEnrollmentSchools(adminClientForTitles),
    listArrivalEnrollments(adminClientForTitles),
    listCourseStartDates(adminClientForTitles),
  ]);

  // "Not arrived yet": accepted onto a school roster but not marked arrived
  // anywhere. Anyone arrived on some school is on base, so they don't count.
  const programStart = new Map<string, string>();
  for (const c of (courseStarts ?? []) as Array<{ program_id: string; start_date: string }>) {
    const prev = programStart.get(c.program_id);
    if (!prev || c.start_date < prev) programStart.set(c.program_id, c.start_date);
  }
  const arrivedUsers = new Set<string>();
  const awaitingArrivalByUser: Record<string, { school: string; startsOn: string | null }> = {};
  for (const e of (arrivalEnrollments ?? []) as Array<{
    user_id: string | null;
    status: string;
    program_id: string;
    programs: { name?: string | null } | { name?: string | null }[] | null;
  }>) {
    if (!e.user_id) continue;
    if (e.status === "arrived") {
      arrivedUsers.add(e.user_id);
      continue;
    }
    const program = Array.isArray(e.programs) ? e.programs[0] : e.programs;
    const startsOn = programStart.get(e.program_id) ?? null;
    const current = awaitingArrivalByUser[e.user_id];
    // Several upcoming schools → show the soonest.
    if (!current || (startsOn && (!current.startsOn || startsOn < current.startsOn))) {
      awaitingArrivalByUser[e.user_id] = {
        school: program?.name?.trim() || "a school",
        startsOn,
      };
    }
  }
  for (const id of arrivedUsers) delete awaitingArrivalByUser[id];

  // user_id → strongest ministry role (point_leader > leader > member).
  const membershipsByUser = new Map<
    string,
    Array<{
      member_role?: string | null;
      is_point_leader?: boolean | null;
      is_category_point_leader?: boolean | null;
      status?: string | null;
    }>
  >();
  for (const m of (ministryMemberships ?? []) as Array<{ user_id: string }>) {
    const bucket = membershipsByUser.get(m.user_id) ?? [];
    bucket.push(m as (typeof bucket)[number]);
    membershipsByUser.set(m.user_id, bucket);
  }
  const ministryRoleByUser: Record<string, MinistryRole> = {};
  for (const [userId, rows] of membershipsByUser) {
    ministryRoleByUser[userId] = strongestMinistryRole(rows);
  }

  // user_id → current school name (first non-removed enrollment, newest first).
  const schoolByUser: Record<string, string> = {};
  for (const e of (enrollmentSchools ?? []) as Array<{
    user_id: string;
    programs: { name?: string | null } | { name?: string | null }[] | null;
  }>) {
    if (schoolByUser[e.user_id]) continue;
    const program = Array.isArray(e.programs) ? e.programs[0] : e.programs;
    const name = program?.name?.trim();
    if (name) schoolByUser[e.user_id] = name;
  }

  const { data: users, count, error: usersError } = usersResult;
  if (usersError) {
    console.error("getUsers error:", JSON.stringify(usersError, null, 2));
  }
  const authUser = session?.user;

  // The public.users.last_sign_in_at mirror is unmaintained (always null), so
  // overlay the authoritative value from Supabase Auth. This drives the status
  // badge: anyone who has actually signed in is past the "Invited" stage.
  //
  // Two blockers that public.users cannot show: never set a password, and an
  // address that bounced so nothing we send arrives. Both are the difference
  // between "chase them" and "copy them a link".
  const accountFlags = await getAccountFlags(
    new Map(
      (users ?? []).map((u: { id: string; email: string | null }) => [
        u.id,
        u.email ?? null,
      ])
    )
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usersWithSignIn = (users ?? []).map((u: any) => ({
    ...u,
    last_sign_in_at: authSignIns.get(u.id) ?? u.last_sign_in_at ?? null,
    needs_setup: accountFlags.get(u.id)?.needsSetup ?? false,
    email_suppressed: accountFlags.get(u.id)?.emailSuppressed ?? false,
  }));

  // Check if current user is super_admin
  let isSuperAdmin = false;
  if (authUser) {
    const { data: superCheck } = await supabase
      .from("user_roles")
      .select("roles!inner(name)")
      .eq("user_id", authUser.id)
      .eq("roles.name", "super_admin")
      .limit(1);
    isSuperAdmin = (superCheck?.length ?? 0) > 0;
  }

  type SignupLink = { type: "staff" | "student" | "community"; code: string; enabled: boolean };
  let signupLinks: SignupLink[] = [];
  let baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
  if (isSuperAdmin) {
    if (!baseUrl) {
      const h = await headers();
      const host = h.get("host");
      const proto = h.get("x-forwarded-proto") || "https";
      baseUrl = host ? `${proto}://${host}` : "";
    }
    const adminSupabase = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: links } = await (adminSupabase as any)
      .from("signup_links")
      .select("type, code, enabled");
    if (links) signupLinks = links as SignupLink[];
  }

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`System access · ${count ?? 0} user ${count === 1 ? "account" : "accounts"}`}
        title="Users"
        actions={isSuperAdmin ? <InviteUserForm /> : undefined}
      />

      <div className="space-y-6 px-5 py-6 md:px-8 md:py-7">

      {isSuperAdmin && signupLinks.length > 0 && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Public signup links</h2>
            <p className="text-xs text-muted-foreground">
              Share the right link per audience — each one grants the matching role and tailors onboarding.
            </p>
          </div>
          {(
            [
              {
                type: "staff" as const,
                label: "Staff signup link",
                description:
                  "For staff members. Grants staff access — share only with vetted staff. Disabled by default.",
              },
              {
                type: "student" as const,
                label: "Student signup link",
                description: "For students enrolling in a program. Grants student access.",
              },
              {
                type: "community" as const,
                label: "Community signup link",
                description: "For community members. Grants base self-service access; skips staff-only onboarding.",
              },
            ]
          ).map((meta) => {
            const link = signupLinks.find((l) => l.type === meta.type);
            if (!link) return null;
            return (
              <PublicSignupLinkCard
                key={meta.type}
                type={meta.type}
                label={meta.label}
                description={meta.description}
                initialCode={link.code}
                initialEnabled={link.enabled}
                baseUrl={baseUrl}
              />
            );
          })}
        </div>
      )}

      <UsersTable
        users={usersWithSignIn}
        currentUserId={authUser?.id ?? ""}
        departmentLabels={departmentLabels}
        ministryRoleByUser={ministryRoleByUser}
        schoolByUser={schoolByUser}
        awaitingArrivalByUser={awaitingArrivalByUser}
        isSuperAdmin={isSuperAdmin}
      />
      </div>
    </div>
  );
}
