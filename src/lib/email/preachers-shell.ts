// ============================================================
// PREACHERS SA email shell — bespoke brand chrome
// ============================================================
// Wrapper + content helpers for every email tied to an event
// with brand='preachers'. Sibling to:
//   - shell.ts            (Fire & Fragrance transactional shell)
//   - the-send-shell.ts   (THE SEND bespoke shell)
//   - ffsa-camps-shell.ts (FFSA Camps bespoke shell)
//
// PREACHERS identity (see preachers-ticket-confirmation.ts and the
// preachers storefront for the source of truth):
//   - palette: DARK — deep gunmetal navy paper + aged bone/cream type,
//              a near-black ink surround. Strictly monochrome — no colour
//              accent; the mark, the twin lightning bolts and the gritty
//              display type carry the energy (per the brand artwork).
//   - display: heavy condensed rock-poster caps (Anton → Impact →
//              Haettenschweiler → Arial Narrow Bold fallback), uppercase,
//              tracked. The condensed heavy caps are the PREACHERS
//              signature — distinct from THE SEND's Arial Black and FFSA
//              Camps' heavy italic.
//   - body:    Helvetica
//   - device:  twin lightning bolts (⚡) flanking the wordmark; grunge
//              feel comes from the condensed distressed caps.
//   - chrome:  ink surround → ink ticker ("GO. PREACH.") → ink masthead
//              (⚡ PREACHERS ⚡ lockup) → navy paper body → ink footer with
//              the lockup + scripture line.
//   - slogan:  "GO. PREACH."
//   - vision:  "Go into all the world and preach the gospel. — Mark 16:15"
//
// All inline-CSS, single 600px table — Gmail / Outlook / Apple Mail
// safe. No webfonts (Anton won't load in clients), only system
// fallbacks. The 'Anton' family is kept first in the stack so the real
// face is used the day it's self-hosted.
// ============================================================

// Mirrors the structured-shell signature used by F&F's renderEmailShell
// (./shell.ts), theSendEmailShell and campsEmailShell so callers can swap
// between the four when an event-tied transactional template needs to
// brand-route.
interface EmailShellOptions {
  title?: string;
  preheader?: string;
  eyebrow: string;
  heading: string;
  bodyHtml: string;
  cta?: { label: string; url: string };
  tagline?: string | null;
  siteUrl?: string | null;
}

// ── Tokens ──────────────────────────────────────────────────
export const PREACHERS_COLORS = {
  NAVY: "#1B2A33", // paper body — deep gunmetal navy (from the artwork)
  INK: "#0F1920", // near-black surround — ticker, masthead, footer
  BONE: "#EDE6D3", // aged cream — display type + primary text
  OFFWHITE: "#F7F5EF", // brightest text — dates, headlines
  LINE: "#3A4A54", // muted steel — hairline borders (a navy tint, not an accent)
} as const;

const C = PREACHERS_COLORS;

export const PREACHERS_FONTS = {
  // DISPLAY is used together with `font-weight:900` + uppercase at each
  // call site. The condensed heavy caps are the brand signature.
  DISPLAY: "'Anton','Impact','Haettenschweiler','Arial Narrow Bold',sans-serif",
  BODY: "Helvetica,Arial,sans-serif",
} as const;

const F = PREACHERS_FONTS;

// Slogan + vision are the PREACHERS analog of THE SEND's ticker line.
export const PREACHERS_SLOGAN = "GO. PREACH.";
export const PREACHERS_VISION =
  "Go into all the world and preach the gospel. — Mark 16:15";

// Lightning-bolt device (⚡) — the flanking mark from the artwork.
const BOLT = "&#9889;";

const DEFAULT_SITE_URL = "https://www.ffsahub.com";

function siteBase(siteUrl?: string | null): string {
  const raw =
    siteUrl?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    DEFAULT_SITE_URL;
  return raw.replace(/\/$/, "");
}

export function preachersEsc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Heavy condensed display style shared by every headline-level element.
const DISPLAY_STYLE = `font-family:${F.DISPLAY};font-weight:900;`;

// ── Content helpers ─────────────────────────────────────────
// Plain-text args are escaped. *Html() variants take pre-escaped HTML
// (sanitised upstream) so caller can splice <strong> / <em> / <a> in.

export function preachersEyebrow(text: string): string {
  return `<p style="margin:0 0 10px;font-family:${F.BODY};font-size:11px;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;color:${C.OFFWHITE};opacity:0.7;">${preachersEsc(text)}</p>`;
}

export function preachersHeading(htmlOrText: string, opts?: { raw?: boolean }): string {
  const content = opts?.raw ? htmlOrText : preachersEsc(htmlOrText);
  return `<h1 style="margin:0 0 18px;${DISPLAY_STYLE}font-size:40px;line-height:0.98;letter-spacing:0.02em;text-transform:uppercase;color:${C.BONE};">${content}</h1>`;
}

