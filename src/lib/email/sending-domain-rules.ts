// The pure rules for self-serve sending domains (migration 243): what counts
// as a domain someone may add, and how Resend's statuses read to a person.

/** The two domains the Hub has always sent from — used until Resend is read. */
export const FALLBACK_SENDING_DOMAINS = ["ffsouthafrica.com", "ffsahub.com"];

/**
 * A domain as typed → the bare domain, or why it isn't one. Accepts a pasted
 * address or URL ("info@ffglobal.org", "https://www.ffglobal.org/") because
 * that's what people paste.
 */
export function normalizeDomain(input: string): { domain: string } | { error: string } {
  let d = input.trim().toLowerCase();
  if (d.includes("@")) d = d.slice(d.lastIndexOf("@") + 1);
  d = d.replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").replace(/\.$/, "");
  if (!d) return { error: "Enter a domain, e.g. ffglobal.org" };
  if (d.length > 253 || !/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(d)) {
    return { error: `"${input.trim()}" isn't a domain name — it should look like ffglobal.org` };
  }
  if (!/\.[a-z]{2,}$/.test(d)) return { error: "That domain needs a real ending like .org or .co.za" };
  return { domain: d };
}

export type DomainState = { label: string; tone: "good" | "warn" | "bad" | "quiet" };

export function domainState(status: string | null | undefined): DomainState {
  switch (status) {
    case "verified":
      return { label: "Verified — can send", tone: "good" };
    case "pending":
      return { label: "Checking DNS…", tone: "warn" };
    case "not_started":
      return { label: "Add the DNS records", tone: "warn" };
    case "temporary_failure":
      return { label: "DNS changed — re-check", tone: "bad" };
    case "failed":
      return { label: "Records not found", tone: "bad" };
    default:
      return { label: "Not added to Resend", tone: "quiet" };
  }
}

/**
 * A record's host as most DNS providers want it typed. Resend gives names
 * relative to the domain ("resend._domainkey"); some providers want the full
 * host, so both are shown.
 */
export function fullHost(name: string, domain: string): string {
  const n = name.trim().replace(/\.$/, "");
  if (!n || n === "@") return domain;
  return n.endsWith(`.${domain}`) || n === domain ? n : `${n}.${domain}`;
}
