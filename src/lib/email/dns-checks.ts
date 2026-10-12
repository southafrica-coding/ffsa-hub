// FFSA Hub — Sending-domain DNS checks (migration 188).
//
// Whether a domain is actually authorised to send mail. Nothing in the Hub
// looked at this before: mail either landed or quietly did not, and no
// screen said why.
//
// The parsers below are pure and separately tested — they are where the
// judgement lives ("is this really an SPF record?"), and getting them wrong
// either blocks legitimate mail or waves through a domain that will land in
// spam. The DNS lookups around them are thin.

import { promises as dns } from "node:dns";

export type DomainCheck = {
  spfOk: boolean;
  dkimOk: boolean;
  dmarcOk: boolean;
  /**
   * The selector DKIM was actually found at. Set when the check discovered it
   * by probing, so the caller can store it and stop guessing next time.
   */
  dkimSelector: string | null;
  /** What to paste into DNS, for the records that are missing. */
  expected: { kind: "SPF" | "DKIM" | "DMARC"; host: string; value: string }[];
  error: string | null;
};

/**
 * A TXT record arrives as an array of chunks that must be joined without a
 * separator — a long record is split at 255 characters, and joining with a
 * space corrupts it. This is the classic reason a valid DKIM key reads as
 * invalid.
 */
export function joinTxtChunks(chunks: string[]): string {
  return chunks.join("");
}

/** SPF: exactly one record beginning v=spf1. Two is a misconfiguration that
 *  makes receivers ignore both, so it counts as not OK. */
export function parseSpf(records: string[][]): boolean {
  const spf = records
    .map(joinTxtChunks)
    .filter((r) => r.trim().toLowerCase().startsWith("v=spf1"));
  return spf.length === 1;
}

/** DMARC: a record at _dmarc.<domain> beginning v=DMARC1. */
export function parseDmarc(records: string[][]): boolean {
  return records
    .map(joinTxtChunks)
    .some((r) => r.trim().toLowerCase().startsWith("v=dmarc1"));
}

/**
 * DKIM: a record at <selector>._domainkey.<domain> carrying a public key.
 *
 * `p=` with an empty value is how a key is REVOKED, so it must not count as
 * present — that distinction is the whole point of checking.
 */
export function parseDkim(records: string[][]): boolean {
  return records.map(joinTxtChunks).some((r) => {
    const t = r.trim();
    if (!/v=dkim1/i.test(t) && !/p=/i.test(t)) return false;
    const m = t.match(/(?:^|;)\s*p=([^;]*)/i);
    return !!m && m[1].trim().length > 0;
  });
}

/**
 * The selector to probe when none is recorded.
 *
 * Resend publishes DKIM under the fixed selector `resend`. Probing it is
 * exactly the lookup a receiving mail server does, so it establishes DKIM as
 * genuinely present rather than assuming it.
 *
 * Mailtrap's selectors (rwmt1/rwmt2) may still be stored on domains checked
 * before the switch. They are ignored: a Mailtrap key in DNS says nothing about
 * whether Resend — the only provider that now sends — can sign for the domain.
 */
const RESEND_DKIM_SELECTOR = "resend";
const RETIRED_DKIM_SELECTORS = new Set(["rwmt1", "rwmt2"]);

async function txt(host: string): Promise<string[][]> {
  try {
    return await dns.resolveTxt(host);
  } catch {
    // NXDOMAIN and friends both mean "no usable record here".
    return [];
  }
}

/**
 * Check one domain. Never throws: a DNS outage must not be reported as a
 * broken domain, so a failure leaves the flags alone and fills `error`.
 */
export async function checkDomain(
  domain: string,
  dkimSelector: string | null
): Promise<DomainCheck> {
  const d = domain.trim().toLowerCase();
  const expected: DomainCheck["expected"] = [];

  try {
    // With no usable stored selector, probe Resend's rather than reporting a
    // configured domain as unauthenticated — which once blocked sending on a
    // domain whose DKIM was in DNS all along.
    const stored =
      dkimSelector && !RETIRED_DKIM_SELECTORS.has(dkimSelector) ? dkimSelector : null;
    const candidates = stored ? [stored] : [RESEND_DKIM_SELECTOR];

    // Resend publishes SPF on its bounce subdomain, send.<domain> (that is the
    // envelope sender receivers check SPF against), not on the root. Accept
    // either, so a root-only setup from before Resend still reads as OK.
    const [spfRecords, sendSpfRecords, dmarcRecords, dkimResults] = await Promise.all([
      txt(d),
      txt(`send.${d}`),
      txt(`_dmarc.${d}`),
      Promise.all(
        candidates.map(async (sel) => ({
          selector: sel,
          ok: parseDkim(await txt(`${sel}._domainkey.${d}`)),
        }))
      ),
    ]);

    const spfOk = parseSpf(sendSpfRecords) || parseSpf(spfRecords);
    const dmarcOk = parseDmarc(dmarcRecords);
    const found = dkimResults.find((r) => r.ok) ?? null;
    const dkimOk = found !== null;
    const foundSelector = found?.selector ?? stored ?? null;

    if (!spfOk) {
      expected.push({
        kind: "SPF",
        host: `send.${d}`,
        // Resend sends through Amazon SES. Resend's domain page shows this
        // same record (plus an MX on send.<domain>) — copy from there.
        value: "v=spf1 include:amazonses.com ~all",
      });
    }
    if (!dkimOk) {
      expected.push({
        kind: "DKIM",
        host: `${stored ?? RESEND_DKIM_SELECTOR}._domainkey.${d}`,
        value: "(copy the value Resend shows for this domain)",
      });
    }
    if (!dmarcOk) {
      expected.push({
        kind: "DMARC",
        host: `_dmarc.${d}`,
        value: `v=DMARC1; p=none; rua=mailto:dmarc@${d}`,
      });
    }

    return {
      spfOk,
      dkimOk,
      dmarcOk,
      dkimSelector: foundSelector,
      expected,
      error: null,
    };
  } catch (e) {
    return {
      spfOk: false,
      dkimOk: false,
      dmarcOk: false,
      dkimSelector,
      expected,
      error: e instanceof Error ? e.message : "DNS lookup failed",
    };
  }
}

/**
 * May the Hub send from this domain?
 *
 * Fails OPEN when the domain has never been checked. A brand-new domain, or
 * one added between deploys, must not have its mail silently stopped by a
 * check that has not run yet — that would turn a diagnostic into an outage.
 * It blocks only on a domain we have affirmatively established has no DKIM.
 */
export function sendingBlockedReason(domain: {
  domain: string;
  dkim_ok: boolean | null;
  last_checked_at: string | null;
}): string | null {
  if (!domain.last_checked_at) return null; // never checked → not our call
  if (domain.dkim_ok === false) {
    return `${domain.domain} has no valid DKIM record, so mail from it will be treated as forged. Add the DKIM record shown on the domain, then re-check.`;
  }
  return null;
}
