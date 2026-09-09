import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound, redirect } from "next/navigation";
import { getUserById, getInsurancePolicies } from "@/services/users";
import { getEnrollmentsByUser } from "@/services/schools";
import {
  deriveJobTitle,
  strongestMinistryRole,
  type Membership,
  type MinistryRole,
} from "@/lib/users/derive-title";
import {
  InsuranceHistory,
  type InsurancePolicyRow,
} from "@/components/profile/insurance-history";
import { getAuthSignIn } from "@/lib/users/auth-signins";
import { getUserSecurityEvents } from "@/lib/users/security-events";
import { getSchoolsManageScopes } from "@/lib/auth/schools-manage-scopes";
import { ProfileRecords } from "@/components/profile-records";
import { SecurityActivityCard } from "@/components/security-activity-card";
import {
  AgreementsCard,
  type SignedAgreement,
} from "@/components/profile/agreements-card";
import {
  getConsentRecordsForUser,
  getConsentAgreementByVersion,
} from "@/services/consent";
import {
  deriveUserLifecycle,
  groupMissingFields,
} from "@/lib/users/lifecycle";
import {
  getInsuranceConfirmation,
  type InsuranceConfirmation,
} from "@/lib/users/profile-fields";
import { listActiveMinistries } from "@/services/ministries";
import { UserHeader } from "./user-header";
import { UserTabs } from "./user-tabs";
import { EditProfileDialog } from "./edit-profile-dialog";

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  // Profile view is open to:
  //   - The user themselves (redirect to /profile for the personal view)
  //   - super_admin, admin
  //   - anyone with users.read or schools.manage (uses isAdmin OR scope check)
  // For simplicity and consistency with the rest of the admin area, we keep
  // the same gate the old page used and add the user themselves as well.
  if (authUser.id === id) {
    redirect("/profile");
  }

  const { data: superCheck } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", authUser.id)
    .in("roles.name", ["super_admin", "admin"])
    .limit(1);
  const isAdmin = (superCheck?.length ?? 0) > 0;

  const manageScopes = isAdmin
    ? { hasGlobal: true, programIds: [] }
    : await getSchoolsManageScopes(supabase, authUser.id);

  const canManagePermissions =
    isAdmin || manageScopes.hasGlobal || manageScopes.programIds.length > 0;

  if (!canManagePermissions) redirect("/dashboard");

  // A schools manager who isn't an admin may only open the profiles of people
  // attached to a school they manage — their applicants and students. Checked
  // with the service-role client because the enrolment/application rows they
  // need are the same ones RLS hides from them (see below).
  const admin = createAdminClient();
  if (!isAdmin) {
    const managesTarget = await viewerManagesStudent(admin, manageScopes, id);
    if (!managesTarget) notFound();
  }

  // `public.users` has exactly two SELECT policies (002_rls_policies.sql):
  // "own record" and is_admin(). A program leader is neither, so the
  // RLS-scoped read comes back empty and the page 404s on someone they are
  // explicitly allowed to review. Read their profile through the service-role
  // client instead — the same workaround the program page already uses for
  // rosters (hydrateUserIdentities) — and trim what renders below to the
  // school-leader view. Insurance/consent/security stay admin-only.
  const profileClient = isAdmin ? supabase : admin;

  const [
    { data: targetUser, error },
    authLastSignInAt,
    securityEvents,
    { data: insurancePolicies },
    { data: ministries },
  ] = await Promise.all([
    getUserById(profileClient, id),
    isAdmin ? getAuthSignIn(id) : Promise.resolve(null),
    isAdmin ? getUserSecurityEvents(id) : Promise.resolve([]),
    isAdmin
      ? getInsurancePolicies(supabase, id)
      : Promise.resolve({ data: [] }),
    // Department options come from the Ministry tab (active ministries). The
    // dialog appends the user's current value if it's a since-retired one.
    listActiveMinistries(supabase),
  ]);
  if (error || !targetUser) notFound();

  // Policies this user has signed — shown to admins (is_admin() passes the
  // consent_records "Admins can read all" RLS). Resolve each record's title
  // from the exact version accepted, caching repeat versions.
  const signedAgreements: SignedAgreement[] = [];
  if (isAdmin) {
    const { data: consentRows } = await getConsentRecordsForUser(supabase, id);
    const titleByVersion = new Map<string, string>();
    for (const rec of (consentRows ?? []) as Array<Record<string, unknown>>) {
      const version = String(rec.agreement_version);
      if (!titleByVersion.has(version)) {
        const { data: ag } = await getConsentAgreementByVersion(supabase, version);
        titleByVersion.set(version, ag?.title ?? "Agreement");
      }
      signedAgreements.push({
        recordId: String(rec.id),
        title: titleByVersion.get(version) ?? "Agreement",
        version,
        acceptedAt: String(rec.accepted_at),
        source: String(rec.source ?? ""),
      });
    }
  }

  const departmentSelectOptions = (
    (ministries ?? []) as Array<{ slug: string; name: string }>
  ).map((m) => ({ value: m.slug, label: m.name }));

  // Only staff (or other elevated roles) may carry a department — students and
  // community members are department-less, so hide the field for them.
  const membershipOnly = new Set(["student", "community_member", "self_service"]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const targetRoleNames = (((targetUser as any).user_roles ?? []) as Array<any>)
    .map((ur) => ur?.roles?.name)
    .filter((n): n is string => !!n);
  const departmentEditable = targetRoleNames.some((n) => !membershipOnly.has(n));

  // Derive the display title (role + department/school), mirroring the Users
  // list. A manual job_title still wins inside deriveJobTitle.
  const membership: Membership = targetRoleNames.includes("staff")
    ? "staff"
    : targetRoleNames.includes("student")
      ? "student"
      : targetRoleNames.includes("community_member")
        ? "community"
        : "none";

  let ministryRole: MinistryRole = null;
  let schoolLabel: string | null = null;
  if (membership === "staff") {
    // Service-role read: ministry RLS may hide rows from a non-super-admin
    // (e.g. schools-manager) viewer; the title should still resolve.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ministryRows } = await (admin as any)
      .from("staff_ministry_members")
      .select("member_role, is_point_leader, is_category_point_leader, status")
      .eq("user_id", id)
      .eq("status", "active");
    ministryRole = strongestMinistryRole(ministryRows ?? []);
  } else if (membership === "student") {
    const { data: enrollments } = await getEnrollmentsByUser(profileClient, id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first = ((enrollments ?? []) as any[])[0];
    const program = Array.isArray(first?.programs)
      ? first.programs[0]
      : first?.programs;
    schoolLabel = program?.name ?? null;
  }

  const derivedTitle = deriveJobTitle({
    jobTitle: targetUser.job_title,
    membership,
    departmentLabel: targetUser.department
      ? departmentSelectOptions.find((o) => o.value === targetUser.department)
          ?.label ?? targetUser.department
      : null,
    ministryRole,
    schoolLabel,
  });

  // Feed the real Supabase-Auth last-sign-in so the derived stage matches the
  // Users table (the users.last_sign_in_at column is unmaintained).
  const lifecycle = deriveUserLifecycle({
    ...targetUser,
    last_sign_in_at: authLastSignInAt ?? targetUser.last_sign_in_at,
  });

  return (
    <div className="ffsa-screen">
      <UserHeader
        user={targetUser}
        authLastSignInAt={authLastSignInAt}
        derivedTitle={derivedTitle}
        eyebrow="Staff profile"
      />
      <UserTabs
        userId={id}
        active="profile"
        showPermissions={canManagePermissions}
      />

      <div className="space-y-6 px-5 py-6 md:px-8 md:py-7">
      <ProfileCompletenessCard
        lifecycle={lifecycle}
        confirmation={getInsuranceConfirmation(
          targetUser as unknown as Record<string, unknown>
        )}
      />

      {isAdmin && (
        <div className="flex justify-end">
          <EditProfileDialog
            user={targetUser}
            departmentOptions={departmentSelectOptions}
            departmentEditable={departmentEditable}
          />
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-3">
        <InfoCard title="Personal">
          <InfoRow label="Legal name" value={legalName(targetUser)} />
          <InfoRow
            label="Preferred name"
            value={targetUser.preferred_name ?? "—"}
          />
          {/* DOB is identity-document PII; a school leader reviewing an
              applicant doesn't need it, admins running the school do. */}
          {isAdmin && (
            <InfoRow
              label="Date of birth"
              value={targetUser.date_of_birth ?? "—"}
            />
          )}
          <InfoRow
            label="Nationality"
            value={targetUser.nationality ?? "—"}
          />
        </InfoCard>

        <InfoCard title="Contact">
          <InfoRow label="Email" value={targetUser.email ?? "—"} />
          <InfoRow label="Phone" value={targetUser.phone ?? "—"} />
          <InfoRow label="Job title" value={derivedTitle ?? "—"} />
        </InfoCard>

        {isAdmin && (
        <InfoCard title="Address">
          {addressLines(targetUser).length > 0 ? (
            <div className="space-y-0.5 text-sm">
              {addressLines(targetUser).map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No address on file.
            </p>
          )}
        </InfoCard>
        )}
      </section>

      {isAdmin && (
        <section className=" border p-4 space-y-3">
          <div>
            <p className="page-eyebrow">HEALTH INSURANCE</p>
            <h2 className="text-xl font-semibold">Policy history</h2>
          </div>
          <InsuranceHistory
            policies={(insurancePolicies ?? []) as InsurancePolicyRow[]}
            pending={
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (targetUser as any).next_health_insurance_provider
                ? {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    provider: String((targetUser as any).next_health_insurance_provider),
                    policy_number:
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      ((targetUser as any).next_health_insurance_policy_number as
                        | string
                        | null) ?? null,
                    expiry_date:
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (targetUser as any).next_health_insurance_no_expiry === true
                        ? null
                        : String(
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            (targetUser as any).next_health_insurance_expiry_date ?? ""
                          ).slice(0, 10),
                    no_expiry:
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (targetUser as any).next_health_insurance_no_expiry === true,
                  }
                : null
            }
            currentNoExpiry={
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (targetUser as any).health_insurance_no_expiry === true
            }
            currentExpiry={
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (targetUser as any).health_insurance_expiry_date
                ? String(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (targetUser as any).health_insurance_expiry_date
                  ).slice(0, 10)
                : null
            }
          />
        </section>
      )}

      {isAdmin && (
        <section>
          <SecurityActivityCard
            events={securityEvents}
            lastSignInAt={authLastSignInAt}
          />
        </section>
      )}

      {isAdmin && (
        <section className=" border p-4 space-y-3">
          <div>
            <p className="page-eyebrow">LEGAL</p>
            <h2 className="text-xl font-semibold">Agreements signed</h2>
            <p className="text-sm text-muted-foreground">
              Policies this person has accepted. Open any to view or print the
              exact document they signed.
            </p>
          </div>
          <AgreementsCard agreements={signedAgreements} />
        </section>
      )}

      {isAdmin && (
      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <p className="page-eyebrow">RECORDS ON FILE</p>
            <h2 className="text-xl font-semibold">Attached history</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Auto-linked from CSV imports via the Records Library matching engine.
          </p>
        </div>
        <ProfileRecords userId={id} canOpenLibrary={true} />
      </section>
      )}
      </div>
    </div>
  );
}

/**
 * True when a non-admin schools manager is allowed to open this person's
 * profile: the person must have an application or an enrolment on a program
 * the viewer manages (any program when their schools.manage is global).
 *
 * Runs on the service-role client — the rows it checks are exactly the ones
 * RLS hides from a program leader, so an RLS-scoped read would answer "no"
 * for every student they legitimately review.
 */
async function viewerManagesStudent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the `Client = any` convention in services
  admin: any,
  scopes: { hasGlobal: boolean; programIds: string[] },
  targetUserId: string
): Promise<boolean> {
  for (const table of ["enrollments", "application_responses"]) {
    let query = admin
      .from(table)
      .select("id")
      .eq("user_id", targetUserId)
      .limit(1);
    if (!scopes.hasGlobal) {
      if (scopes.programIds.length === 0) return false;
      query = query.in("program_id", scopes.programIds);
    }
    const { data } = await query;
    if ((data?.length ?? 0) > 0) return true;
  }
  return false;
}

function legalName(u: {
  first_name?: string | null;
  last_name?: string | null;
}): string {
  const parts = [u.first_name, u.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "—";
}

function addressLines(u: {
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country?: string | null;
}): string[] {
  return [
    u.address_line_1,
    u.address_line_2,
    [u.city, u.province].filter(Boolean).join(", "),
    u.postal_code,
    u.country,
  ].filter((s): s is string => !!s && s.length > 0);
}

function ProfileCompletenessCard({
  lifecycle,
  confirmation,
}: {
  lifecycle: ReturnType<typeof deriveUserLifecycle>;
  confirmation: InsuranceConfirmation;
}) {
  const groups = groupMissingFields(lifecycle.missingFields);
  const missingCount = lifecycle.missingFields.length;
  const isComplete = missingCount === 0;
  const insurance = lifecycle.insurance;

  return (
    <section className=" border p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="page-eyebrow">PROFILE COMPLETENESS</p>
          <h2 className="text-xl font-semibold">
            {isComplete ? "Profile complete" : "Profile incomplete"}
          </h2>
        </div>
        <span className="text-sm text-muted-foreground">
          {lifecycle.completedRequired} of {lifecycle.totalRequired} required
          fields on file
        </span>
      </div>

      {isComplete ? (
        <p className="text-sm text-grass-text">
          All required fields are on file.
        </p>
      ) : (
        <div>
          <p className="text-sm text-amber mb-2">
            Missing {missingCount} required field{missingCount === 1 ? "" : "s"}:
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
              <div key={group.section}>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {group.section}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {group.fields.map((field) => (
                    <li key={field.field} className="text-sm">
                      {field.label}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {insurance.state === "expired" && (
        <p className="text-sm text-destructive">
          Health insurance policy expired
          {insurance.expiryDate ? ` on ${insurance.expiryDate}` : ""}.
        </p>
      )}
      {insurance.state === "expiring" && (
        <p className="text-sm text-amber">
          Health insurance expires in {insurance.daysLeft ?? 0} day
          {insurance.daysLeft === 1 ? "" : "s"}
          {insurance.expiryDate ? ` (${insurance.expiryDate})` : ""}.
        </p>
      )}
      {/* An open-ended policy can never read as expired or expiring — its
          only health check is the annual re-confirmation. */}
      {insurance.state === "no_expiry" && (
        <p
          className={
            confirmation.level === "blocking"
              ? "text-sm text-destructive"
              : confirmation.level === "due" || confirmation.level === "due_soon"
                ? "text-sm text-amber"
                : "text-sm text-muted-foreground"
          }
        >
          Health insurance doesn&rsquo;t expire (open-ended medical scheme).
          {confirmation.confirmedAt
            ? ` Last confirmed ${confirmation.confirmedAt}`
            : " Never confirmed"}
          {confirmation.level === "blocking"
            ? " — overdue, and the Hub is blocked until they confirm."
            : confirmation.level === "due" || confirmation.level === "due_soon"
              ? `${confirmation.dueOn ? `, due ${confirmation.dueOn}` : ""}.`
              : `${confirmation.dueOn ? `, next due ${confirmation.dueOn}` : ""}.`}
        </p>
      )}
    </section>
  );
}

function InfoCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className=" border p-4 space-y-3">
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mono-label">{label}</div>
      <div className="mt-1 text-sm text-ink">{value}</div>
    </div>
  );
}
