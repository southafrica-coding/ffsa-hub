// Shared copy and reply routing for referee emails (invite + reminder).
//
// Reply-To is a monitored training inbox, never noreply@. The training
// sending identity's reply_to is the Hub address that receives replies
// (migration 233 copied each identity's old @ffsahub.com From onto reply_to
// and forwards them on). REFERENCE_REPLY_TO is the fallback when that row
// has no usable address. If neither is set, the message is sent with no
// Reply-To rather than pointing replies at noreply@.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const GENERIC_APPLICANT = new Set([
  "the applicant",
  "an applicant",
  "applicant",
  "someone",
]);

/** A provider accepted the message and gave us an id we can match on later. */
export function referenceSendConfirmed(result: {
  ok: boolean;
  id?: string | null;
}): result is { ok: true; id: string } {
  return result.ok === true && typeof result.id === "string" && result.id.length > 0;
}

export function referenceInviteSubject(
  applicantName: string | null | undefined,
  programName: string | null | undefined
): string {
  const program = (programName ?? "").trim() || "the program";
  const name = (applicantName ?? "").trim();
  if (!name || GENERIC_APPLICANT.has(name.toLowerCase())) {
    return `You've been asked to give a reference for ${program}`;
  }
  return `${name} asked you to give a reference for ${program}`;
}

function whoAsked(applicantName: string | null | undefined): string {
  const name = (applicantName ?? "").trim();
  if (!name || GENERIC_APPLICANT.has(name.toLowerCase())) return "Someone";
  return name;
}

function clean(value: string | null | undefined, fallback: string): string {
  const v = (value ?? "").trim();
  return v || fallback;
}

/**
 * Plain-text part for the reference invite. States who asked, the program,
 * the link, and what filling in a reference actually involves.
 */
export function referenceRequestEmailText(input: {
  refereeName?: string | null;
  applicantName?: string | null;
  programName?: string | null;
  slotLabel?: string | null;
  referenceUrl: string;
}): string {
  const referee = clean(input.refereeName, "there");
  const program = clean(input.programName, "the program");
  const slot = clean(input.slotLabel, "reference");
  return [
    `Hi ${referee},`,
    "",
    `${whoAsked(input.applicantName)} asked you to give a ${slot} reference for their application to ${program}.`,
    "",
    "A reference is a short form from someone who knows them — how you know them, and whether you would recommend them for the program. It usually takes a few minutes.",
    "",
    "Complete the reference:",
    input.referenceUrl,
  ].join("\n");
}

/** Plain-text part for the reminder. Same facts as the invite, plus the nudge. */
export function referenceReminderEmailText(input: {
  refereeName?: string | null;
  applicantName?: string | null;
  programName?: string | null;
  slotLabel?: string | null;
  referenceUrl: string;
}): string {
  const referee = clean(input.refereeName, "there");
  const program = clean(input.programName, "the program");
  const slot = clean(input.slotLabel, "reference");
  return [
    `Hi ${referee},`,
    "",
    `Reminder: ${whoAsked(input.applicantName)} asked you to give a ${slot} reference for their application to ${program}, and it hasn't come in yet.`,
    "",
    "A reference is a short form from someone who knows them — how you know them, and whether you would recommend them for the program. It usually takes a few minutes.",
    "",
    "Complete the reference:",
    input.referenceUrl,
  ].join("\n");
}

/** Drop blank values and anything that would send replies to noreply@. */
export function usableReplyTo(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v || !v.includes("@")) return null;
  if (/noreply@/i.test(v)) return null;
  return v;
}

/**
 * Reply-To for referee mail.
 * 1. The active `training` sending identity's reply_to.
 * 2. REFERENCE_REPLY_TO.
 * 3. null — no Reply-To header.
 */
export async function resolveReferenceReplyTo(admin: Client): Promise<string | null> {
  let fromIdentity: string | null = null;
  try {
    const { data } = await admin
      .from("sending_identities")
      .select("reply_to")
      .eq("slug", "training")
      .eq("is_active", true)
      .maybeSingle();
    fromIdentity = (data?.reply_to as string | null | undefined) ?? null;
  } catch {
    fromIdentity = null;
  }
  return usableReplyTo(fromIdentity) ?? usableReplyTo(process.env.REFERENCE_REPLY_TO);
}
