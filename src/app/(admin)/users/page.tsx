import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUsers } from "@/services/users";
import { listMinistries, listActiveMinistryMemberships } from "@/services/ministries";
import { adminDepartmentOptions } from "@/lib/users/department-options";
import { listActiveEnrollmentSchools } from "@/services/schools";
import { getAwaitingArrivalByUser } from "@/lib/schools/awaiting-arrival";
import { strongestMinistryRole, type MinistryRole } from "@/lib/users/derive-title";
import { getAuthSignIns } from "@/lib/users/auth-signins";
import { getAccountFlags } from "@/lib/users/account-flags";
import { UsersTable } from "./users-table";
import { InviteUserForm } from "./invite-user-form";
import { PublicSignupLinkCard } from "./public-signup-link-card";
import { headers } from "next/headers";
import { Masthead, MastheadAction } from "@/components/ffsa";

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
  // What a newly-made staff member can be given as their department: active
  // MAIN ministries, including Leadership Team. This dialog saves through
  // PATCH /api/users/[id], the admin path that is still allowed to set it.
  const departmentOptions = adminDepartmentOptions(
    (
      (ministries ?? []) as Array<{
        slug: string;
        name: string;
        is_active: boolean;
        ministry_type: string | null;
        sort_order: number | null;
      }>
    )
      .filter((m) => m.is_active && m.ministry_type === "main")
      .sort(
        (a, b) =>
          (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)
      )
  );

  // Ministry role + school lookups drive the derived job title. Read via the
  // service-role client — this is a cross-user admin report, and the ministry /
  // enrollment RLS would otherwise hide rows for non-super-admin readers.
  const adminClientForTitles = createAdminClient();
  const [
    { data: ministryMemberships },
    { data: enrollmentSchools },
    awaitingArrivalByUser,
  ] = await Promise.all([
    listActiveMinistryMemberships(adminClientForTitles),
    listActiveEnrollmentSchools(adminClientForTitles),
    getAwaitingArrivalByUser(adminClientForTitles),
  ]);

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

  // Admin tier of the current user. `isSuperAdmin` here means either tier
  // (super_admin or General Admin) — both manage users. Only a real
  // super_admin may change a super admin's account.
  let isSuperAdmin = false;
  let canChangeSuperAdmins = false;
  if (authUser) {
    const { data: tierRows } = await supabase
      .from("user_roles")
      .select("roles!inner(name)")
      .eq("user_id", authUser.id)
      .in("roles.name", ["super_admin", "admin"]);
    const tiers = new Set(
      ((tierRows ?? []) as { roles: { name: string } | { name: string }[] }[]).map(
        (r) => (Array.isArray(r.roles) ? r.roles[0]?.name : r.roles?.name)
      )
    );
    isSuperAdmin = tiers.size > 0;
    canChangeSuperAdmins = tiers.has("super_admin");
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
        actions={
          isSuperAdmin ? (
            <>
              {/* /users/merge allows the same two tiers this flag already
                  covers: super_admin and admin. Other roles are sent back
                  to /users, so the action stays off the masthead for them. */}
              <MastheadAction href="/users/merge">Merge accounts</MastheadAction>
              <InviteUserForm />
            </>
          ) : undefined
        }
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
        departmentOptions={departmentOptions}
        ministryRoleByUser={ministryRoleByUser}
        schoolByUser={schoolByUser}
        awaitingArrivalByUser={awaitingArrivalByUser}
        isSuperAdmin={isSuperAdmin}
        canChangeSuperAdmins={canChangeSuperAdmins}
      />
      </div>
    </div>
  );
}
