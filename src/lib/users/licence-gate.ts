/**
 * Has this person answered the licence gate, and is their answer complete?
 *
 * One rule, used by the gate (to decide whether to block), the save endpoint
 * (to decide whether to accept) and the profile card (to show what's still
 * missing). Three copies of this logic would drift.
 */

export type LicenceKind = "sa" | "international" | "none";

export type LicenceGateRow = {
  licence_kind?: string | null;
  licence_declared_at?: string | null;
  drivers_licence_number?: string | null;
  licence_country?: string | null;
  licence_expiry_date?: string | null;
  licence_no_expiry?: boolean | null;
  licence_file_url?: string | null;
};

export type LicenceGateBlock = {
  reason: "never_asked" | "incomplete";
  /** Human-readable list of what's still outstanding. */
  missing: string[];
};

/**
 * What's missing from a licence declaration, or null when it's complete.
 *
 * 'none' is a complete answer on its own: someone who doesn't hold a licence
 * has nothing further to give, and the point of the gate is to know, not to
 * force everyone to produce a card they may not have.
 */
export function getLicenceBlock(row: LicenceGateRow): LicenceGateBlock | null {
  const kind = (row.licence_kind ?? null) as LicenceKind | null;

  if (!kind || !row.licence_declared_at) {
    return { reason: "never_asked", missing: [] };
  }
  if (kind === "none") return null;

  const missing: string[] = [];
  if (!row.drivers_licence_number?.trim()) missing.push("licence number");
  if (kind === "international" && !row.licence_country?.trim()) {
    missing.push("issuing country");
  }
  // A licence with no printed expiry is a real thing in some countries, so
  // the flag stands in for the date — but one of the two must be present.
  if (!row.licence_no_expiry && !row.licence_expiry_date) {
    missing.push("expiry date");
  }
  if (!row.licence_file_url) missing.push("a photo of the licence");

  return missing.length > 0 ? { reason: "incomplete", missing } : null;
}

/** Does this row represent someone who declared they hold no licence? */
export function declaredNoLicence(row: LicenceGateRow): boolean {
  return row.licence_kind === "none";
}
