/**
 * House-church error contract for Hub UI.
 * The response uses one of these codes and a fixed message.
 * Database message, details, and hint never leave this file.
 */
export const HOUSE_CHURCH_ERROR_CODES = [
  "invalid_input",
  "not_missio_person",
  "not_found",
  "already_member",
  "already_resolved",
  "membership_not_current",
  "ended_at_in_future",
  "unauthenticated",
  "forbidden",
  "rate_limited",
  "server_error",
] as const;

export type HouseChurchErrorCode = (typeof HOUSE_CHURCH_ERROR_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set(HOUSE_CHURCH_ERROR_CODES);

export function isHouseChurchErrorCode(code: string): code is HouseChurchErrorCode {
  return CODE_SET.has(code);
}

export type DbErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export type MappedDbError = {
  status: 400 | 409 | 500;
  code: HouseChurchErrorCode;
  error: string;
  fieldErrors?: Record<string, string>;
};

const NOT_MISSIO: MappedDbError = {
  status: 400,
  code: "not_missio_person",
  error: "This person is not in Missio.",
};

const ENDED_IN_FUTURE: MappedDbError = {
  status: 409,
  code: "ended_at_in_future",
  error: "That end date is after today.",
};

const SERVER: MappedDbError = {
  status: 500,
  code: "server_error",
  error: "Something went wrong.",
};

const NOT_IN_ORG = [
  "missio_member_not_in_org",
  "missio_contact_not_in_org",
  "missio_user_not_in_org",
  "missio_resolve_not_allowed",
];

const FUTURE_START: MappedDbError = {
  status: 400,
  code: "invalid_input",
  error: "Check the fields and try again.",
  fieldErrors: { startedAt: "Check this field and try again." },
};

export function mapMissioDbError(error: DbErrorLike): MappedDbError {
  const message = error.message ?? "";
  if (error.code === "23503" && NOT_IN_ORG.some((name) => message.includes(name))) return NOT_MISSIO;
  if (error.code === "23514" && message.includes("missio_started_at_in_future")) return FUTURE_START;
  if (error.code === "23514" && message.includes("missio_ended_at_in_future")) return ENDED_IN_FUTURE;
  return SERVER;
}

const FIELD_MESSAGE = "Check this field and try again.";

/** invalid_input. fieldErrors maps a field path to our message. Never the submitted value or Zod text. */
export function invalidInput(fieldErrors: Record<string, string> = {}): {
  status: 400;
  code: "invalid_input";
  error: string;
  fieldErrors: Record<string, string>;
} {
  const cleaned: Record<string, string> = {};
  for (const [path, message] of Object.entries(fieldErrors)) {
    const key = path.trim();
    if (!key) continue;
    cleaned[key] = message.trim() || FIELD_MESSAGE;
  }
  return {
    status: 400,
    code: "invalid_input",
    error: "Check the fields and try again.",
    fieldErrors: cleaned,
  };
}

export function fieldError(path: string): Record<string, string> {
  return { [path]: FIELD_MESSAGE };
}
