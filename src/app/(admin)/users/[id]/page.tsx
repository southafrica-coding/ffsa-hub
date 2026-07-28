import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { getUserById, getInsurancePolicies } from "@/services/users";
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
  deriveUserLifecycle,
  groupMissingFields,
} from "@/lib/users/lifecycle";
import { getListOptions, type ListOption } from "@/services/list-options";
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

  const [
    { data: targetUser, error },
    authLastSignInAt,
    securityEvents,
    { data: insurancePolicies },
    { data: departmentOptions },
  ] = await Promise.all([
    getUserById(supabase, id),
    getAuthSignIn(id),
    getUserSecurityEvents(id),
    getInsurancePolicies(supabase, id),
    getListOptions(supabase, "department", { activeOnly: true }),
  ]);
  if (error || !targetUser) notFound();

  const departmentSelectOptions = ((departmentOptions ?? []) as ListOption[]).map(
    (o) => ({ value: o.value, label: o.label })
  );

  // Only staff (or other elevated roles) may carry a department — students and
  // community members are department-less, so hide the field for them.
  const membershipOnly = new Set(["student", "community_member", "self_service"]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const targetRoleNames = (((targetUser as any).user_roles ?? []) as Array<any>)
    .map((ur) => ur?.roles?.name)
    .filter((n): n is string => !!n);
  const departmentEditable = targetRoleNames.some((n) => !membershipOnly.has(n));

  // Feed the real Supabase-Auth last-sign-in so the derived stage matches the
  // Users table (the users.last_sign_in_at column is unmaintained).
  const lifecycle = deriveUserLifecycle({
    ...targetUser,
    last_sign_in_at: authLastSignInAt ?? targetUser.last_sign_in_at,
  });

  return (
    <div className="space-y-6">
      <UserHeader
        user={targetUser}
        authLastSignInAt={authLastSignInAt}
        eyebrow="STAFF PROFILE"
      />
      <UserTabs
        userId={id}
        active="profile"
        showPermissions={canManagePermissions}
      />

      <ProfileCompletenessCard lifecycle={lifecycle} />

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
          <InfoRow
            label="Date of birth"
            value={targetUser.date_of_birth ?? "—"}
          />
          <InfoRow
            label="Nationality"
            value={targetUser.nationality ?? "—"}
          />
        </InfoCard>

        <InfoCard title="Contact">
          <InfoRow label="Email" value={targetUser.email ?? "—"} />
          <InfoRow label="Phone" value={targetUser.phone ?? "—"} />
          <InfoRow
            label="Job title"
            value={targetUser.job_title ?? "—"}
          />
        </InfoCard>

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
      </section>

      {isAdmin && (
        <section className="rounded-xl border p-4 space-y-3">
          <div>
            <p className="page-eyebrow">HEALTH INSURANCE</p>
            <h2 className="text-xl font-semibold">Policy history</h2>
          </div>
          <InsuranceHistory
            policies={(insurancePolicies ?? []) as InsurancePolicyRow[]}
          />
        </section>
      )}

      <section>
        <SecurityActivityCard
          events={securityEvents}
          lastSignInAt={authLastSignInAt}
        />
      </section>

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
    </div>
  );
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
}: {
  lifecycle: ReturnType<typeof deriveUserLifecycle>;
}) {
  const groups = groupMissingFields(lifecycle.missingFields);
  const missingCount = lifecycle.missingFields.length;
  const isComplete = missingCount === 0;
  const insurance = lifecycle.insurance;

  return (
    <section className="rounded-xl border p-4 space-y-3">
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
        <p className="text-sm text-emerald-500">
          All required fields are on file.
        </p>
      ) : (
        <div>
          <p className="text-sm text-orange-400 mb-2">
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
        <p className="text-sm text-red-400">
          Health insurance policy expired
          {insurance.expiryDate ? ` on ${insurance.expiryDate}` : ""}.
        </p>
      )}
      {insurance.state === "expiring" && (
        <p className="text-sm text-orange-400">
          Health insurance expires in {insurance.daysLeft ?? 0} day
          {insurance.daysLeft === 1 ? "" : "s"}
          {insurance.expiryDate ? ` (${insurance.expiryDate})` : ""}.
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
    <div className="rounded-xl border p-4 space-y-3">
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
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm mt-0.5">{value}</div>
    </div>
  );
}
