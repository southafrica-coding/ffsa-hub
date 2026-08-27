import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, getInsurancePolicies } from "@/services/users";
import { redirect } from "next/navigation";

import { ProfileRecords } from "@/components/profile-records";
import { AvatarUploader } from "@/components/avatar-uploader";
import { EditableProfileSection } from "@/components/profile/editable-profile-section";
import {
  InsuranceHistory,
  type InsurancePolicyRow,
} from "@/components/profile/insurance-history";
import { currentPolicyId } from "@/lib/users/insurance-policies";
import {
  HouseholdMembers,
  type HouseholdMember,
} from "@/components/profile/household-members";
import { getHouseholdMembers } from "@/services/household";
import { HouseholdLinkCard } from "@/components/profile/household-link-card";
import { SlackLinkCard } from "@/components/profile/slack-link-card";
import { NotificationPrefsCard } from "@/components/profile/notification-prefs-card";
import { getSlackLink } from "@/services/slack-links";
import { activeBroadcastModules } from "@/lib/slack/broadcast-types";
import {
  AgreementsCard,
  type SignedAgreement,
} from "@/components/profile/agreements-card";
import {
  getConsentRecordsForUser,
  getConsentAgreementByVersion,
} from "@/services/consent";
import { PROFILE_SECTIONS } from "@/lib/users/profile-sections";
import { deriveUserLifecycle } from "@/lib/users/lifecycle";
import { ProfileIncompleteSummary } from "@/components/profile/incomplete-summary";
import { excludedProfileFields, applyListOptions } from "@/lib/users/profile-fields";
import { INSURANCE_PROVIDERS } from "@/lib/profile/options";
import { getAllListOptions, activeSets } from "@/services/list-options";
import { listActiveMinistries } from "@/services/ministries";
import { SectionBar, Chip } from "@/components/ffsa";

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: user } = await getCurrentUser(supabase);

  if (!user) redirect("/login");

  const { data: insurancePolicies } = await getInsurancePolicies(supabase, user.id);
  const insuranceRows = (insurancePolicies ?? []) as InsurancePolicyRow[];

  // Exclude the caller's own spouse-identity row when they're linked: those
  // details live on their own profile above, not as a family member of
  // themselves. Their spouse still sees the row.
  const { data: householdRows } = await getHouseholdMembers(supabase, user.id, {
    excludeLinkedUserId: user.id,
  });
  const householdMembers = (householdRows ?? []) as HouseholdMember[];

  // Slack link + per-module mutes. The link is read via the admin client
  // because users.slack_user_id isn't exposed to the RLS client; the prefs
  // row is the caller's own, so it reads fine under RLS (and is absent
  // until they first toggle something, which means "nothing muted").
  const slackLink = await getSlackLink(createAdminClient(), user.id);
  const broadcastModules = activeBroadcastModules().map((m) => ({
    key: m.key as string,
    label: m.label,
    description: m.description,
    types: m.types.map((t) => ({
      key: t.key,
      label: t.label,
      description: t.description,
    })),
  }));
  // The generated Database types predate migration 069's
  // notification_preferences — cast per repo convention (same as the
  // household link / onboarding_invites call sites).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: prefsRow } = await (supabase as any)
    .from("notification_preferences")
    .select("muted_modules")
    .eq("user_id", user.id)
    .maybeSingle();
  const mutedModules =
    ((prefsRow as { muted_modules: string[] | null } | null)?.muted_modules) ??
    [];

  // Policies this user has personally signed (RLS: own records only). Resolve
  // each record's agreement title from the exact version they accepted; cache
  // lookups so repeat versions aren't re-fetched.
  const { data: consentRows } = await getConsentRecordsForUser(supabase, user.id);
  const titleByVersion = new Map<string, string>();
  const signedAgreements: SignedAgreement[] = [];
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

  // Admin-editable dropdown vocabularies (gender/insurance/relationship) plus
  // Department, which is sourced live from the Ministry tab (staff_ministries)
  // and overrides any list_options department rows.
  const { data: lists } = await getAllListOptions(supabase);
  const sets = activeSets(lists);
  const { data: mins } = await listActiveMinistries(supabase);
  if (mins?.length) {
    sets.department = mins.map(
      (m: { slug: string; name: string }) => ({ value: m.slug, label: m.name })
    );
  }

  const row = user as Record<string, unknown>;
  const roles = user.user_roles ?? [];

  // Same derivation the admin Users badge uses, so "what's missing" matches
  // exactly what the completion gate blocks on.
  const lifecycle = deriveUserLifecycle(row);

  // Which history row is the current active policy — protected from deletion.
  const insuranceCurrentId = currentPolicyId(insuranceRows, {
    provider: row.health_insurance_provider as string | null | undefined,
    policy_number: row.health_insurance_policy_number as string | null | undefined,
    expiry_date: row.health_insurance_expiry_date as string | null | undefined,
  });

  // Queued successor policy (migration 151), if one is lined up.
  const pendingInsurance = row.next_health_insurance_provider
    ? {
        provider: String(row.next_health_insurance_provider),
        policy_number:
          (row.next_health_insurance_policy_number as string | null) ?? null,
        expiry_date: String(row.next_health_insurance_expiry_date ?? "").slice(0, 10),
      }
    : null;
  const currentInsuranceExpiry = row.health_insurance_expiry_date
    ? String(row.health_insurance_expiry_date).slice(0, 10)
    : null;
  // Provider suggestions for the "add next policy" dialog (skip the "none" sentinel).
  const insuranceProviderOptions = (sets.insurance_provider ?? INSURANCE_PROVIDERS)
    .filter((o) => o.value.toLowerCase() !== "none")
    .map((o) => o.label);

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
    <div className="ffsa-screen">
      {/* Masthead shaped by hand rather than composed from <Masthead>: this
          screen leads with the avatar uploader, which the primitive has no
          slot for. Same rule, same type scale. */}
      <div className="flex items-start gap-4 border-b border-ink bg-white px-5 pb-4 pt-5 md:gap-5 md:px-8 md:pb-5 md:pt-6">
        <AvatarUploader
          userId={user.id}
          initialSrc={user.avatar_url}
          name={avatarName}
          size={72}
        />
        <div className="min-w-0 flex-1">
          <div className="masthead-context">My profile</div>
          <h1 className="masthead-title truncate">{fullName}</h1>
          <div className="mt-2 text-sm text-[color:var(--text-secondary)]">
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
                  <Chip key={ur.id}>
                    {ur.roles?.display_name ?? "Unknown"}
                    {ur.scope_type && <span>({ur.scope_type})</span>}
                  </Chip>
                )
              )}
            </div>
          )}
        </div>
      </div>

      <ProfileIncompleteSummary lifecycle={lifecycle} />

      <SectionBar title="Personal information" meta="Everything on file" />

      <section className="space-y-3 px-5 py-6 md:px-8 md:py-7">
        <p className="max-w-2xl text-sm text-[color:var(--text-secondary)]">
          Use the Edit button on any section to keep it up to date.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {PROFILE_SECTIONS.map((rawSection) => {
            // Hide fields that don't apply to this user's signup type
            // (province for staff/student/community; department for
            // student/community).
            const excluded = excludedProfileFields(
              row.signup_type as string | null | undefined
            );
            const section = {
              ...rawSection,
              fields: applyListOptions(
                rawSection.fields.filter((f) => !excluded.has(f.field)),
                sets
              ),
            };
            return (
            <EditableProfileSection
              key={section.id}
              section={section}
              values={sectionValues(row, section.fields)}
              readOnlyRows={readOnlyRowsById[section.id]}
              footer={
                section.id === "insurance" ? (
                  <InsuranceHistory
                    policies={insuranceRows}
                    currentPolicyId={insuranceCurrentId}
                    canDelete
                    manageable
                    pending={pendingInsurance}
                    currentExpiry={currentInsuranceExpiry}
                    providerOptions={insuranceProviderOptions}
                  />
                ) : undefined
              }
            />
            );
          })}
        </div>
      </section>

      <section className="space-y-3 px-5 pb-6 md:px-8 md:pb-7">
        <div>
          <p className="page-eyebrow">MY HOUSEHOLD</p>
          <h2 className="text-xl font-semibold">Family members</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Your spouse and children. For a spouse we just need their name and
            email; for children, their passport, visa and health-insurance
            details. If your spouse has their own Hub account with that email,
            you both see and edit the same records &mdash; only one of you needs
            to fill the children in.
          </p>
        </div>
        <HouseholdLinkCard
          linkedAt={(row.household_linked_at ?? null) as string | null}
        />
        <div className="rounded-xl border p-4">
          <HouseholdMembers
            initialMembers={householdMembers}
            selfDefaults={{
              is_international: row.is_international as boolean | null | undefined,
              visa_category: row.visa_category as string | null | undefined,
              visa_type: row.visa_type as string | null | undefined,
              visa_expiry_date: row.visa_expiry_date as string | null | undefined,
              health_insurance_provider: row.health_insurance_provider as string | null | undefined,
              health_insurance_policy_number: row.health_insurance_policy_number as string | null | undefined,
              health_insurance_expiry_date: row.health_insurance_expiry_date as string | null | undefined,
            }}
          />
        </div>
      </section>

      <section className="space-y-3 px-5 pb-6 md:px-8 md:pb-7">
        <div>
          <p className="page-eyebrow">NOTIFICATIONS</p>
          <h2 className="text-xl font-semibold">Slack messages</h2>
          <p className="text-sm text-muted-foreground mt-1">
            The Hub messages you directly in Slack when something happens that
            you need to know about, rather than adding you to another group
            channel.
          </p>
        </div>
        <SlackLinkCard
          slackUserId={slackLink.slackUserId}
          linkedAt={slackLink.linkedAt}
          source={slackLink.source}
        />
        <NotificationPrefsCard
          modules={broadcastModules}
          mutedModules={mutedModules}
          slackConnected={!!slackLink.slackUserId}
        />
      </section>

      <section className="space-y-3 px-5 pb-6 md:px-8 md:pb-7">
        <div>
          <p className="page-eyebrow">LEGAL</p>
          <h2 className="text-xl font-semibold">Agreements you&rsquo;ve signed</h2>
          <p className="text-sm text-muted-foreground mt-1">
            The policies and agreements you&rsquo;ve accepted. Open any one to
            read the full text you agreed to, or print / save it as a PDF.
          </p>
        </div>
        <div className="rounded-xl border p-4">
          <AgreementsCard agreements={signedAgreements} />
        </div>
      </section>

      <section className="space-y-3 px-5 pb-6 md:px-8 md:pb-7">
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
