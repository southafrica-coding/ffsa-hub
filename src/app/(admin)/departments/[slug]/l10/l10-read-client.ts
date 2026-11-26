/**
 * The few read calls the L10 loaders make on the session client, typed
 * narrowly. 416 / l10_teams is not in the generated Database type yet, so the
 * generated client rejects that table name; this view keeps the call sites
 * typed (no `any`) without editing database.ts. Drop it once the types are
 * regenerated with l10_teams.
 */
export interface L10ReadError {
  message: string;
}

export interface L10ReadQuery<Row> extends PromiseLike<{ count: number | null; error: L10ReadError | null }> {
  eq(column: string, value: string | boolean): L10ReadQuery<Row>;
  maybeSingle(): PromiseLike<{ data: Row | null; error: L10ReadError | null }>;
}

export interface L10ReadClient {
  from<Row>(table: string): {
    select(columns: string, options?: { count?: "exact"; head?: boolean }): L10ReadQuery<Row>;
  };
}

/** The client as an L10ReadClient, or null when it has no `.from` (callers fail closed). */
export function asL10ReadClient(client: unknown): L10ReadClient | null {
  if (typeof client !== "object" || client === null) return null;
  return typeof (client as { from?: unknown }).from === "function" ? (client as L10ReadClient) : null;
}
