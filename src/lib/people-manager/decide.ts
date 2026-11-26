// The first decision wins.
//
// A decision is one UPDATE … WHERE id = $1 AND status = 'pending'
// RETURNING. Postgres takes the row lock, so of two clicks at the same time
// (two leaders in Slack, or Slack and the Hub) the second re-checks
// status = 'pending' after the first commits, matches no row and gets
// nothing back: it changes nothing and is told who decided. 421's guard
// backs this up (leave_request_already_decided on any pending -> decided
// change that is not from pending) and stamps decided_by / decided_at.
//
// Works with the session client (the Hub: RLS and the guard check the
// caller) or the service role (Slack: the guard checks decided_by with the
// p_user rule, so the clicker must still be an eligible approver).

import type { LeaveRequest } from "./db.types";
import { LEAVE_REQUEST_COLUMNS, LEAVE_TABLES } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type DecideOutcome =
  | { outcome: "decided"; request: LeaveRequest }
  | { outcome: "already-decided"; request: LeaveRequest }
  | { outcome: "not-found" }
  | { outcome: "error"; error: { code?: string; message?: string } };

export async function decideLeaveRequest(
  client: Client,
  input: { requestId: string; deciderId: string; decision: "approved" | "declined"; note: string | null; now?: Date }
): Promise<DecideOutcome> {
  const stamp = (input.now ?? new Date()).toISOString();
  const won = await client
    .from(LEAVE_TABLES.requests)
    // decided_by / decided_at are overwritten by 421's guard (auth.uid() for
    // a session, decided_by checked for the service role); sent so the
    // service-role path names the decider.
    .update({ status: input.decision, decision_note: input.note, decided_by: input.deciderId, decided_at: stamp, updated_at: stamp })
    .eq("id", input.requestId)
    .eq("status", "pending")
    .select(LEAVE_REQUEST_COLUMNS);
  if (won.error) return { outcome: "error", error: won.error };
  const row = ((won.data ?? []) as LeaveRequest[])[0];
  if (row) return { outcome: "decided", request: row };

  const now = await client.from(LEAVE_TABLES.requests).select(LEAVE_REQUEST_COLUMNS).eq("id", input.requestId).maybeSingle();
  if (now.error) return { outcome: "error", error: now.error };
  if (!now.data) return { outcome: "not-found" };
  return { outcome: "already-decided", request: now.data as LeaveRequest };
}
