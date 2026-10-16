// Donor statements — the words: placeholders, the email, the PDF's file
// name. Pure and client-safe, so the preview shows exactly what is sent.

import { fmtUsd, type Donor } from "./donor-statements";

/** Settings the wording reads (migrations 245 + 246). */
export type WordingSettings = {
  org_name: string;
  tax_id: string;
  address_line1: string;
  address_line2: string;
  address_city_line: string;
  signer_name: string;
  signer_title: string;
  email_subject?: string | null;
  email_body?: string | null;
  mission_paragraph?: string | null;
  irs_paragraph?: string | null;
  closing_line?: string | null;
};

// Used until migration 246 is applied, and if a field is ever blanked.
export const DEFAULT_WORDING = {
  email_subject: "[Year] Giving Statement - Thank You for Your Generosity!",
  email_body: `Dear [Donor Name],

On behalf of [Organization], we want to express our deepest gratitude for your generous contributions throughout the year.

You are receiving this statement because you made a donation through [Organization] to Fire & Fragrance South Africa or Missio Church.

Your partnership enables us to advance our mission through worship & prayer, evangelism, discipleship, media, ending Bible poverty, and mercy ministries across South Africa and beyond. Your support is making a tangible impact in lives and communities.

Your total donation for [Year] is: $[total].

Attached is a detailed statement of all your donations. Your continued support helps us fulfill our mission and make a lasting impact in the lives of those we serve.

As a registered 501(c)(3) tax-exempt organization (EIN: [Tax ID]), we want to confirm that no goods or services were provided in exchange for this donation. Therefore, your contribution is fully tax-deductible to the extent allowed by law.

If you have any questions or require additional information, please don't hesitate to respond to this email.

We are deeply grateful for your generosity and for your role in supporting the work of the Kingdom. Together, we are changing lives for eternity.

With blessings and gratitude,

[Signer Name]
[Signer Title]
[Organization]
[Address]`,
  mission_paragraph:
    "Your partnership enables us to advance our mission through worship & prayer, evangelism, discipleship, media, ending Bible poverty, and mercy ministries across South Africa and beyond. Your support is making a tangible impact in lives and communities.",
  irs_paragraph:
    "This letter serves as a record of your charitable contributions. No goods or services were provided in exchange for these donations. Your donations are tax-deductible to the extent allowed by law.",
  closing_line: "With blessings and gratitude,",
};

export const PLACEHOLDERS = [
  "[Donor Name]", "[Year]", "[total]", "[Organization]", "[Tax ID]", "[Signer Name]", "[Signer Title]", "[Address]",
] as const;

export function wordingOf(s: WordingSettings) {
  const pick = (k: keyof typeof DEFAULT_WORDING) => (s[k] ?? "").trim() || DEFAULT_WORDING[k];
  return {
    subject: pick("email_subject"),
    body: pick("email_body"),
    mission: pick("mission_paragraph"),
    irs: pick("irs_paragraph"),
    closing: pick("closing_line"),
  };
}

/** "$1,500.00" → "1,500.00" — the templates write the $ themselves. */
const plainAmount = (cents: number) => fmtUsd(cents).replace("$", "");

export function fillPlaceholders(
  template: string,
  s: WordingSettings,
  v: { donorName: string; year: number; totalCents: number }
): string {
  const values: Record<string, string> = {
    "[Donor Name]": v.donorName,
    "[Year]": String(v.year),
    "[total]": plainAmount(v.totalCents),
    "[Organization]": s.org_name,
    "[Tax ID]": s.tax_id,
    "[Signer Name]": s.signer_name,
    "[Signer Title]": s.signer_title,
    "[Address]": [s.address_line1, s.address_line2, s.address_city_line].filter(Boolean).join("\n"),
  };
  // Case-insensitive, so "[Total]" or "[donor name]" typed in Settings still work.
  return template.replace(/\[(Donor Name|Year|total|Organization|Tax ID|Signer Name|Signer Title|Address)\]/gi, (m) => {
    const key = Object.keys(values).find((k) => k.toLowerCase() === m.toLowerCase());
    return key ? values[key] : m;
  });
}

/** Placeholders written in a template that this wording doesn't know. */
export function unknownPlaceholders(template: string): string[] {
  const known = new Set(PLACEHOLDERS.map((p) => p.toLowerCase()));
  return [...new Set((template.match(/\[[^\]\n]{1,40}\]/g) ?? []).filter((m) => !known.has(m.toLowerCase())))];
}

/** "FF SA USA - 2026 Donation Statement - Peter C Gill.pdf" */
export function statementFileName(year: number, donorName: string): string {
  const safe = donorName.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `FF SA USA - ${year} Donation Statement - ${safe}.pdf`;
}

export type StatementEmail = { subject: string; text: string; html: string };

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function statementEmail(s: WordingSettings, donor: Pick<Donor, "name" | "totalCents">, year: number): StatementEmail {
  const w = wordingOf(s);
  const v = { donorName: donor.name, year, totalCents: donor.totalCents };
  const subject = fillPlaceholders(w.subject, s, v).replace(/\s+/g, " ").trim();
  const text = fillPlaceholders(w.body, s, v);
  // A plain letter: one <p> per paragraph, line breaks kept (the sign-off block).
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => `<p style="margin:0 0 14px">${esc(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff">
<div style="max-width:600px;margin:0 auto;font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.55;color:#1a1a1a">${paragraphs}</div>
</body></html>`;
  return { subject, text, html };
}
