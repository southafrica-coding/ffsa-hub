// ============================================================
// FFSA email — canonical editorial-black chrome
// ============================================================
// The email counterpart of the FFSA ticketing landing page
// (src/app/(public)/e/[slug]/ffsa-storefront.tsx). Every FFSA
// ('ff'/Fire & Fragrance) email renders through this so the whole
// journey — storefront, receipt, campaign, transactional — is one
// identity, straight from the FFSA Brand Deck:
//
//   - true-black canvas, edge-to-edge (no "card")
//   - a yellow slogan band under the masthead (the landing page's
//     kinetic marquee, as a static band for email)
//   - ROBOTO BLACK uppercase headings, Space Mono eyebrows/labels
//   - #FFB801 accent, bone body copy, a stamped-yellow CTA
//   - a footer that reproduces the deck cover's contact row
//
// Email-robust: table layout, inline CSS, explicit bgcolor for
// Outlook, webfonts as progressive enhancement (Roboto Black falls
// back to Arial Black; Space Mono to Courier). The other event
// brands (THE SEND / Camps / PREACHERS) keep their own chrome.
// ============================================================

import {
  FFSA_BRAND,
  FFSA_COLORS,
  FFSA_FONTS,
  FFSA_FONT_LINK,
} from "@/lib/brand/ffsa";

// ── Tokens (solid hexes — email clients are unreliable with rgba) ──
export const FE = {
  BLACK: FFSA_COLORS.BLACK, // #000000 page + chrome
  SURFACE: "#0B0B0B", // inset panels / list rows
  LINE: "#242424", // hairline dividers on black
  WHITE: FFSA_COLORS.WHITE, // headings / strong
  BONE: FFSA_COLORS.BONE, // #C5C2AE body copy
  DIM: "#8C8979", // captions
  FAINT: "#6A6759", // footer / fine print
  YELLOW: FFSA_COLORS.YELLOW, // #FFB801 accent
  BLUE: FFSA_COLORS.BLUE, // #000DE5 marquee glyph
  GREEN: FFSA_COLORS.GREEN, // #4C9F37 confirmed state
} as const;

// Display stack keeps a heavy fallback for webfont-less clients (Gmail).
const DISPLAY = "'Roboto','Arial Black','Helvetica Neue',Arial,sans-serif";
const BODY = FFSA_FONTS.BODY;
const MONO = FFSA_FONTS.MONO;


export function feEsc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Content helpers ─────────────────────────────────────────
// Plain-text args are escaped. *Html-taking helpers (feParagraph,
// feHeading{raw}) expect pre-sanitised HTML from the caller.

export function feEyebrow(text: string): string {
  return `<p style="margin:0 0 14px;font-family:${MONO};font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${FE.YELLOW};">&bull;&nbsp;&nbsp;${feEsc(text)}</p>`;
}

export function feHeading(htmlOrText: string, opts?: { raw?: boolean }): string {
  const content = opts?.raw ? htmlOrText : feEsc(htmlOrText);
  return `<h1 style="margin:0 0 20px;font-family:${DISPLAY};font-size:30px;line-height:0.98;font-weight:900;letter-spacing:-0.02em;text-transform:uppercase;color:${FE.WHITE};">${content}</h1>`;
}

export function feParagraph(html: string): string {
  return `<p style="margin:0 0 15px;font-family:${BODY};font-size:15px;line-height:1.72;color:${FE.BONE};">${html}</p>`;
}

export function feStrong(html: string): string {
  return `<strong style="color:${FE.WHITE};font-weight:700;">${html}</strong>`;
}

export function feStrongLine(text: string): string {
  return `<p style="margin:0 0 18px;font-family:${DISPLAY};font-size:20px;font-weight:900;letter-spacing:-0.01em;text-transform:uppercase;color:${FE.WHITE};line-height:1.1;">${feEsc(text)}</p>`;
}

