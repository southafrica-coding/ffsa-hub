// How a roster row should name a person. Preferred name wins over the legal
// first name; display name and email are only there when both are blank.

export type NamedPerson = {
  preferred_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  email?: string | null;
};

export function personName(user: NamedPerson | null | undefined): string {
  if (!user) return "Unknown";
  const first = user.preferred_name || user.first_name;
  const full = [first, user.last_name].filter((part) => !!part && part.trim() !== "").join(" ");
  return full || user.display_name || user.email || "Unknown";
}
