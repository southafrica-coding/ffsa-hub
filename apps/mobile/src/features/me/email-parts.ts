// An email address in two pieces, so a long one wraps before the "@" rather
// than inside the domain (QA pass 2: "jackery.kilman@g / mail.com").

/** "name@example.com" → ["name", "@example.com"]; anything else whole. */
export function emailParts(email: string): string[] {
  const at = email.lastIndexOf("@");
  return at > 0 ? [email.slice(0, at), email.slice(at)] : [email];
}
