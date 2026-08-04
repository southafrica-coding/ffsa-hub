// ============================================================
// WILD ONES email shell — bespoke brand chrome
// ============================================================
// Wrapper + content helpers for every email tied to an event
// with brand='wild_ones'. Sibling to:
//   - shell.ts            (Fire & Fragrance transactional shell)
//   - the-send-shell.ts   (THE SEND bespoke shell)
//   - ffsa-camps-shell.ts (FFSA Camps bespoke shell)
//   - preachers-shell.ts  (PREACHERS SA bespoke shell)
//
// WILD ONES identity (see wild-ones-ticket-confirmation.ts and the
// wild-ones storefront for the source of truth):
//   - palette: DARK — charcoal paper body + bone type, a near-black
//              ink surround, with ONE accent: ember-orange. Raw,
//              torch-lit revival energy.
//   - display: Oswald (→ Anton → Impact → Arial Narrow Bold fallback),
//              uppercase, weight 700.
//   - body:    Helvetica
//   - device:  ember flame (🔥) in the ticker; the real brush wordmark
//              image carries the torch in the masthead + footer.
//   - chrome:  ink surround → ink ticker ("CARRY THE FIRE", ember text)
//              → ink masthead (wordmark lockup) → charcoal paper body
//              → ink footer with the lockup + scripture line.
//   - slogan:  "CARRY THE FIRE"
//   - vision:  "You are the light of the world. — Matthew 5:14"
//
// All inline-CSS, single 600px table — Gmail / Outlook / Apple Mail
// safe. The 'Oswald' family is kept first in the display stack so the
// real face is used where webfonts load (Apple Mail), and everything
// else falls back to Anton→Impact.
// ============================================================

// Mirrors the structured-shell signature used by F&F's renderEmailShell
// (./shell.ts), theSendEmailShell and campsEmailShell so callers can swap
// between the shells when an event-tied transactional template needs to
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
// NAVY / INK key names kept to mirror the sibling shells' shape:
//   NAVY = the charcoal paper body, INK = the near-black surround.
export const WILD_ONES_COLORS = {
  NAVY: "#141210", // paper body — charcoal
  INK: "#0B0A09", // near-black surround — ticker, masthead, footer
  BONE: "#F5F1E8", // bone — primary type
  OFFWHITE: "#FFFFFF", // brightest text — dates, headlines
  LINE: "#3A322C", // hairline borders
  EMBER: "#F26B21", // accent — CTAs, eyebrows, rules, ticker text
  GOLD: "#FF8A1E", // highlight
} as const;

const C = WILD_ONES_COLORS;

export const WILD_ONES_FONTS = {
  // DISPLAY is used together with `font-weight:700` + uppercase at each
  // call site. Oswald is the brand face; in email it's pulled via a
  // <link> in the chrome <head> so webfont-capable clients (Apple Mail)
  // render it, and everything else falls back to Anton→Impact.
  DISPLAY: "'Oswald','Anton','Impact','Arial Narrow Bold',sans-serif",
  BODY: "Helvetica,Arial,sans-serif",
} as const;

// Google Fonts <link> for the display face — email progressive enhancement.
// Gmail strips it (falls back to Impact); Apple Mail honours it.
export const WILD_ONES_FONT_LINK =
  '<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&display=swap" rel="stylesheet" />';

const F = WILD_ONES_FONTS;

// Slogan + vision are the WILD ONES analog of THE SEND's ticker line.
export const WILD_ONES_SLOGAN = "CARRY THE FIRE";
export const WILD_ONES_VISION =
  "You are the light of the world. — Matthew 5:14";

// Ember-flame device (🔥) — separator in the ticker.
const FLAME = "&#128293;";

const DEFAULT_SITE_URL = "https://www.ffsahub.com";

function siteBase(siteUrl?: string | null): string {
  const raw =
    siteUrl?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    DEFAULT_SITE_URL;
  return raw.replace(/\/$/, "");
}

export function wildOnesEsc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Condensed display style shared by every headline-level element.
const DISPLAY_STYLE = `font-family:${F.DISPLAY};font-weight:700;`;

// ── Content helpers ─────────────────────────────────────────
// Plain-text args are escaped. *Html() variants take pre-escaped HTML
// (sanitised upstream) so caller can splice <strong> / <em> / <a> in.

export function wildOnesEyebrow(text: string): string {
  return `<p style="margin:0 0 10px;font-family:${F.BODY};font-size:11px;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;color:${C.EMBER};">${wildOnesEsc(text)}</p>`;
}