export function preachersParagraph(html: string): string {
  return `<p style="margin:0 0 14px;font-family:${F.BODY};font-size:15px;line-height:1.65;color:${C.OFFWHITE};">${html}</p>`;
}

export function preachersStrongLine(text: string): string {
  return `<p style="margin:0 0 18px;${DISPLAY_STYLE}font-size:24px;letter-spacing:0.03em;text-transform:uppercase;color:${C.BONE};">${preachersEsc(text)}</p>`;
}

export function preachersQuote(text: string, attribution?: string | null): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:6px 0 18px;"><tr><td style="border-left:4px solid ${C.BONE};padding:2px 0 2px 16px;font-family:${F.BODY};font-size:17px;line-height:1.55;font-style:italic;color:${C.OFFWHITE};">&ldquo;${preachersEsc(text)}&rdquo;${
    attribution
      ? `<span style="display:block;margin-top:8px;font-family:${F.BODY};font-size:11px;font-style:normal;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${C.BONE};opacity:0.75;">&mdash; ${preachersEsc(attribution)}</span>`
      : ""
  }</td></tr></table>`;
}

export function preachersButton(
  url: string,
  label: string,
  variant: "filled" | "outline" | "link" = "filled"
): string {
  if (variant === "link") {
    return `<p style="margin:6px 0 18px;"><a href="${preachersEsc(url)}" style="font-family:${F.BODY};font-size:15px;font-weight:700;color:${C.BONE};text-decoration:underline;text-decoration-color:${C.BONE};">${preachersEsc(label)} &rarr;</a></p>`;
  }
  const outline = variant === "outline";
  // Filled = bone stamp on navy (inverted, high-contrast, reads like a
  // pressed ticket). Outline = bone border on the dark paper.
  const bg = outline ? "transparent" : C.BONE;
  const fg = outline ? C.BONE : C.INK;
  const border = `2px solid ${C.BONE}`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 6px;"><tr><td style="background:${bg};border:${border};">
<a href="${preachersEsc(url)}" style="display:inline-block;padding:13px 30px;${DISPLAY_STYLE}font-size:15px;letter-spacing:0.12em;text-transform:uppercase;color:${fg};text-decoration:none;">${preachersEsc(label)}</a>
</td></tr></table>`;
}

