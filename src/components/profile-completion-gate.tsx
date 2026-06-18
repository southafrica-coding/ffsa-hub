import { createClient } from "@/lib/supabase/server";
import { ProfileCompletionForm } from "./profile-completion-form";
import { InsuranceExpiryBanner } from "./insurance-expiry-banner";
import { getProfileBlock, getInsuranceStatus } from "@/lib/users/profile-fields";

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

  // What (if anything) hard-blocks the Hub: missing required fields or a
  // lapsed/invalid health-insurance policy.
  const block = getProfileBlock(row);

  if (!block) {
    // Not blocked — but nudge if insurance is approaching expiry.
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

  // For an expired/invalid policy, pre-fill the provider + policy number
  // (a renewal usually keeps them) but leave the expiry blank so they must
  // enter a fresh date. A legacy "none" provider is cleared so they pick a
  // real one.
  const provider = String(row.health_insurance_provider ?? "");
  const defaults =
    block.reason === "insurance_expired"
      ? {
          health_insurance_provider:
            provider.toLowerCase() === "none" ? "" : provider,
          health_insurance_policy_number: String(
            row.health_insurance_policy_number ?? ""
          ),
        }
      : undefined;

  // Blocked — show the completion form over a blurred, inert page.
  return (
    <div className="relative">
      {/* Blurred background */}
      <div className="pointer-events-none blur-sm opacity-50 select-none" aria-hidden>
        {children}
      </div>

      {/* Blocking overlay */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <ProfileCompletionForm
          fields={block.fields}
          reason={block.reason}
          defaults={defaults}
        />
      </div>
    </div>
  );
}