export function wildOnesHeading(htmlOrText: string, opts?: { raw?: boolean }): string {
  const content = opts?.raw ? htmlOrText : wildOnesEsc(htmlOrText);
  return `<h1 style="margin:0 0 18px;${DISPLAY_STYLE}font-size:40px;line-height:0.98;letter-spacing:0.02em;text-transform:uppercase;color:${C.OFFWHITE};">${content}</h1>`;
}

export function wildOnesParagraph(html: string): string {
  return `<p style="margin:0 0 14px;font-family:${F.BODY};font-size:15px;line-height:1.65;color:${C.BONE};">${html}</p>`;
}

export function wildOnesStrongLine(text: string): string {
  return `<p style="margin:0 0 18px;${DISPLAY_STYLE}font-size:24px;letter-spacing:0.03em;text-transform:uppercase;color:${C.OFFWHITE};">${wildOnesEsc(text)}</p>`;
}

export function wildOnesQuote(text: string, attribution?: string | null): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:6px 0 18px;"><tr><td style="border-left:4px solid ${C.EMBER};padding:2px 0 2px 16px;font-family:${F.BODY};font-size:17px;line-height:1.55;font-style:italic;color:${C.BONE};">&ldquo;${wildOnesEsc(text)}&rdquo;${
    attribution
      ? `<span style="display:block;margin-top:8px;font-family:${F.BODY};font-size:11px;font-style:normal;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${C.EMBER};">&mdash; ${wildOnesEsc(attribution)}</span>`
      : ""
  }</td></tr></table>`;
}

export function wildOnesButton(
  url: string,
  label: string,
  variant: "filled" | "outline" | "link" = "filled"
): string {
  if (variant === "link") {
    return `<p style="margin:6px 0 18px;"><a href="${wildOnesEsc(url)}" style="font-family:${F.BODY};font-size:15px;font-weight:700;color:${C.EMBER};text-decoration:underline;text-decoration-color:${C.EMBER};">${wildOnesEsc(label)} &rarr;</a></p>`;
  }
  const outline = variant === "outline";
  // Filled = ember stamp with white type (the primary CTA). Outline =
  // ember border on the dark paper.
  const bg = outline ? "transparent" : C.EMBER;
  const fg = outline ? C.EMBER : C.OFFWHITE;
  const border = `2px solid ${C.EMBER}`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 6px;"><tr><td style="background:${bg};border:${border};">
<a href="${wildOnesEsc(url)}" style="display:inline-block;padding:13px 30px;${DISPLAY_STYLE}font-size:15px;letter-spacing:0.12em;text-transform:uppercase;color:${fg};text-decoration:none;">${wildOnesEsc(label)}</a>
</td></tr></table>`;
}

