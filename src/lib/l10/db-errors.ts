// Telling 416's named database errors apart. PostgREST passes the RAISE
// message through as error.message, and a unique clash names its index there.

export type DbError = { code?: string; message?: string; details?: string } | null | undefined;

/** A 23505 on the given unique index. */
export function isUniqueClash(error: DbError, index: string): boolean {
  return error?.code === "23505" && `${error.message ?? ""} ${error.details ?? ""}`.includes(index);
}

/** A RAISE with this SQLSTATE and message (e.g. 42501 l10_auto_headline_locked). */
export function isRaised(error: DbError, code: string, message: string): boolean {
  return error?.code === code && (error.message ?? "").includes(message);
}