export function preachersList(items: string[]): string {
  const rows = items
    .map(
      (it) =>
        `<tr><td style="padding:10px 14px;border:2px solid ${C.LINE};background:${C.INK};font-family:${F.BODY};font-size:14px;color:${C.OFFWHITE};">${preachersEsc(it)}</td></tr><tr><td style="height:7px;line-height:7px;font-size:0;">&nbsp;</td></tr>`
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:2px 0 14px;">${rows}</table>`;
}

export function preachersDivider(style: "rule" | "dots" | "space" = "rule"): string {
  if (style === "space") {
    return `<div style="height:20px;line-height:20px;font-size:0;">&nbsp;</div>`;
  }
  if (style === "dots") {
    return `<p style="margin:14px 0;text-align:center;font-family:${F.BODY};font-size:16px;letter-spacing:0.4em;color:${C.BONE};">&bull;&nbsp;&bull;&nbsp;&bull;</p>`;
  }
  return `<div style="margin:20px 0;border-top:2px dashed ${C.LINE};line-height:0;font-size:0;">&nbsp;</div>`;
}

export function preachersSpacer(size: "sm" | "md" | "lg" | "xl" = "md"): string {
  const h = { sm: 8, md: 16, lg: 28, xl: 44 }[size];
  return `<div style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</div>`;
}

export function preachersImage(url: string, alt: string, caption?: string | null): string {
  return `<p style="margin:0 0 16px;"><img src="${preachersEsc(url)}" alt="${preachersEsc(alt)}" width="544" style="display:block;width:100%;max-width:544px;height:auto;border:2px solid ${C.LINE};" />${
    caption
      ? `<span style="display:block;margin-top:6px;font-family:${F.BODY};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.BONE};opacity:0.75;">${preachersEsc(caption)}</span>`
      : ""
  }</p>`;
}

// ── Chrome ──────────────────────────────────────────────────
// The outer wrapper. Caller renders bodyHtml (eyebrow/heading/body/
// blocks/etc) and gets back a full <!doctype html> document.
//
// Layout: ink surround → ink ticker → ink masthead → navy body
// → ink footer. The body slot is generic so transactional copy,
// workflow blocks, or ticket stubs all use the same chrome.

export interface PreachersChromeOptions {
  /** Browser-tab title. Defaults to "PREACHERS SA". */
  title?: string;
  /** Hidden inbox-preview text (Gmail/iOS). */
  previewText?: string;
  /** Pre-rendered inner HTML for the navy-paper body slot. */
  bodyHtml: string;
  /** Used to build absolute URLs for any assets. */
  siteUrl?: string | null;
}

// PREACHERS typographic lockup — condensed heavy wordmark flanked by the
// twin lightning bolts (no logo image, same approach as THE SEND / Camps
// text lockups). `size` scales the masthead vs footer instances.
function preachersLockup(size: number, color: string): string {
  return `<span style="${DISPLAY_STYLE}font-size:${size}px;color:${color};letter-spacing:0.03em;text-transform:uppercase;line-height:1;">${BOLT}&nbsp;PREACHERS&nbsp;${BOLT}</span>`;
}

export function preachersChrome(opts: PreachersChromeOptions): string {
  siteBase(opts.siteUrl); // reserved for future absolute-asset URLs
  const title = opts.title ?? "PREACHERS SA";
  const preview = opts.previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${C.NAVY};">${preachersEsc(opts.previewText)}</div>`
    : "";

  // Ticker repeats the slogan; sized to fit the 600px table.
  const ticker = `${PREACHERS_SLOGAN}&nbsp;&nbsp;${BOLT}&nbsp;&nbsp;${PREACHERS_SLOGAN}&nbsp;&nbsp;${BOLT}&nbsp;&nbsp;${PREACHERS_SLOGAN}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${preachersEsc(title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.INK};font-family:${F.BODY};color:${C.OFFWHITE};">
  ${preview}
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${C.INK};padding:30px 10px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:${C.NAVY};table-layout:fixed;">

        <!-- Ink ticker bar -->
        <tr>
          <td style="background:${C.INK};border-bottom:1px solid ${C.LINE};padding:8px 14px;${DISPLAY_STYLE}font-size:14px;color:${C.BONE};letter-spacing:0.22em;text-transform:uppercase;line-height:1.2;overflow:hidden;white-space:nowrap;text-align:center;">
            ${ticker}
          </td>
        </tr>

        <!-- Ink masthead -->
        <tr>
          <td style="background:${C.INK};padding:16px 22px;border-bottom:1px solid ${C.LINE};">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td valign="middle">${preachersLockup(24, C.BONE)}</td>
                <td valign="middle" align="right" style="font-family:${F.BODY};font-size:10px;font-weight:700;color:${C.BONE};letter-spacing:0.18em;text-transform:uppercase;opacity:0.7;">
                  SOUTH&nbsp;AFRICA
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Navy body — caller-supplied content -->
        <tr>
          <td style="background:${C.NAVY};color:${C.OFFWHITE};padding:34px 28px 28px 28px;">
            ${opts.bodyHtml}
          </td>
        </tr>

        <!-- Ink footer -->
        <tr>
          <td style="background:${C.INK};color:${C.BONE};padding:26px 28px;text-align:center;border-top:1px solid ${C.LINE};">
            <p style="margin:0;">${preachersLockup(26, C.BONE)}</p>
            <p style="margin:14px 0 0;font-family:${F.BODY};font-size:12px;font-style:italic;line-height:1.6;color:${C.BONE};opacity:0.9;max-width:420px;margin-left:auto;margin-right:auto;">
              ${preachersEsc(PREACHERS_VISION)}
            </p>
            <p style="margin:14px 0 0;font-family:${F.BODY};font-size:10px;font-weight:700;color:${C.BONE};letter-spacing:0.2em;text-transform:uppercase;opacity:0.7;">
              Powered by FFSA Hub &middot; &copy;&nbsp;MMXXVI
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Transactional shell ─────────────────────────────────────
// Matches the EmailShellOptions signature from ./shell so callers can
// swap between renderEmailShell / theSendEmailShell / campsEmailShell /
// preachersEmailShell without changing per-template glue code.

export function preachersEmailShell(opts: EmailShellOptions): string {
  const eyebrow = opts.eyebrow ? preachersEyebrow(opts.eyebrow) : "";
  // Heading from EmailShellOptions may contain literal "<br/>" — keep it.
  const heading = preachersHeading(opts.heading, { raw: true });
  const ctaHtml = opts.cta ? preachersButton(opts.cta.url, opts.cta.label, "filled") : "";

  const bodyHtml = `${eyebrow}${heading}${opts.bodyHtml}${ctaHtml}`;

  return preachersChrome({
    title: opts.title ?? opts.eyebrow,
    previewText: opts.preheader ?? opts.eyebrow,
    bodyHtml,
    siteUrl: opts.siteUrl,
  });
}
