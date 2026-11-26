/** 419's helper isn't in the generated Database types until they are regenerated. */
export const SONG_LIBRARY_MANAGE_RPC = "song_library_can_manage";

type RpcClient = { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> };

export async function callerCanManageSongLibrary(client: unknown): Promise<{ data: unknown; error: unknown }> {
  return (client as RpcClient).rpc(SONG_LIBRARY_MANAGE_RPC);
}

/**
 * Managers are whoever 419's song_library_can_manage returns true for.
 * If the RPC isn't there yet, the viewer's membership in the owning
 * department decides; the database still enforces the rule on every write.
 */
export function canManageFromRpc(rpc: { data: unknown; error: unknown }, ownerMembership: string | undefined): boolean {
  return rpc.error ? (ownerMembership ?? "none") !== "none" : rpc.data === true;
}
