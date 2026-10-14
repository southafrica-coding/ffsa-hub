// Who a Hub Inbox reply is sent as (migration 229). Shared by the sender and
// the composer's "Sending as …" line, so the preview can't drift from what
// actually goes out. Kept free of server-only imports for the client.

export function replySender(
  identity: { from_email: string; from_name: string; reply_from_email: string | null },
  staffFirstName: string | null
): { email: string; name: string } {
  const team = identity.from_name.replace(/[<>"]/g, "");
  return {
    email: (identity.reply_from_email?.trim() || identity.from_email).toLowerCase(),
    name: staffFirstName ? `${staffFirstName.replace(/[<>"]/g, "")} · ${team}` : team,
  };
}

/** The domain Resend receives for the Hub (migration 228). */
export const HUB_RECEIVING_DOMAIN = "ffsahub.com";

/**
 * The address on this identity that the Hub actually receives, i.e. where a
 * reply has to go to land in the Inbox. Identities may send From a staff
 * domain the Hub can't receive (admin@ffsouthafrica.com is Google Workspace)
 * and keep their ffsahub.com address as Reply-To — so check reply_to first,
 * then from_email. Falls back to whatever is set if neither is ours.
 */
export function hubReceivingAddress(identity: {
  from_email: string;
  reply_to: string | null;
}): string {
  const candidates = [identity.reply_to, identity.from_email]
    .filter((a): a is string => !!a && a.includes("@"))
    .map((a) => a.trim().toLowerCase());
  return (
    candidates.find((a) => a.endsWith(`@${HUB_RECEIVING_DOMAIN}`)) ??
    candidates[0] ??
    identity.from_email
  );
}
