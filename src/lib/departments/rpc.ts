// Boolean database functions, called with the signed-in user's client.
// A Postgres error is an access failure: callers answer 403, not 500.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export async function rpcFlag(
  supabase: Client,
  fn: string,
  args?: Record<string, unknown>
): Promise<{ ok: true; value: boolean } | { ok: false }> {
  const { data, error } = args === undefined ? await supabase.rpc(fn) : await supabase.rpc(fn, args);
  if (error) return { ok: false };
  return { ok: true, value: data === true };
}
