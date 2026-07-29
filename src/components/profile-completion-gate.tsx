import { createClient } from "@/lib/supabase/server";
import { ProfileCompletionForm } from "./profile-completion-form";
import { ConsentAcceptanceForm } from "./consent-acceptance-form";
import { InsuranceExpiryBanner } from "./insurance-expiry-banner";
import {
  getProfileBlock,
  getInsuranceStatus,
  applyListOptions,
} from "@/lib/users/profile-fields";
import { getAllListOptions, activeSets } from "@/services/list-options";
import { listActiveMinistries } from "@/services/ministries";
import { hasUserConsented, getCurrentConsentAgreement } from "@/services/consent";

// Full-screen blocking overlay: blurs and disables the page behind the panel.
function BlockingOverlay({
  children,
  panel,
}: {
  children: React.ReactNode;
  panel: React.ReactNode;
}) {
  return (
    <div className="relative">
      {/* Blurred background */}
      <div className="pointer-events-none blur-sm opacity-50 select-none" aria-hidden>
        {children}
      </div>
      {/* Blocking overlay */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        {panel}
      </div>
    </div>
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

  // 2) Privacy consent must be on record → blocking accept screen. Fail
  //    open if no agreement is published so we never lock everyone out.
  const consented = await hasUserConsented(supabase, user.id);
  if (!consented) {
    const { data: agreement } = await getCurrentConsentAgreement(supabase);
    if (agreement) {
      return (
        <BlockingOverlay
          panel={
            <ConsentAcceptanceForm
              version={agreement.version}
              title={agreement.title}
            />
          }
        >
          {children}
        </BlockingOverlay>
      );
    }
  }

  // 3) Cleared — non-blocking nudge if insurance is approaching expiry.
  const insurance = getInsuranceStatus(row);
  if (insurance.state === "expiring") {
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
