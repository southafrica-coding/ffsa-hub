/**
 * Starter serving teams Jack picked (24 Nov 2026), in this order. Added only
 * when a pastor taps "Add starter teams" on Volunteers. Never seeded in SQL
 * and never on page load.
 */
export const STARTER_TEAMS = ["Sound", "Worship", "Kids", "Welcome", "Production", "Hospitality"] as const;

export function teamNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The starter names the org doesn't have yet (trimmed, any case), in order. */
export function missingStarterTeams(existing: ReadonlyArray<string>): string[] {
  const have = new Set(existing.map(teamNameKey));
  return STARTER_TEAMS.filter((name) => !have.has(teamNameKey(name)));
}
