// Workshop (provider) fields as the Fleet app stores them.

export const PROVIDER_FIELDS = ["name", "services", "phone", "phone2", "email", "website", "address", "hours", "notes"] as const;

export function providerRow(body: Record<string, unknown>) {
  const row: Record<string, string | null> = {};
  for (const f of PROVIDER_FIELDS) {
    const v = body[f];
    row[f] = typeof v === "string" && v.trim() ? v.trim().slice(0, 2000) : null;
  }
  return row;
}
