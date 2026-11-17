import { missioClient } from "./api";
import type { MissioMe } from "./types-shim";

let cached: Promise<MissioMe | null> | null = null;

/** Drop the cached /api/missio/me result. Call this when the signed-in user changes. */
export function clearMissioMeCache() {
  cached = null;
}

export function loadMissioMe(
  getMe: () => Promise<MissioMe> = () => missioClient.getMe(),
): Promise<MissioMe | null> {
  if (!cached) {
    cached = getMe().catch(() => null);
  }
  return cached;
}
