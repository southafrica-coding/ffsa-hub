/**
 * Staff ministries whose active members may moderate evangelism.
 *
 * This mirrors the Media/HULC branch of can_moderate_evangelism()
 * (migration 319): an active member of an active ministry whose slug is
 * media or hulk, and only when dept_caller_is_active() is true.
 * service_owners has no evangelism moderate rows, and #564 exposes no
 * view or lookup for this list. If Hub Data adds one, read that instead.
 */
export const EVANGELISM_MODERATOR_SLUGS = ["media", "hulk"] as const;

export function isEvangelismModeratorSlug(slug: string): boolean {
  return (EVANGELISM_MODERATOR_SLUGS as readonly string[]).includes(slug);
}
