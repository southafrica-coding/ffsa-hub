// ============================================================
// Fire & Fragrance email shell (self-contained)
// ============================================================
// Shared wrapper for transactional emails (the scheduling set) so they
// match the F&F brand used by src/lib/email/workflow-template.ts: black
// masthead + yellow rule + the wordmark, warm-white paper body,
// Roboto / Space Mono, black footer.
//
// NOTE: deliberately NOT src/lib/email/shell.ts (the user's separate
// uncommitted refactor) — this one is committed + inline-only.
// ============================================================

import {
  FFSA_COLORS,
  FFSA_TINTS,
  FFSA_FONTS,
  FFSA_FONT_LINK,
  FFSA_LOGOS,
} from "@/lib/brand/ffsa";

// Tokens come from the canonical brand kit — see src/lib/brand/ffsa.ts.
// (These were previously local hexes and had drifted off-deck: a #141414
// near-black and a #F5C84B gold instead of true black and #FFB801.)
const BLACK = FFSA_COLORS.BLACK;
const INK = FFSA_TINTS.INK;
const GOLD = FFSA_COLORS.YELLOW;
const PAPER = FFSA_TINTS.PAPER;
const MUTED = "#6E6E6E";
const WHITE = FFSA_COLORS.WHITE;

const SANS = FFSA_FONTS.BODY;
const MONO = FFSA_FONTS.MONO;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.ffsahub.com";
const FONT_LINK = FFSA_FONT_LINK;

export function ffEsc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Content helpers (plain-text args are escaped; ffParagraph takes HTML) ──

export function ffEyebrow(text: string): string {
  return `<p style="margin:0 0 8px;font-family:${MONO};font-size:11px;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;color:${INK};"><span style="color:${GOLD};">&bull;</span>&nbsp;&nbsp;${ffEsc(text)}</p>`;
}

export function ffHeading(text: string): string {
  return `<h1 style="margin:0 0 16px;font-family:${SANS};font-size:28px;line-height:1.1;font-weight:900;letter-spacing:-0.01em;text-transform:uppercase;color:${INK};">${ffEsc(text)}</h1>`;
}

// Caller is responsible for escaping any dynamic values spliced into `html`.
export function ffParagraph(html: string): string {
  return `<p style="margin:0 0 14px;font-family:${SANS};font-size:15px;line-height:1.7;color:${INK};">${html}</p>`;
}

export function ffStrongLine(text: string): string {
  return `<p style="margin:0 0 20px;font-family:${SANS};font-size:19px;font-weight:700;letter-spacing:0.01em;color:${INK};">${ffEsc(text)}</p>`;
}

export function ffQuote(text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 16px;"><tr><td style="border-left:4px solid ${GOLD};padding:2px 0 2px 16px;font-family:${SANS};font-size:16px;line-height:1.55;font-style:italic;color:${INK};">&ldquo;${ffEsc(text)}&rdquo;</td></tr></table>`;
}

export function ffButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 6px;"><tr><td style="border-radius:999px;background:${BLACK};">
<a href="${ffEsc(url)}" style="display:inline-block;padding:14px 34px;font-family:${SANS};font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${WHITE};text-decoration:none;">${ffEsc(label)}</a>
</td></tr></table>`;
}

export function ffList(items: string[]): string {
  const rows = items
    .map(
      (it) =>
        `<tr><td style="padding:10px 14px;border:1px solid rgba(20,20,20,0.12);border-radius:8px;font-family:${SANS};font-size:14px;color:${INK};">${ffEsc(it)}</td></tr><tr><td style="height:7px;line-height:7px;font-size:0;">&nbsp;</td></tr>`
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:2px 0 14px;">${rows}</table>`;
}

// ── Shell ────────────────────────────────────────────────────

export function ffEmailShell(opts: {
  previewText?: string;
  content: string;
}): string {
  const base = APP_URL.replace(/\/$/, "");
  const preview = opts.previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${PAPER};">${ffEsc(opts.previewText)}</div>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />${FONT_LINK}</head>
<body style="margin:0;padding:0;background:${BLACK};font-family:${SANS};color:${INK};">
${preview}
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${BLACK};padding:28px 10px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:${PAPER};table-layout:fixed;border-radius:8px;overflow:hidden;">

  <tr><td style="background:${BLACK};padding:18px 28px;border-bottom:2px solid ${GOLD};">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
      <td valign="middle"><img src="${base}${FFSA_LOGOS.WORDMARK_WHITE_EMAIL}" alt="Fire &amp; Fragrance" width="148" height="auto" style="display:block;width:148px;height:auto;" /></td>
      <td valign="middle" align="right" style="font-family:${MONO};font-size:10px;color:${GOLD};letter-spacing:0.2em;text-transform:uppercase;">South&nbsp;Africa</td>
    </tr></table>
  </td></tr>

  <tr><td style="background:${PAPER};padding:36px 30px 18px 30px;">
    ${opts.content}
  </td></tr>

  <tr><td style="background:${BLACK};border-top:2px solid ${GOLD};padding:26px 30px;text-align:center;">
    <img src="${base}${FFSA_LOGOS.WORDMARK_WHITE_EMAIL}" alt="Fire &amp; Fragrance" width="120" height="auto" style="display:inline-block;width:120px;height:auto;" />
    <p style="margin:12px 0 0;font-family:${MONO};font-size:10px;color:${GOLD};letter-spacing:0.2em;text-transform:uppercase;">Fire &amp; Fragrance South Africa</p>
    <p style="margin:7px 0 0;font-family:${MONO};font-size:9px;color:${WHITE};letter-spacing:0.16em;text-transform:uppercase;opacity:0.5;">ffsahub.com</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}
