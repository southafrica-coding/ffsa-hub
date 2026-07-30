import { upsertContactWithDedup } from "@/services/contact-upsert";
import { getLabelBySlug } from "@/services/labels";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// The preset label (seeded in migration 145) applied to every applicant so
// they form one clean segment in the CRM.
const FFSA_FAMILY_LABEL_SLUG = "ffsa-family";

export type SyncApplicantInput = {
  email: string | null | undefined;
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  nationality?: string | null;
  homeCountry?: string | null;
  /** Staff/portal user performing the apply, or null for anonymous public applies. */
  userId: string | null;
  programId: string;
  /** Human-friendly program code for source attribution; falls back to programId. */
  programCode?: string | null;
  applicationId: string;
};

/**
 * Upsert an applicant into the CRM contact base, deduplicated by email, and
 * tag them with the "FFSA Family" label. Reuses upsertContactWithDedup() — the
 * same email-first dedup engine used by public forms and event ticketing — so a
 * repeat applicant (or someone already in the CRM) is matched to their existing
 * contact rather than duplicated.
 *
 * Requires a service-role (admin) client: the contact may not yet exist for the
 * requesting auth user, and public applies have no auth user at all.
 *
 * Best-effort: callers should fire-and-forget and never fail an application on
 * a contact-sync error.
 */
export async function syncApplicantToContact(
  admin: Client,
  input: SyncApplicantInput
): Promise<{ data: unknown; error: unknown }> {
  const email = input.email?.trim();
  if (!email) {
    // Email is the dedup key and the marketing address. Without it we can't
    // dedup safely, so skip contact creation rather than fork an orphan row.
    return { data: null, error: null };
  }

  // contacts.first_name / last_name are NOT NULL — fall back sensibly when the
  // application didn't capture a name.
  const firstName = input.firstName?.trim() || email.split("@")[0];
  const lastName = input.lastName?.trim() || "";

  const { data: label } = await getLabelBySlug(admin, FFSA_FAMILY_LABEL_SLUG);
  const labelId = (label as { id?: string } | null)?.id ?? null;

  return upsertContactWithDedup(admin, {
    contact: {
      first_name: firstName,
      last_name: lastName,
      email,
      nationality: input.nationality?.trim() || null,
      country: input.homeCountry?.trim() || null,
    },
    labelId,
    addedVia: `application:${input.applicationId}`,
    userId: input.userId,
    source: `application:${input.programCode ?? input.programId}`,
    reviewSource: { type: "manual", id: input.applicationId },
  });
}