export function feQuote(text: string, attribution?: string | null): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:6px 0 18px;"><tr><td style="border-left:4px solid ${FE.YELLOW};padding:4px 0 4px 18px;font-family:${BODY};font-size:17px;line-height:1.55;font-style:italic;color:${FE.WHITE};">&ldquo;${feEsc(text)}&rdquo;${
    attribution
      ? `<span style="display:block;margin-top:8px;font-family:${MONO};font-size:11px;font-style:normal;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${FE.YELLOW};">&mdash; ${feEsc(attribution)}</span>`
      : ""
  }</td></tr></table>`;
}

// Stamped-yellow CTA — the landing page's PAY button.
export function feButton(
  url: string,
  label: string,
  variant: "filled" | "outline" | "link" = "filled"
): string {
  if (variant === "link") {
    return `<p style="margin:8px 0 16px;"><a href="${feEsc(url)}" style="font-family:${BODY};font-size:15px;font-weight:700;color:${FE.YELLOW};text-decoration:underline;text-decoration-color:${FE.YELLOW};">${feEsc(label)} &rarr;</a></p>`;
  }
  const outline = variant === "outline";
  const bg = outline ? FE.BLACK : FE.YELLOW;
  const fg = outline ? FE.WHITE : FE.BLACK;
  const border = outline ? `1px solid ${FE.LINE}` : `1px solid ${FE.YELLOW}`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:10px 0 8px;"><tr><td bgcolor="${outline ? "#000000" : FE.YELLOW}" style="background:${bg};border:${border};border-radius:12px;">
<a href="${feEsc(url)}" style="display:inline-block;padding:15px 34px;font-family:${DISPLAY};font-size:14px;font-weight:900;letter-spacing:0.04em;text-transform:uppercase;color:${fg};text-decoration:none;">${feEsc(label)}${outline ? "" : "&nbsp;&nbsp;&rarr;"}</a>
</td></tr></table>`;
}