export function wildOnesList(items: string[]): string {
  const rows = items
    .map(
      (it) =>
        `<tr><td style="padding:10px 14px;border:2px solid ${C.LINE};background:${C.INK};font-family:${F.BODY};font-size:14px;color:${C.BONE};">${wildOnesEsc(it)}</td></tr><tr><td style="height:7px;line-height:7px;font-size:0;">&nbsp;</td></tr>`
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:2px 0 14px;">${rows}</table>`;
}

export function wildOnesDivider(style: "rule" | "dots" | "space" = "rule"): string {
  if (style === "space") {
    return `<div style="height:20px;line-height:20px;font-size:0;">&nbsp;</div>`;
  }
  if (style === "dots") {
    return `<p style="margin:14px 0;text-align:center;font-family:${F.BODY};font-size:16px;letter-spacing:0.4em;color:${C.EMBER};">&bull;&nbsp;&bull;&nbsp;&bull;</p>`;
  }
  return `<div style="margin:20px 0;border-top:2px dashed ${C.EMBER};line-height:0;font-size:0;">&nbsp;</div>`;
}

export function wildOnesSpacer(size: "sm" | "md" | "lg" | "xl" = "md"): string {
  const h = { sm: 8, md: 16, lg: 28, xl: 44 }[size];
  return `<div style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</div>`;
}

export function wildOnesImage(url: string, alt: string, caption?: string | null): string {
  return `<p style="margin:0 0 16px;"><img src="${wildOnesEsc(url)}" alt="${wildOnesEsc(alt)}" width="544" style="display:block;width:100%;max-width:544px;height:auto;border:2px solid ${C.LINE};" />${
    caption
      ? `<span style="display:block;margin-top:6px;font-family:${F.BODY};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.EMBER};">${wildOnesEsc(caption)}</span>`
      : ""
  }</p>`;
}

// ── Chrome ──────────────────────────────────────────────────
// The outer wrapper. Caller renders bodyHtml (eyebrow/heading/body/
// blocks/etc) and gets back a full <!doctype html> document.
//
// Layout: ink surround → ink ticker → ink masthead → charcoal body
// → ink footer. The body slot is generic so transactional copy,
// workflow blocks, or ticket stubs all use the same chrome.

export interface WildOnesChromeOptions {
  /** Browser-tab title. Defaults to "WILD ONES". */
  title?: string;
  /** Hidden inbox-preview text (Gmail/iOS). */
  previewText?: string;
  /** Pre-rendered inner HTML for the charcoal-paper body slot. */
  bodyHtml: string;
  /** Used to build absolute URLs for any assets. */
  siteUrl?: string | null;
}

// WILD ONES logo lockup — the official white brush wordmark, served as an
// absolute-URL image so inbox clients load it. `height` scales the
// masthead vs footer instances. Wordmark aspect is ~0.694:1, so width is
// derived from height.
function wildOnesLockup(base: string, height: number): string {
  const width = Math.round(height * 0.694);
  return `<img src="${base}/brand/wild-ones-wordmark-white.png" alt="WILD ONES" width="${width}" height="${height}" style="display:inline-block;height:${height}px;width:${width}px;border:0;" />`;
}

export function wildOnesChrome(opts: WildOnesChromeOptions): string {
  const base = siteBase(opts.siteUrl);
  const title = opts.title ?? "WILD ONES";
  const preview = opts.previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${C.NAVY};">${wildOnesEsc(opts.previewText)}</div>`
    : "";

  // Ticker repeats the slogan; sized to fit the 600px table.
  const ticker = `${WILD_ONES_SLOGAN}&nbsp;&nbsp;${FLAME}&nbsp;&nbsp;${WILD_ONES_SLOGAN}&nbsp;&nbsp;${FLAME}&nbsp;&nbsp;${WILD_ONES_SLOGAN}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${wildOnesEsc(title)}</title>
  ${WILD_ONES_FONT_LINK}
</head>
<body style="margin:0;padding:0;background:${C.INK};font-family:${F.BODY};color:${C.BONE};">
  ${preview}
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${C.INK};padding:30px 10px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:${C.NAVY};table-layout:fixed;">

        <!-- Ink ticker bar -->
        <tr>
          <td style="background:${C.INK};border-bottom:1px solid ${C.LINE};padding:8px 14px;${DISPLAY_STYLE}font-size:14px;color:${C.EMBER};letter-spacing:0.22em;text-transform:uppercase;line-height:1.2;overflow:hidden;white-space:nowrap;text-align:center;">
            ${ticker}
          </td>
        </tr>

        <!-- Ink masthead -->
        <tr>
          <td style="background:${C.INK};padding:16px 22px;border-bottom:1px solid ${C.LINE};">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td valign="middle">${wildOnesLockup(base, 40)}</td>
                <td valign="middle" align="right" style="font-family:${F.BODY};font-size:10px;font-weight:700;color:${C.EMBER};letter-spacing:0.18em;text-transform:uppercase;">
                  CONFERENCE
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Charcoal body — caller-supplied content -->
        <tr>
          <td style="background:${C.NAVY};color:${C.BONE};padding:34px 28px 28px 28px;">
            ${opts.bodyHtml}
          </td>
        </tr>

        <!-- Ink footer -->
        <tr>
          <td style="background:${C.INK};color:${C.BONE};padding:26px 28px;text-align:center;border-top:1px solid ${C.LINE};">
            <p style="margin:0;">${wildOnesLockup(base, 54)}</p>
            <p style="margin:14px 0 0;font-family:${F.BODY};font-size:12px;font-style:italic;line-height:1.6;color:${C.BONE};opacity:0.9;max-width:420px;margin-left:auto;margin-right:auto;">
              ${wildOnesEsc(WILD_ONES_VISION)}
            </p>
            <p style="margin:14px 0 0;font-family:${F.BODY};font-size:10px;font-weight:700;color:${C.EMBER};letter-spacing:0.2em;text-transform:uppercase;">
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
// preachersEmailShell / wildOnesEmailShell without changing per-template
// glue code.

export function wildOnesEmailShell(opts: EmailShellOptions): string {
  const eyebrow = opts.eyebrow ? wildOnesEyebrow(opts.eyebrow) : "";
  // Heading from EmailShellOptions may contain literal "<br/>" — keep it.
  const heading = wildOnesHeading(opts.heading, { raw: true });
  const ctaHtml = opts.cta ? wildOnesButton(opts.cta.url, opts.cta.label, "filled") : "";

  const bodyHtml = `${eyebrow}${heading}${opts.bodyHtml}${ctaHtml}`;

  return wildOnesChrome({
    title: opts.title ?? opts.eyebrow,
    previewText: opts.preheader ?? opts.eyebrow,
    bodyHtml,
    siteUrl: opts.siteUrl,
  });
}
