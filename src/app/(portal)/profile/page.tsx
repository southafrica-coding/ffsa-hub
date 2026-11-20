import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, getInsurancePolicies } from "@/services/users";
import { redirect } from "next/navigation";

import { ProfileRecords } from "@/components/profile-records";
import { AvatarUploader } from "@/components/avatar-uploader";
import { EditableProfileSection } from "@/components/profile/editable-profile-section";
import { InsuranceHistory, type InsurancePolicyRow } from "@/components/profile/insurance-history";
import { currentPolicyId } from "@/lib/users/insurance-policies";
import { HouseholdMembers, type HouseholdMember } from "@/components/profile/household-members";
import { getHouseholdMembers } from "@/services/household";
import { HouseholdLinkCard } from "@/components/profile/household-link-card";
import { SlackLinkCard } from "@/components/profile/slack-link-card";
import { LicenceCard } from "@/components/profile/licence-card";
import { PassportPhotoCard } from "@/components/profile/passport-photo-card";
import { NotificationPrefsCard } from "@/components/profile/notification-prefs-card";
import { getSlackLink } from "@/services/slack-links";
import { activeBroadcastModules } from "@/lib/slack/broadcast-types";
import { AgreementsCard, type SignedAgreement } from "@/components/profile/agreements-card";
import { getConsentRecordsForUser, getConsentAgreementByVersion } from "@/services/consent";
import { PROFILE_SECTIONS } from "@/lib/users/profile-sections";
import { deriveUserLifecycle } from "@/lib/users/lifecycle";
import { ProfileIncompleteSummary } from "@/components/profile/incomplete-summary";
import { excludedProfileFields, applyListOptions } from "@/lib/users/profile-fields";
import { INSURANCE_PROVIDERS } from "@/lib/profile/options";
import { getAllListOptions, activeSets } from "@/services/list-options";
import { listActiveMinistries } from "@/services/ministries";
import { selfServiceDepartmentOptions } from "@/lib/users/self-department";
import { Chip } from "@/components/ffsa";
import { StaffCvCard, type CvEntry } from "@/components/profile/staff-cv-card";
import type { CvEntryCategory } from "@/lib/users/cv-entry-types";
import { listCvEntries } from "@/services/staff-cv";
import { callerIsAdmin } from "@/lib/auth/check-ministry-access";
import { isLeadershipTeam } from "@/lib/auth/check-okr-access";
import { canEditJobDescription } from "@/lib/auth/check-cv-access";
import { PersonalOkrs } from "@/components/profile/personal-okrs";
import { getCurrentCycle, listObjectives } from "@/services/okrs";
import { listUserMinistries } from "@/services/staff-cv";
import { ProfileTabs } from "@/components/profile/profile-tabs";
import { PROFILE_TABS, type ProfileTab } from "@/components/profile/profile-tab-keys";
import { canHaveSpouse } from "@/lib/users/marital-status";
import { AppearanceCard } from "@/components/profile/appearance-card";
import { isColorScheme } from "@/lib/theme";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const supabase = await createClient();
  const { data: user } = await getCurrentUser(supabase);

  if (!user) redirect("/login");

  const { tab: tabParam } = await searchParams;
  const initialTab: ProfileTab = (PROFILE_TABS as readonly string[]).includes(tabParam ?? "")
    ? (tabParam as ProfileTab)
    : "personal";

  // The Work tab (CV + OKRs) is for staff. "Staff" = holds any role beyond
  // the membership floor — never signup_type, which is NULL for most real
  // staff. Same test the admin user page uses for departmentEditable.
  const MEMBERSHIP_ONLY = new Set(["student", "community_member", "self_service"]);
  const showWorkTab = ((user.user_roles ?? []) as Array<{ roles: { name?: string } | null }>).some(
    (ur) => !!ur.roles?.name && !MEMBERSHIP_ONLY.has(ur.roles.name)
  );

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
  const mutedModules = (prefsRow as { muted_modules: string[] | null } | null)?.muted_modules ?? [];

  // Policies this user has personally signed (RLS: own records only). Resolve
  // each record's agreement title from the exact version they accepted; cache
  // lookups so repeat versions aren't re-fetched.
  const { data: cvEntries } = showWorkTab ? await listCvEntries(supabase, user.id) : { data: [] };
  const isAdmin = showWorkTab && (await callerIsAdmin(supabase, user.id));
  const isLeadership = showWorkTab && (await isLeadershipTeam(supabase, user.id));
  const canEditOwnJobDescription =
    showWorkTab && (await canEditJobDescription(supabase, user.id, user.id));

  // Personal OKRs (migration 182's individual scope) — RLS on okr_objectives
  // already decides what comes back, so the caller's own client is correct
  // here, not the admin client.
  const { data: currentCycle } = showWorkTab ? await getCurrentCycle(supabase) : { data: null };
  const { data: okrObjectives } = currentCycle
    ? await listObjectives(supabase, {
        cycleId: currentCycle.id,
        scope: "individual",
        ownerUserId: user.id,
      })
    : { data: [] };
  const { data: ownMinistries } = showWorkTab
    ? await listUserMinistries(createAdminClient(), user.id)
    : { data: [] };

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
  const row = user as Record<string, unknown>;

  const { data: lists } = await getAllListOptions(supabase);
  const sets = activeSets(lists);
  const { data: mins } = await listActiveMinistries(supabase);
  if (mins?.length) {
    sets.department = selfServiceDepartmentOptions(
      mins as { slug: string; name: string }[],
      row.department
    );
  }
  const roles = user.user_roles ?? [];

  // Same derivation the admin Users badge uses, so "what's missing" matches
  // exactly what the completion gate blocks on.
  const lifecycle = deriveUserLifecycle(row);

  // Which history row is the current active policy — protected from deletion.
  const insuranceCurrentId = currentPolicyId(insuranceRows, {
    provider: row.health_insurance_provider as string | null | undefined,
    policy_number: row.health_insurance_policy_number as string | null | undefined,
    expiry_date: row.health_insurance_expiry_date as string | null | undefined,
    no_expiry: row.health_insurance_no_expiry as boolean | null | undefined,
  });

  // Queued successor policy (migration 151), if one is lined up.
  const pendingInsurance = row.next_health_insurance_provider
    ? {
        provider: String(row.next_health_insurance_provider),
        policy_number: (row.next_health_insurance_policy_number as string | null) ?? null,
        expiry_date:
          row.next_health_insurance_no_expiry === true
            ? null
            : String(row.next_health_insurance_expiry_date ?? "").slice(0, 10),
        no_expiry: row.next_health_insurance_no_expiry === true,
      }
    : null;
  const currentInsuranceExpiry = row.health_insurance_expiry_date
    ? String(row.health_insurance_expiry_date).slice(0, 10)
    : null;
  const currentInsuranceNoExpiry = row.health_insurance_no_expiry === true;
  // Provider suggestions for the "add next policy" dialog (skip the "none" sentinel).
  const insuranceListOptions = sets.insurance_provider ?? INSURANCE_PROVIDERS;
  const insuranceProviderOptions = insuranceListOptions
    .filter((o) => o.value.toLowerCase() !== "none")
    .map((o) => o.label);
  // …and the subset that may be recorded as never-expiring: every listed
  // scheme except the free-text "Other" sentinel. Stored VALUES, since that
  // is what the API validates against.
  const eligibleNoExpiryProviders = insuranceListOptions
    .filter((o) => o.value.toLowerCase() !== "none" && o.value.toLowerCase() !== "other")
    .map((o) => o.value);

  const fullName =
    [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email || "Profile";

  // Shared by the two StaffCvCard halves on the Work tab (statements above
  // the OKRs, entry lists below). Profile order: skills first, training last;
  // "Other" only when something is filed under it.
  const cvProps = {
    targetUserId: user.id,
    viewer: { id: user.id, isAdmin, isLeadership },
    canEditJobDescription: canEditOwnJobDescription,
    initialEssenceStatement: String(row.essence_statement ?? ""),
    initialJobDescription: String(row.job_description ?? ""),
    initialEntries: (cvEntries ?? []) as CvEntry[],
  };
  const cvCategoryOrder: CvEntryCategory[] = [
    "skill",
    "workshop",
    "involvement",
    "training",
    ...(cvProps.initialEntries.some((e) => e.category === "other") ? (["other"] as const) : []),
  ];

  const avatarName = user.first_name ?? user.email ?? "?";

  // Email is auth-managed, so it rides along as a read-only row in the
  // Contact card rather than as an editable field.
  const readOnlyRowsById: Record<string, { label: string; value: string; hint?: string }[]> = {
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
        <AvatarUploader userId={user.id} initialSrc={user.avatar_url} name={avatarName} size={72} />
        <div className="min-w-0 flex-1">
          <div className="masthead-context">My profile</div>
          <h1 className="masthead-title truncate">{fullName}</h1>
          <div className="mt-2 text-sm text-[color:var(--text-secondary)]">{user.email ?? "—"}</div>
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

      <ProfileTabs
        initialTab={initialTab}
        personalNeedsAttention={lifecycle.stage === "profile_incomplete"}
        personal={
          <>
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
                      values={{
                        ...sectionValues(row, section.fields),
                        // Not a rendered field — it rides along so the insurance
                        // card knows the policy is open-ended (and when it was
                        // last confirmed).
                        health_insurance_no_expiry: currentInsuranceNoExpiry ? "true" : "",
                        health_insurance_confirmed_at: String(
                          row.health_insurance_confirmed_at ?? ""
                        ).slice(0, 10),
                      }}
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
                            currentNoExpiry={currentInsuranceNoExpiry}
                            providerOptions={insuranceProviderOptions}
                            eligibleProviders={eligibleNoExpiryProviders}
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
                  Your spouse and children. For a spouse we just need their name and email; for
                  children, their passport, visa and health-insurance details. If your spouse has
                  their own Hub account with that email, you both see and edit the same records
                  &mdash; only one of you needs to fill the children in.
                </p>
              </div>
              <HouseholdLinkCard linkedAt={(row.household_linked_at ?? null) as string | null} />
              <div className="rounded-xl border p-4">
                <HouseholdMembers
                  initialMembers={householdMembers}
                  // No "+ Add spouse" unless married; "+ Add child" is
                  // offered for every status.
                  allowedRelationships={
                    canHaveSpouse(row.marital_status) ? ["spouse", "child"] : ["child"]
                  }
                  selfDefaults={{
                    is_international: row.is_international as boolean | null | undefined,
                    visa_category: row.visa_category as string | null | undefined,
                    visa_type: row.visa_type as string | null | undefined,
                    visa_expiry_date: row.visa_expiry_date as string | null | undefined,
                    health_insurance_provider: row.health_insurance_provider as
                      string | null | undefined,
                    health_insurance_policy_number: row.health_insurance_policy_number as
                      string | null | undefined,
                    health_insurance_expiry_date: row.health_insurance_expiry_date as
                      string | null | undefined,
                    health_insurance_no_expiry: row.health_insurance_no_expiry as
                      boolean | null | undefined,
                  }}
                />
              </div>
            </section>

            <section className="space-y-3 px-5 pb-6 md:px-8 md:pb-7">
              <div>
                <p className="page-eyebrow">HUB SETTINGS</p>
                <h2 className="text-xl font-semibold">Appearance</h2>
              </div>
              <AppearanceCard saved={isColorScheme(row.color_scheme) ? row.color_scheme : null} />
            </section>

            <section className="space-y-3 px-5 pb-6 md:px-8 md:pb-7">
              <div>
                <p className="page-eyebrow">DRIVING</p>
                <h2 className="text-xl font-semibold">Driver&rsquo;s licence &amp; passport</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Add your licence and a photo of your passport page once and every vehicle booking
                  fills itself in — no re-typing your details or photographing your documents again.
                  Both are required before you can be added as a driver on a base vehicle.
                </p>
              </div>
              <LicenceCard />
              <PassportPhotoCard />
            </section>
          </>
        }
        work={
          showWorkTab ? (
            <>
              <section className="space-y-3 px-5 py-6 md:px-8 md:py-7">
                <div>
                  <p className="page-eyebrow">STAFF CV</p>
                  <h2 className="text-xl font-semibold">About your role</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Visible to the Leadership Team and to your ministry leader. Your job description
                    is set by your ministry leader.
                  </p>
                </div>
                <StaffCvCard parts="statements" {...cvProps} />
              </section>

              <section className="space-y-3 px-5 pb-6 md:px-8 md:pb-7">
                <div>
                  <p className="page-eyebrow">GOALS</p>
                  <h2 className="text-xl font-semibold">Personal OKRs</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Your own objectives for the current cycle — visible to the same people as your
                    CV. You can add and edit your own.
                  </p>
                </div>
                <PersonalOkrs
                  targetUserId={user.id}
                  cycle={currentCycle ?? null}
                  canManage={Boolean(currentCycle)}
                  ministries={(ownMinistries ?? []) as { id: string; name: string }[]}
                  initialObjectives={okrObjectives ?? []}
                />
              </section>

              <section className="space-y-3 px-5 pb-6 md:px-8 md:pb-7">
                <div>
                  <p className="page-eyebrow">STAFF CV</p>
                  <h2 className="text-xl font-semibold">Skills, training &amp; experience</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Anything added by leadership shows up here too, but only they can change it.
                  </p>
                </div>
                <StaffCvCard parts="entries" categoryOrder={cvCategoryOrder} {...cvProps} />
              </section>
            </>
          ) : undefined
        }
        slack={
          <>
            <section className="space-y-3 px-5 py-6 md:px-8 md:py-7">
              <div>
                <p className="page-eyebrow">NOTIFICATIONS</p>
                <h2 className="text-xl font-semibold">Slack messages</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  The Hub messages you directly in Slack when something happens that you need to
                  know about, rather than adding you to another group channel.
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
          </>
        }
        legal={
          <section className="space-y-3 px-5 py-6 md:px-8 md:py-7">
            <div>
              <p className="page-eyebrow">LEGAL</p>
              <h2 className="text-xl font-semibold">Agreements you&rsquo;ve signed</h2>
              <p className="text-sm text-muted-foreground mt-1">
                The policies and agreements you&rsquo;ve accepted. Open any one to read the full
                text you agreed to, or print / save it as a PDF.
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <AgreementsCard agreements={signedAgreements} />
            </div>
          </section>
        }
        records={
          <section className="space-y-3 px-5 py-6 md:px-8 md:py-7">
            <div>
              <p className="page-eyebrow">RECORDS ON FILE</p>
              <h2 className="text-xl font-semibold">Your attached history</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Past applications, schools attended, payments and documents we have on file for you.
              </p>
            </div>
            <ProfileRecords userId={user.id} canOpenLibrary={false} />
          </section>
        }
      />
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
