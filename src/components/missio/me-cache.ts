import { missioClient } from "./api";
import type { MissioMe } from "./types-shim";

let cached: Promise<MissioMe | null> | null = null;

/** Drop the cached /api/missio/me result. Call this when the signed-in user changes. */
export function clearMissioMeCache() {
  cached = null;
}

type AuthEvents = {
  onAuthStateChange?: (
    callback: (event: string) => void,
  ) => { data: { subscription: { unsubscribe: () => void } } };
};

/**
 * Clear the cache when Supabase reports sign-out. If this client has no
 * auth listener, the caller keeps the sign-out form as a fallback.
 */
export function subscribeMissioSignOut(auth: AuthEvents | null | undefined, onSignedOut: () => void): () => void {
  if (!auth || typeof auth.onAuthStateChange !== "function") return () => {};
  const { data } = auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") onSignedOut();
  });
  return () => data.subscription.unsubscribe();
}

export function loadMissioMe(
  getMe: () => Promise<MissioMe> = () => missioClient.getMe(),
): Promise<MissioMe | null> {
  if (!cached) {
    cached = getMe().catch(() => null);
  }
  return cached;
}
