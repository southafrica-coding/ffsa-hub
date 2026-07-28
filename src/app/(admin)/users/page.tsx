import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUsers } from "@/services/users";
import { getListOptions, type ListOption } from "@/services/list-options";
import { getAuthSignIns } from "@/lib/users/auth-signins";
import { UsersTable } from "./users-table";
import { InviteUserForm } from "./invite-user-form";
import { PublicSignupLinkCard } from "./public-signup-link-card";
import { headers } from "next/headers";

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
    { data: departmentOptions },
  ] = await Promise.all([
    getUsers(supabase),
    supabase.auth.getSession(),
    getAuthSignIns(),
    getListOptions(supabase, "department", { activeOnly: true }),
  ]);
  const departmentLabels: Record<string, string> = {};
  for (const o of (departmentOptions ?? []) as ListOption[]) {
    departmentLabels[o.value] = o.label;
  }
  const { data: users, count, error: usersError } = usersResult;
  if (usersError) {
    console.error("getUsers error:", JSON.stringify(usersError, null, 2));
  }
  const authUser = session?.user;

  // The public.users.last_sign_in_at mirror is unmaintained (always null), so
  // overlay the authoritative value from Supabase Auth. This drives the status
  // badge: anyone who has actually signed in is past the "Invited" stage.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usersWithSignIn = (users ?? []).map((u: any) => ({
    ...u,
    last_sign_in_at: authSignIns.get(u.id) ?? u.last_sign_in_at ?? null,
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
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="page-eyebrow">SYSTEM ACCESS</p>
          <h1 className="page-title">Users</h1>
          <p className="text-sm text-muted-foreground mt-1">{count ?? 0} user accounts</p>
        </div>
        {isSuperAdmin && <InviteUserForm />}
      </div>

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
        isSuperAdmin={isSuperAdmin}
      />
    </div>
  );
}
