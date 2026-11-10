import { NextResponse } from "next/server";

// Shown when Postgres or PostgREST refuses a users UPDATE and the message
// is not one of the trigger's own sentences (column-grant 42501, for example).
export const SELF_EDIT_DENIED_MESSAGE =
  "You can't change that field on your own profile.";

// users_guard_privileged_self_update (migration 315) raises these, and only
// these, with SQLSTATE 42501. They name the rule, not a secret, so they are
// safe to show. Anything else with 42501 falls back to SELF_EDIT_DENIED_MESSAGE.
const SAFE_TRIGGER_MESSAGE = [
  /^Sign in to change an account\.$/,
  /^This account is deactivated\.$/,
  /^You can only change your own account\.$/,
  /^Only an admin can change .+ on an account\.$/,
  /^Only staff choose a department\.$/,
  /^Only an admin can set the department .+\.$/,
  /^Only an admin can change the account status\.$/,
  /^Only an admin can change accepted_at\.$/,
];

export const DEACTIVATED_ACCOUNT_MESSAGE = "This account is deactivated.";

// Role checks (is_admin / has_any_role false, error, or throw). Not used
// when the caller's own account is inactive.
export const PERMISSION_DENIED_MESSAGE = "You don't have permission to do this.";

export function permissionDeniedResponse(): NextResponse {
  return NextResponse.json({ error: PERMISSION_DENIED_MESSAGE }, { status: 403 });
}

type UsersWriteError = {
  code?: string | null;
  message?: string | null;
} | null | undefined;

function isPermissionDenied(error: UsersWriteError): boolean {
  if (!error) return false;
  const message = (error.message ?? "").trim();
  const code = error.code ?? "";
  if (code === "42501" || message.includes("42501")) return true;
  if (/^permission denied\b/i.test(message)) return true;
  return SAFE_TRIGGER_MESSAGE.some((pattern) => pattern.test(message));
}

/**
 * Map a users UPDATE failure to the message a caller should see, or null
 * when the error is not a permission denial. Trigger sentences pass through.
 * PostgREST "permission denied for column …" becomes SELF_EDIT_DENIED_MESSAGE.
 */
export function usersUpdateDenialMessage(error: UsersWriteError): string | null {
  if (!isPermissionDenied(error)) return null;
  const message = (error?.message ?? "").trim();
  if (SAFE_TRIGGER_MESSAGE.some((pattern) => pattern.test(message))) return message;
  return SELF_EDIT_DENIED_MESSAGE;
}

/** 403 response for a permission-denied users update, or null to let the caller handle it. */
export function usersUpdateDeniedResponse(error: UsersWriteError): NextResponse | null {
  const message = usersUpdateDenialMessage(error);
  if (!message) return null;
  return NextResponse.json({ error: message }, { status: 403 });
}
