import { createClient } from "@/lib/supabase/server";
import { ProfileCompletionForm } from "./profile-completion-form";
import { RequiredAgreementsForm } from "./required-agreements-form";
import { InsuranceExpiryBanner } from "./insurance-expiry-banner";
import { ChildrenGateForm } from "./profile/children-gate-form";
import { HouseholdLinkConfirmForm } from "./profile/household-link-confirm-form";
import { GateOverlay } from "./profile/gate-overlay";
import type { HouseholdMember } from "./profile/household-members";
import {
  getProfileBlock,
  getInsuranceStatus,
  hasValidQueuedPolicy,
  getChildrenBlock,
  applyListOptions,
} from "@/lib/users/profile-fields";
import { getAllListOptions, activeSets } from "@/services/list-options";
import { listActiveMinistries } from "@/services/ministries";
import { getHouseholdMembers, getHousehold } from "@/services/household";
import { getHouseholdLinkState } from "@/services/household-link";
import { getOutstandingConsents } from "@/services/consent";

// True if the user counts as staff — either their self-signup type is
// 'staff' or they hold the 'staff' role. Scopes the children gate to staff.
// Fail-closed (not staff) on a role-read error so students/community are
// never wrongly prompted.
async function userIsStaff(
  supabase: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  userId: string,
  row: Record<string, unknown>
): Promise<boolean> {
  if (row.signup_type === "staff") return true;
  const { data, error } = await supabase
    .from("user_roles")
    .select("roles!inner(name)")
    .eq("user_id", userId)
    .eq("roles.name", "staff")
    .limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

// Full-screen blocking overlay: blurs and disables the page behind the panel.
function BlockingOverlay({
  children,
  panel,
}: {
  children: React.ReactNode;
  panel: React.ReactNode;
}) {
  return (
    <>
      {/* The page stays mounted but is fully hidden behind the opaque
          full-screen GateOverlay (portalled to <body>). */}
      <div className="pointer-events-none select-none" aria-hidden>
        {children}
      </div>
      <GateOverlay>{panel}</GateOverlay>
    </>
  );
}

export async function ProfileCompletionGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not logged in — let the page render (middleware handles redirects)
  if (!user) return <>{children}</>;

  // Fetch user profile
  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  // No profile record yet (still in onboarding) — don't block
  if (!profile) return <>{children}</>;

  // NOTE: we used to bail when `accepted_at` was null on the assumption
  // that the user was still being shepherded through /onboarding. But
  // the onboarding page lives in the (auth) route group with no layout,
  // so the gate is not mounted there — the bail can only mis-fire for
  // seeded super admins (created directly in the DB, never went through
  // onboarding), leaving their required-field collection silently
  // skipped. Always gate; if onboarding ever wraps gate-bearing routes,
  // re-add the check there.

  const row = profile as Record<string, unknown>;

  // 1) Missing required fields (incl. passport/visa for international
  //    staff) or a lapsed/invalid health-insurance policy → field form.
  const block = getProfileBlock(row);
  if (block) {
    // For an expired/invalid policy, pre-fill the provider + policy number
    // (a renewal usually keeps them) but leave the expiry blank so they
    // must enter a fresh date. A legacy "none" provider is cleared so they
    // pick a real one.
    const provider = String(row.health_insurance_provider ?? "");
    let defaults: Record<string, string> | undefined;
    if (block.reason === "insurance_expired") {
      defaults = {
        health_insurance_provider:
          provider.toLowerCase() === "none" ? "" : provider,
        health_insurance_policy_number: String(
          row.health_insurance_policy_number ?? ""
        ),
      };
    } else if (
      // Passport is now required for everyone. A South African being asked
      // for it for the first time shouldn't have to hunt for their country —
      // default it to South Africa (international staff pick their own).
      block.fields.some((f) => f.field === "passport_country") &&
      !row.is_international &&
      !row.passport_country
    ) {
      defaults = { passport_country: "South Africa" };
    }

    // Department options come live from the Ministry tab (staff_ministries),
    // overriding any list_options department rows.
    const { data: lists } = await getAllListOptions(supabase);
    const sets = activeSets(lists);
    const { data: mins } = await listActiveMinistries(supabase);
    if (mins?.length) {
      sets.department = mins.map(
        (m: { slug: string; name: string }) => ({ value: m.slug, label: m.name })
      );
    }
    const fields = applyListOptions(block.fields, sets);

    return (
      <BlockingOverlay
        panel={
          <ProfileCompletionForm
            fields={fields}
            reason={block.reason}
            defaults={defaults}
          />
        }
      >
        {children}
      </BlockingOverlay>
    );
  }

  // 1a) Pending household match — someone already on the Hub entered this
  //     person as their spouse using this email (migration 181). Nothing of
  //     that household is readable until they confirm here, so this runs
  //     BEFORE the family gate: a "yes" means they inherit the family and
  //     never see the spouse/children questions at all.
  const pendingHouseholdId = (row.pending_household_id ?? null) as string | null;
  if (pendingHouseholdId && row.household_link_declined_at == null) {
    const linkState = await getHouseholdLinkState(pendingHouseholdId);
    if (linkState) {
      const { data: ownMembers } = await getHouseholdMembers(supabase, user.id);
      return (
        <BlockingOverlay
          panel={
            <HouseholdLinkConfirmForm
              displayName={linkState.displayName}
              hasOwnFamilyData={(ownMembers?.length ?? 0) > 0}
            />
          }
        >
          {children}
        </BlockingOverlay>
      );
    }
  }

  // 1b) Children gate — STAFF only. On next login every staff member must
  //     answer "Do you have children?"; a "yes" then requires at least one
  //     fully-complete child record before the Hub unblocks. Students /
  //     community members are never prompted. Spouse/dependent records don't
  //     count and never block.
  const isStaff = await userIsStaff(supabase, user.id, row);
  if (isStaff) {
    // has_children lives on the HOUSEHOLD since migration 181, so a spouse
    // who linked to an existing household inherits the answer and is never
    // asked again.
    const { data: household } = await getHousehold(supabase, user.id);
    const hasChildren = ((household as { has_children?: boolean | null } | null)
      ?.has_children ?? null) as boolean | null;
    const { data: householdRows } = await getHouseholdMembers(supabase, user.id, {
      excludeLinkedUserId: user.id,
    });
    const members = (householdRows ?? []) as Array<Record<string, unknown>>;
    const unanswered = hasChildren == null;
    const childrenBlock = getChildrenBlock(hasChildren, members);
    if (unanswered || childrenBlock) {
      return (
        <BlockingOverlay
          panel={
            <ChildrenGateForm
              hasChildren={hasChildren}
              members={(householdRows ?? []) as HouseholdMember[]}
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
          }
        >
          {children}
        </BlockingOverlay>
      );
    }
  }

  // 2) Required policy agreements must all be on record → blocking screen.
  //    Everyone signs Privacy + Child Protection; staff also sign the NDA.
  //    Each is version-keyed, so a NEW policy (or a new version) re-prompts
  //    the right people automatically. Fail-open if nothing is outstanding.
  const outstanding = await getOutstandingConsents(supabase, user.id, isStaff);
  if (outstanding.length > 0) {
    return (
      <BlockingOverlay
        panel={
          <RequiredAgreementsForm
            agreements={outstanding.map((o) => ({
              kind: o.kind,
              version: o.agreement.version,
              title: o.agreement.title,
            }))}
          />
        }
      >
        {children}
      </BlockingOverlay>
    );
  }

  // 3) Cleared — non-blocking nudge if insurance is approaching expiry. Skip it
  //    when a valid successor policy is already queued: it auto-takes-over the
  //    day after this one lapses, so they won't lose access and don't need nudging.
  const insurance = getInsuranceStatus(row);
  if (insurance.state === "expiring" && !hasValidQueuedPolicy(row)) {
    return (
      <>
        <InsuranceExpiryBanner
          expiryDate={insurance.expiryDate ?? ""}
          daysLeft={insurance.daysLeft ?? 0}
          defaults={{
            health_insurance_provider: String(
              row.health_insurance_provider ?? ""
            ),
            health_insurance_policy_number: String(
              row.health_insurance_policy_number ?? ""
            ),
            health_insurance_expiry_date: String(
              row.health_insurance_expiry_date ?? ""
            ).slice(0, 10),
          }}
        />
        {children}
      </>
    );
  }

  return <>{children}</>;
}