export function feList(items: string[]): string {
  const rows = items
    .map(
      (it) =>
        `<tr><td bgcolor="#0B0B0B" style="padding:12px 16px;border:1px solid ${FE.LINE};border-radius:10px;background:${FE.SURFACE};font-family:${BODY};font-size:14px;color:${FE.BONE};">${feEsc(it)}</td></tr><tr><td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>`
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 14px;">${rows}</table>`;
}

// Inset panel for something the reader must not skim past — a mono yellow
// label over body copy, on the surface tint. Table + bgcolor so Outlook keeps
// the panel; `html` is expected pre-sanitised.
export function feNotice(label: string, html: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:4px 0 18px;"><tr><td bgcolor="#0B0B0B" style="padding:16px 18px;border:1px solid ${FE.LINE};border-left:3px solid ${FE.YELLOW};border-radius:10px;background:${FE.SURFACE};">
<p style="margin:0 0 8px;font-family:${MONO};font-size:10px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${FE.YELLOW};">${feEsc(label)}</p>
<p style="margin:0;font-family:${BODY};font-size:14px;line-height:1.65;color:${FE.BONE};">${html}</p>
</td></tr></table>`;
}

// Deck-style coordinate block: mono yellow label + white value, e.g.
// WHEN / WHERE (mirrors the storefront's information design).
export function feCoords(items: Array<{ label: string; value: string }>): string {
  const cells = items
    .map(
      (c) =>
        `<td valign="top" style="padding:0 28px 0 0;">
          <p style="margin:0 0 7px;font-family:${MONO};font-size:10px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${FE.YELLOW};">${feEsc(c.label)}</p>
          <p style="margin:0;font-family:${DISPLAY};font-size:15px;font-weight:700;letter-spacing:0.01em;text-transform:uppercase;color:${FE.WHITE};line-height:1.3;">${feEsc(c.value)}</p>
        </td>`
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:2px 0 18px;"><tr>${cells}</tr></table>`;
}

export function feDivider(style: "rule" | "dots" | "space" = "rule"): string {
  if (style === "space") return `<div style="height:20px;line-height:20px;font-size:0;">&nbsp;</div>`;
  if (style === "dots")
    return `<p style="margin:16px 0;text-align:center;font-family:${MONO};font-size:16px;letter-spacing:0.4em;color:${FE.YELLOW};">&middot;&nbsp;&middot;&nbsp;&middot;</p>`;
  return `<div style="margin:22px 0;border-top:1px solid ${FE.LINE};line-height:0;font-size:0;">&nbsp;</div>`;
}

export function feSpacer(size: "sm" | "md" | "lg" | "xl" = "md"): string {
  const h = { sm: 8, md: 16, lg: 28, xl: 44 }[size];
  return `<div style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</div>`;
}

export function feImage(url: string, alt: string, caption?: string | null): string {
  return `<p style="margin:0 0 16px;"><img src="${feEsc(url)}" alt="${feEsc(alt)}" width="544" style="display:block;width:100%;max-width:544px;height:auto;border:0;border-radius:12px;" />${
    caption
      ? `<span style="display:block;margin-top:7px;font-family:${MONO};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${FE.DIM};">${feEsc(caption)}</span>`
      : ""
  }</p>`;
}

// ── Chrome ──────────────────────────────────────────────────
// Masthead → yellow slogan band → body → deck-cover footer.

const SLOGAN_PHRASES = ["CATALYZE OUR GENERATION", "EVANGELIZE THE WORLD"];

export interface FfsaEmailDocOptions {
  /** Browser-tab / client title. */
  title?: string;
  /** Hidden inbox-preview text (Gmail / iOS). */
  previewText?: string;
  /** Absolute-URL base for brand images. */
  siteUrl?: string | null;
  /** Pre-rendered inner HTML for the black body slot. */
  bodyHtml: string;
  /** Optional extra footer line (e.g. a "Manage preferences" link). */
  footerExtraHtml?: string;
}

export function ffsaEmailDocument(opts: FfsaEmailDocOptions): string {
  const title = opts.title ?? "Fire & Fragrance South Africa";
  const preview = opts.previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${FE.BLACK};">${feEsc(opts.previewText)}</div>`
    : "";

  const slogan = SLOGAN_PHRASES.map((p) => feEsc(p)).join(
    `&nbsp;&nbsp;<span style="color:${FE.BLUE};">&#10022;</span>&nbsp;&nbsp;`
  );

  const contact = FFSA_BRAND.contact;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${feEsc(title)}</title>
  ${FFSA_FONT_LINK}
</head>
<body style="margin:0;padding:0;background:${FE.BLACK};font-family:${BODY};color:${FE.WHITE};">
  ${preview}
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="#000000" style="background:${FE.BLACK};padding:26px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" bgcolor="#000000" style="max-width:600px;background:${FE.BLACK};table-layout:fixed;">

        <!-- Masthead -->
        <tr><td bgcolor="#000000" style="background:${FE.BLACK};padding:20px 30px;border-bottom:1px solid ${FE.LINE};">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
            <td valign="middle" style="font-family:${DISPLAY};font-size:16px;font-weight:900;letter-spacing:0.02em;text-transform:uppercase;color:${FE.WHITE};">Fire &amp; Fragrance</td>
            <td valign="middle" align="right" style="font-family:${MONO};font-size:10px;font-weight:700;color:${FE.BONE};letter-spacing:0.22em;text-transform:uppercase;">South&nbsp;Africa</td>
          </tr></table>
        </td></tr>

        <!-- Yellow slogan band (the landing page's marquee, static) -->
        <tr><td bgcolor="${FE.YELLOW}" align="center" style="background:${FE.YELLOW};padding:11px 20px;font-family:${DISPLAY};font-size:13px;font-weight:900;letter-spacing:0.05em;text-transform:uppercase;color:${FE.BLACK};line-height:1.2;">
          ${slogan}
        </td></tr>

        <!-- Body -->
        <tr><td bgcolor="#000000" style="background:${FE.BLACK};padding:40px 34px 34px 34px;">
          ${opts.bodyHtml}
        </td></tr>

        <!-- Footer — deck cover contact row -->
        <tr><td bgcolor="#000000" align="center" style="background:${FE.BLACK};border-top:1px solid ${FE.LINE};padding:34px 30px 40px 30px;">
          <p style="margin:0;font-family:${MONO};font-size:10px;font-weight:700;color:${FE.YELLOW};letter-spacing:0.2em;text-transform:uppercase;">${feEsc(FFSA_BRAND.slogan.ffsa)}</p>
          <p style="margin:14px 0 0;font-family:${MONO};font-size:10px;color:${FE.FAINT};letter-spacing:0.08em;line-height:1.7;">
            ${feEsc(contact.instagram)}&nbsp;&nbsp;&middot;&nbsp;&nbsp;${feEsc(contact.website)}<br />${feEsc(contact.address)}
          </p>
          ${opts.footerExtraHtml ? `<p style="margin:14px 0 0;font-family:${BODY};font-size:12px;color:${FE.DIM};line-height:1.6;">${opts.footerExtraHtml}</p>` : ""}
          <p style="margin:14px 0 0;font-family:${MONO};font-size:9px;color:${FE.FAINT};letter-spacing:0.18em;text-transform:uppercase;">Powered by FFSA Hub</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
