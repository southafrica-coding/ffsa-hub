/**
 * Phone-only connect matches will wait for a pastor instead of attaching.
 *
 * Hub Data has not sent the column names, the status value, or the
 * argument names of link_missio_connect_match. PENDING_MATCH stays null
 * until those arrive. Do not invent them. While it is null, a phone
 * match still sets matched_contact_id, which is what the current
 * trigger attaches on.
 *
 * Filling PENDING_MATCH is the switch:
 * - public insert leaves matched_contact_id null and writes the pending
 *   columns, so the card is not attached
 * - the list reads needsConfirm from the status column
 * - POST …/confirm-match calls the RPC with the named arguments
 */

export const CONFIRM_MATCH_RPC = "link_missio_connect_match";

export type PendingMatchContract = {
  /** Column that holds the pending status. Not guessed. */
  statusColumn: string;
  /** Value that means a pastor still has to confirm. Not guessed. */
  needsConfirmStatus: string;
  /** Suggested Missio contact. This is not matched_contact_id. Not guessed. */
  suggestedContactColumn: string;
  /** RPC argument for the connect card id. Not guessed. */
  cardIdParam: string;
  /** RPC argument for the suggested contact id. Not guessed. */
  contactIdParam: string;
};

/** Null until Hub Data sends the names. The confirm route will not call the RPC before that. */
export const PENDING_MATCH: PendingMatchContract | null = null;

export type ConnectMatch =
  | { by: "phone" | "email" | "name"; contactId: string }
  | { by: "none" };

/** Display name only. Phone, email, and the contact id do not belong on this object. */
export type SuggestedContactLabel = {
  displayName: string;
};

export function pendingSelectColumns(contract: PendingMatchContract | null = PENDING_MATCH): string | null {
  if (!contract) return null;
  return `${contract.statusColumn}, ${contract.suggestedContactColumn}`;
}

/**
 * Columns written on the public card. Email and name matches still set
 * matched_contact_id. A phone match does that only while the contract
 * is null. A filled contract stores the suggestion and does not attach.
 */
export function connectCardLink(
  match: ConnectMatch,
  contract: PendingMatchContract | null = PENDING_MATCH
): Record<string, unknown> {
  if (match.by === "none") return { matched_contact_id: null };
  if (match.by !== "phone" || !contract) return { matched_contact_id: match.contactId };
  return {
    matched_contact_id: null,
    [contract.statusColumn]: contract.needsConfirmStatus,
    [contract.suggestedContactColumn]: match.contactId,
  };
}

export function readPendingContactId(
  row: Record<string, unknown>,
  contract: PendingMatchContract | null = PENDING_MATCH
): string | null {
  if (!contract) return null;
  if (row[contract.statusColumn] !== contract.needsConfirmStatus) return null;
  const id = row[contract.suggestedContactColumn];
  return typeof id === "string" && id ? id : null;
}

export function suggestedContactLabel(displayName: string | null | undefined): SuggestedContactLabel | null {
  const name = displayName?.trim();
  if (!name) return null;
  return { displayName: name };
}

/** Pending cards stay on the card key. The suggested contact does not turn the row into c_. */
export function pendingItemKey(connectResponseId: string): string {
  return `r_${connectResponseId}`;
}

export function confirmMatchRpcArgs(
  contract: PendingMatchContract,
  cardId: string,
  contactId: string
): Record<string, string> {
  return {
    [contract.cardIdParam]: cardId,
    [contract.contactIdParam]: contactId,
  };
}
