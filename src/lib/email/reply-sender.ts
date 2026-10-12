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
