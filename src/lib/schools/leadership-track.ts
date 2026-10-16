// Leadership Track is recognised by its school code, not its name, so a
// rename can't break it (same rule as migration 237's invoice emails).
export const LEADERSHIP_TRACK_CODES = ["L-TRACK", "TRACK"] as const;

export function isLeadershipTrackCode(code: string | null | undefined): boolean {
  return !!code && (LEADERSHIP_TRACK_CODES as readonly string[]).includes(code.toUpperCase());
}
