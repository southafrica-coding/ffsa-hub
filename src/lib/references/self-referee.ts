// A referee must be someone other than the applicant. Comparison is exact
// after trim and lowercase: plus-tags and dots stay, so ada+ref@x.com is
// not the same address as ada@x.com.

export const SELF_REFEREE_MESSAGE =
  "A referee can't use your own email address. Please enter your referee's email.";

export const REFEREE_OTHER_PERSON_HINT =
  "The referee must be someone else, with their own email.";

export function comparableEmail(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

export function isSelfReferee(
  refereeEmail: string | null | undefined,
  applicantEmails: Array<string | null | undefined>
): boolean {
  const referee = comparableEmail(refereeEmail);
  if (!referee) return false;
  return applicantEmails.some((candidate) => {
    const applicant = comparableEmail(candidate);
    return applicant.length > 0 && applicant === referee;
  });
}

type RefereeEntry = {
  slot_id?: string | null;
  referee_name?: string | null;
  referee_email?: string | null;
};

/**
 * The 400 message for one submit. A single referee gets the plain sentence.
 * Several referees are named so the applicant can see which entry failed.
 */
export function selfRefereeError(
  references: RefereeEntry[],
  applicantEmails: Array<string | null | undefined>,
  slots?: Array<{ id: string; label?: string | null }>
): string | null {
  const labels = new Map(
    (slots ?? []).map((slot) => [slot.id, (slot.label ?? "").trim()])
  );
  const named = references.length > 1;
  const failures: string[] = [];
  for (let i = 0; i < references.length; i++) {
    const ref = references[i];
    if (!isSelfReferee(ref?.referee_email, applicantEmails)) continue;
    if (!named) return SELF_REFEREE_MESSAGE;
    const slotLabel = ref?.slot_id ? labels.get(ref.slot_id) : "";
    const name = typeof ref?.referee_name === "string" ? ref.referee_name.trim() : "";
    const entry = slotLabel || name || `Referee ${i + 1}`;
    failures.push(`${entry}: ${SELF_REFEREE_MESSAGE}`);
  }
  if (failures.length === 0) return null;
  return failures.join(" ");
}

type ApplicantEmailSource = {
  applicant_email?: string | null;
  applicant_info?: unknown;
  users?: { email?: string | null } | Array<{ email?: string | null } | null> | null;
  auth_email?: string | null;
} | null;

/** Emails that identify the applicant: the response, its info blob, and the linked user. */
export function collectApplicantEmails(source: ApplicantEmailSource): string[] {
  if (!source) return [];
  const info = source.applicant_info;
  const infoEmail =
    info && typeof info === "object" && !Array.isArray(info)
      ? (info as { email?: unknown }).email
      : null;
  const users = source.users;
  const userRow = Array.isArray(users) ? users.find((row) => row) : users;
  const values = [
    source.applicant_email,
    typeof infoEmail === "string" ? infoEmail : null,
    userRow?.email,
    source.auth_email,
  ];
  return values.filter((value): value is string => typeof value === "string");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const APPLICANT_EMAIL_SELECT =
  "applicant_email, applicant_info, user_id, users!application_responses_user_id_fkey(email)";

async function linkedUserAuthEmail(supabase: Client, userId: unknown): Promise<string | null> {
  if (typeof userId !== "string" || userId.length === 0) return null;
  const getUserById = supabase?.auth?.admin?.getUserById;
  if (typeof getUserById !== "function") return null;
  try {
    const { data, error } = await getUserById.call(supabase.auth.admin, userId);
    if (error) return null;
    const email = data?.user?.email;
    return typeof email === "string" ? email : null;
  } catch {
    return null;
  }
}

/**
 * Every email the applicant is known by for one application.
 * A read error fails closed: callers must not write a referee address
 * they could not compare.
 */
export async function loadApplicantEmails(
  supabase: Client,
  applicationId: string
): Promise<{ emails: string[]; error: string | null }> {
  const { data, error } = await supabase
    .from("application_responses")
    .select(APPLICANT_EMAIL_SELECT)
    .eq("id", applicationId)
    .maybeSingle();
  if (error) {
    return { emails: [], error: error.message ?? "Could not read the applicant email." };
  }
  if (!data) return { emails: [], error: "Application not found." };
  const emails = collectApplicantEmails(data);
  const authEmail = await linkedUserAuthEmail(supabase, data.user_id);
  if (authEmail) emails.push(authEmail);
  return { emails, error: null };
}
