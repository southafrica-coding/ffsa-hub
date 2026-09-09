import { getListOptions } from "@/services/list-options";
import {
  INSURANCE_PROVIDERS,
  providerAllowsNoExpiry,
} from "@/lib/profile/options";
import { todayInSA } from "@/lib/users/profile-fields";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ────────────────────────────────────────────────────────────
// SERVER-SIDE NORMALISATION OF AN INSURANCE WRITE
// ────────────────────────────────────────────────────────────
// Every write path (profile update, admin edit, queued successor,
// household members) has to apply the same three rules, so they live
// here rather than being re-typed four times:
//
//   1. A "no expiry" policy is only allowed for a provider on the
//      curated list — never a free-text "Other (specify)" one. The
//      client checkbox is only an affordance; this is the enforcement.
//   2. The flag and the expiry date are mutually exclusive (there is a
//      CHECK constraint behind this — normalising here is what stops a
//      partial save surfacing a raw Postgres error to the user).
//   3. Setting the flag starts the annual re-confirmation clock;
//      clearing it stops it.

export const NO_EXPIRY_NOT_ALLOWED_ERROR =
  "A “no expiry” policy is only available for a listed medical scheme. Please choose your scheme from the list, or enter an expiry date.";

export const NO_EXPIRY_NEEDS_PROVIDER_ERROR =
  "Please choose your medical scheme before marking the policy as never expiring.";

// The provider list as it stands right now. list_options is admin-editable
// at runtime, so a scheme added there must be accepted even though it isn't
// in the bundled constant; an empty/unreachable table falls back to it,
// mirroring applyListOptions.
export async function liveInsuranceProviders(
  supabase: Client
): Promise<{ value: string }[]> {
  const { data } = await getListOptions(supabase, "insurance_provider", {
    activeOnly: true,
  });
  const rows = (data ?? []) as { value: string }[];
  return rows.length > 0 ? rows : INSURANCE_PROVIDERS;
}

// Mutates `data` in place. Returns an error message to send back as a 400,
// or null when the payload is fine.
export async function normalizeInsuranceWrite(
  supabase: Client,
  data: Record<string, unknown>,
  keys: {
    provider: string;
    expiry: string;
    flag: string;
    // Omitted for household members and for the queued (next_*) policy,
    // neither of which carries a confirmation clock of its own.
    confirmedAt?: string;
  }
): Promise<string | null> {
  const flagGiven = keys.flag in data;
  const noExpiry = flagGiven ? Boolean(data[keys.flag]) : false;

  if (flagGiven) data[keys.flag] = noExpiry;

  if (noExpiry) {
    // The provider must travel with the flag — we can't validate a scheme
    // we weren't sent.
    if (!(keys.provider in data)) return NO_EXPIRY_NEEDS_PROVIDER_ERROR;
    const options = await liveInsuranceProviders(supabase);
    if (!providerAllowsNoExpiry(String(data[keys.provider] ?? ""), options)) {
      return NO_EXPIRY_NOT_ALLOWED_ERROR;
    }
    data[keys.expiry] = null;
    if (keys.confirmedAt) data[keys.confirmedAt] = todayInSA();
    return null;
  }

  if (flagGiven && keys.confirmedAt) {
    // Explicitly switched back to a dated policy: the annual clock stops.
    data[keys.confirmedAt] = null;
  }

  // A date arriving without the flag (a partial section save) must clear
  // any stale flag, or the CHECK constraint rejects the write.
  const expiryGiven =
    keys.expiry in data &&
    data[keys.expiry] !== null &&
    String(data[keys.expiry] ?? "").trim() !== "";
  if (expiryGiven && !flagGiven) {
    data[keys.flag] = false;
    if (keys.confirmedAt) data[keys.confirmedAt] = null;
  }

  return null;
}
