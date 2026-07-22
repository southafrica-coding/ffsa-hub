import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, getInsurancePolicies } from "@/services/users";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ProfileRecords } from "@/components/profile-records";
import { AvatarUploader } from "@/components/avatar-uploader";
import { EditableProfileSection } from "@/components/profile/editable-profile-section";
import {
  InsuranceHistory,
  type InsurancePolicyRow,
} from "@/components/profile/insurance-history";
import { PROFILE_SECTIONS } from "@/lib/users/profile-sections";

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: user } = await getCurrentUser(supabase);

  if (!user) redirect("/login");

  const { data: insurancePolicies } = await getInsurancePolicies(supabase, user.id);

  const row = user as Record<string, unknown>;
  const roles = user.user_roles ?? [];

  const fullName =
    [user.preferred_name ?? user.first_name, user.last_name]
      .filter(Boolean)
      .join(" ") || user.email || "Profile";

  const avatarName =
    user.preferred_name ?? user.first_name ?? user.email ?? "?";

  // Email is auth-managed, so it rides along as a read-only row in the
  // Contact card rather than as an editable field.
  const readOnlyRowsById: Record<
    string,
    { label: string; value: string; hint?: string }[]
  > = {
    contact: [
      {
        label: "Email",
        value: user.email ?? "—",
        hint: "To change your email, use Account settings.",
      },
    ],
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start gap-5">
        <AvatarUploader
          userId={user.id}
          initialSrc={user.avatar_url}
          name={avatarName}
          size={72}
        />
        <div className="flex-1 min-w-0">
          <p className="page-eyebrow">MY PROFILE</p>
          <h1 className="page-title truncate">{fullName}</h1>
          <div className="text-sm text-muted-foreground mt-1">
            {user.email ?? "—"}
            {user.preferred_name &&
              user.first_name &&
              user.preferred_name !== user.first_name && (
                <>
                  <span className="opacity-50"> · </span>
                  legal name {user.first_name} {user.last_name}
                </>
              )}
          </div>
          {roles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {roles.map(
                (ur: {
                  id: string;
                  scope_type: string | null;
                  scope_id: string | null;
                  roles: { display_name: string } | null;
                }) => (
                  <Badge key={ur.id} variant="secondary">
                    {ur.roles?.display_name ?? "Unknown"}
                    {ur.scope_type && (
                      <span className="ml-1 opacity-60">
                        ({ur.scope_type})
                      </span>
                    )}
                  </Badge>
                )
              )}
            </div>
          )}
        </div>
      </div>

      <section className="space-y-3">
        <div>
          <p className="page-eyebrow">MY DETAILS</p>
          <h2 className="text-xl font-semibold">Personal information</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Everything we have on file. Use the Edit button on any section to
            keep it up to date.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {PROFILE_SECTIONS.map((section) => (
            <EditableProfileSection
              key={section.id}
              section={section}
              values={sectionValues(row, section.fields)}
              readOnlyRows={readOnlyRowsById[section.id]}
              footer={
                section.id === "insurance" ? (
                  <InsuranceHistory
                    policies={(insurancePolicies ?? []) as InsurancePolicyRow[]}
                  />
                ) : undefined
              }
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <p className="page-eyebrow">RECORDS ON FILE</p>
          <h2 className="text-xl font-semibold">Your attached history</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Past applications, schools attended, payments and documents we
            have on file for you.
          </p>
        </div>
        <ProfileRecords userId={user.id} canOpenLibrary={false} />
      </section>
    </div>
  );
}

// Coerce the stored row into the string map the editable section expects:
// dates trimmed to YYYY-MM-DD, null/undefined → "".
function sectionValues(
  row: Record<string, unknown>,
  fields: { field: string; type: string }[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const raw = row[f.field];
    if (raw === null || raw === undefined) {
      out[f.field] = "";
    } else if (f.type === "date") {
      out[f.field] = String(raw).slice(0, 10);
    } else {
      out[f.field] = String(raw);
    }
  }
  return out;
}
