/** Directory name for the pastor page. Same shape as the people list: legal name, then preferred. */
export function directoryName(row: {
  first_name?: string | null;
  last_name?: string | null;
  preferred_name?: string | null;
}): string {
  const legal = [row.first_name, row.last_name]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return legal || (row.preferred_name ?? "").trim() || "Unnamed";
}

/**
 * The public link shows one given name. A surname stuffed into preferred_name
 * is cut at the first space. Last name, email, and phone are not arguments.
 */
export function publicFirstName(row: { first_name?: string | null; preferred_name?: string | null }): string {
  const preferred = (row.preferred_name ?? "").trim().split(/\s+/)[0];
  if (preferred) return preferred;
  const first = (row.first_name ?? "").trim().split(/\s+/)[0];
  if (first) return first;
  return "there";
}
