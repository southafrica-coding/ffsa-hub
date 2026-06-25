import { createClient } from "@/lib/supabase/server";
import { ProfileCompletionForm } from "./profile-completion-form";
import { ConsentAcceptanceForm } from "./consent-acceptance-form";
import { InsuranceReconfirmPanel } from "./insurance-reconfirm-panel";
import { getProfileBlock } from "@/lib/users/profile-fields";
import { INSURANCE_PROVIDERS } from "@/lib/profile/options";
import { hasUserConsented, getCurrentConsentAgreement } from "@/services/consent";

// Map a stored provider value to its human label (a custom "Other" value is
// stored verbatim, so fall back to the raw string).
function insuranceProviderLabel(value: string): string {
  return INSURANCE_PROVIDERS.find((o) => o.value === value)?.label ?? value;
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

  // 1) Missing required fields (incl. passport/visa for international staff),
  //    no valid provider on file, or a lapsed 6-monthly cover confirmation.
  const block = getProfileBlock(row);
  if (block) {
    const providerRaw = String(row.health_insurance_provider ?? "");
    const policyNumber = String(row.health_insurance_policy_number ?? "");

    // Cover is on file but the periodic confirmation has lapsed → one-click
    // re-confirm panel (Yes keeps it; No opens the form to edit the details).
    if (block.reason === "insurance_confirm") {
      return (
        <BlockingOverlay
          panel={
            <InsuranceReconfirmPanel
              providerLabel={insuranceProviderLabel(providerRaw)}
              policyNumber={policyNumber}
              defaults={{
                health_insurance_provider: providerRaw,
                health_insurance_policy_number: policyNumber,
              }}
            />
          }
        >
          {children}
        </BlockingOverlay>
      );
    }

    // A legacy "none" provider must be swapped for a real one — pre-fill the
    // policy number (usually kept) and blank the provider so they re-pick.
    const defaults =
      providerRaw.toLowerCase() === "none"
        ? {
            health_insurance_provider: "",
            health_insurance_policy_number: policyNumber,
          }
        : undefined;

    return (
      <BlockingOverlay
        panel={
          <ProfileCompletionForm
            fields={block.fields}
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

  // Cleared — re-confirmation is enforced as a hard block above (a single
  // click clears it), so there's no separate pre-due banner.
  return <>{children}</>;
}
