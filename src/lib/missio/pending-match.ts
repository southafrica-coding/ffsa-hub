/**
 * Phone-only connect matches wait for a pastor.
 *
 * Names are from migration 332 at 252a067d4a0a0fd923c2ef4cb106ca5d307dda19.
 * link_missio_connect_match() RETURNS trigger and takes no arguments.
 * It runs AFTER UPDATE OF matched_contact_id. There is no actor parameter:
 * changed_by is auth.uid(). A service-role update therefore cannot pass
 * the pastor's user id into that row.
 *
 * The schema has no reject status and no function that clears a suggestion
 * and creates a follow-up. Confirm is the only pastor action.
 */

export const CONFIRM_MATCH_FN = "link_missio_connect_match";
export const MATCH_STATUS_PENDING = "pending_confirm";

export type ConnectMatch =
  | { by: "phone" | "email" | "name"; contactId: string }
  | { by: "none" };

/** Display name plus the contact id. No phone and no email. */
export type SuggestedContactLabel = {
  contactId: string;
  displayName: string;
};

/**
 * A phone match does not set matched_contact_id, so the attach trigger
 * does not link that person's follow-up. Email and name matches still do.
 * No match leaves matched_contact_id null and lets the trigger create
 * a follow-up (match_status stays the default, unmatched).
 */
export function connectCardLink(match: ConnectMatch): Record<string, unknown> {
  if (match.by === "phone") {
    return {
      matched_contact_id: null,
      match_status: MATCH_STATUS_PENDING,
      suggested_contact_id: match.contactId,
    };
  }
  if (match.by === "none") return { matched_contact_id: null };
  return { matched_contact_id: match.contactId };
}

export function pendingSuggestion(card: {
  match_status?: string | null;
  suggested_contact_id?: string | null;
} | null): string | null {
  if (card?.match_status !== MATCH_STATUS_PENDING) return null;
  const id = card.suggested_contact_id;
  return id || null;
}

export function suggestedContactLabel(contactId: string, displayName: string | null | undefined): SuggestedContactLabel {
  return { contactId, displayName: displayName?.trim() ?? "" };
}

/** Pending cards stay on the card key. */
export function pendingItemKey(connectResponseId: string): string {
  return `r_${connectResponseId}`;
}
