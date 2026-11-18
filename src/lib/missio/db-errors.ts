import type { MissioErrorCode } from "@/lib/missio/types";

/**
 * One mapper for Postgres errors raised by migration 331.
 * The response is a fixed message. message, details, and hint never leave this function.
 */
export type DbErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export type MappedDbError = {
  status: 400 | 409 | 500;
  code: MissioErrorCode;
  error: string;
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

const NOT_IN_ORG = ["missio_member_not_in_org", "missio_contact_not_in_org", "missio_resolve_not_allowed"];

export function mapMissioDbError(error: DbErrorLike): MappedDbError {
  const message = error.message ?? "";
  if (error.code === "23503" && NOT_IN_ORG.some((name) => message.includes(name))) return NOT_MISSIO;
  if (error.code === "23514" && message.includes("missio_ended_at_in_future")) return ENDED_IN_FUTURE;
  return SERVER;
}

/** Zod and other input failures. Field paths only, plus this message. Never the submitted value. */
export function invalidInput(fieldPaths: string[] = []): { status: 400; code: "invalid_input"; error: string; fields?: string[] } {
  const body: { status: 400; code: "invalid_input"; error: string; fields?: string[] } = {
    status: 400,
    code: "invalid_input",
    error: "Check the fields and try again.",
  };
  const fields = [...new Set(fieldPaths.map((path) => path.trim()).filter(Boolean))];
  if (fields.length > 0) body.fields = fields;
  return body;
}
