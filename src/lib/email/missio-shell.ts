// ============================================================
// MISSIO email shell — bespoke brand chrome
// ============================================================
// Wrapper + content helpers for every email tied to an event
// with brand='missio'. Sibling to:
//   - shell.ts            (Fire & Fragrance transactional shell)
//   - the-send-shell.ts   (THE SEND bespoke shell)
//   - ffsa-camps-shell.ts (FFSA Camps bespoke shell)
//   - preachers-shell.ts  (PREACHERS SA bespoke shell)
//   - wild-ones-shell.ts  (WILD ONES bespoke shell)
//
// MISSIO identity (see missio-ticket-confirmation.ts and the
// missio storefront for the source of truth):
//   - palette: DARK — pine paper body + cream type, a deep-pine
//              ink surround, with ONE accent: clay/terracotta.
//              Quiet, sent-out church-plant warmth.
//   - display: Fraunces (→ Georgia → Times New Roman → serif fallback),
//              uppercase, weight 700.
//   - body:    Helvetica
//   - device:  a cross (✝) in the ticker; the MISSIO wordmark is
//              rendered as live serif text in the masthead + footer.
//   - chrome:  ink surround → ink ticker ("SENT ON MISSION", clay text)
//              → ink masthead (wordmark lockup) → pine paper body
//              → ink footer with the lockup + scripture line.
//   - slogan:  "SENT ON MISSION"
//   - vision:  "As the Father has sent me, so I am sending you. — John 20:21"
//
// All inline-CSS, single 600px table — Gmail / Outlook / Apple Mail
// safe. The 'Fraunces' family is kept first in the display stack so the
// real face is used where webfonts load (Apple Mail), and everything
// else falls back to Georgia→Times.
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
//   NAVY = the pine paper body, INK = the deep-pine surround.
export const MISSIO_COLORS = {
  NAVY: "#20463A", // paper body — pine
  INK: "#16332A", // deep pine surround — ticker, masthead, footer
  BONE: "#EDE4D3", // cream — primary type
  OFFWHITE: "#FBF6EC", // brightest text — dates, headlines
  LINE: "#35594B", // hairline borders
  EMBER: "#C56A3F", // accent — CTAs, eyebrows, rules, ticker text
  GOLD: "#D98A5C", // highlight
} as const;

const C = MISSIO_COLORS;

export const MISSIO_FONTS = {
  // DISPLAY is used together with `font-weight:700` + uppercase at each
  // call site. Fraunces is the brand face; in email it's pulled via a
  // <link> in the chrome <head> so webfont-capable clients (Apple Mail)
  // render it, and everything else falls back to Georgia→Times.
  DISPLAY: "'Fraunces','Georgia','Times New Roman',serif",
  BODY: "Helvetica,Arial,sans-serif",
} as const;

// Google Fonts <link> for the display face — email progressive enhancement.
// Gmail strips it (falls back to Georgia); Apple Mail honours it.
export const MISSIO_FONT_LINK =
  '<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap" rel="stylesheet" />';

const F = MISSIO_FONTS;

// Slogan + vision are the MISSIO analog of THE SEND's ticker line.
export const MISSIO_SLOGAN = "SENT ON MISSION";
export const MISSIO_VISION =
  "As the Father has sent me, so I am sending you. — John 20:21";

// Cross device (✝) — separator in the ticker.
const MARK = "&#10013;";

const DEFAULT_SITE_URL = "https://www.ffsahub.com";

function siteBase(siteUrl?: string | null): string {
  const raw =
    siteUrl?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    DEFAULT_SITE_URL;
  return raw.replace(/\/$/, "");
}

export function missioEsc(s: string | null | undefined): string {
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

export function missioEyebrow(text: string): string {
  return `<p style="margin:0 0 10px;font-family:${F.BODY};font-size:11px;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;color:${C.EMBER};">${missioEsc(text)}</p>`;
}

export function missioHeading(htmlOrText: string, opts?: { raw?: boolean }): string {
  const content = opts?.raw ? htmlOrText : missioEsc(htmlOrText);
  return `<h1 style="margin:0 0 18px;${DISPLAY_STYLE}font-size:40px;line-height:0.98;letter-spacing:0.02em;text-transform:uppercase;color:${C.OFFWHITE};">${content}</h1>`;
}

export function missioParagraph(html: string): string {
  return `<p style="margin:0 0 14px;font-family:${F.BODY};font-size:15px;line-height:1.65;color:${C.BONE};">${html}</p>`;
}

export function missioStrongLine(text: string): string {
  return `<p style="margin:0 0 18px;${DISPLAY_STYLE}font-size:24px;letter-spacing:0.03em;text-transform:uppercase;color:${C.OFFWHITE};">${missioEsc(text)}</p>`;
}

export function missioQuote(text: string, attribution?: string | null): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:6px 0 18px;"><tr><td style="border-left:4px solid ${C.EMBER};padding:2px 0 2px 16px;font-family:${F.BODY};font-size:17px;line-height:1.55;font-style:italic;color:${C.BONE};">&ldquo;${missioEsc(text)}&rdquo;${
    attribution
      ? `<span style="display:block;margin-top:8px;font-family:${F.BODY};font-size:11px;font-style:normal;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${C.EMBER};">&mdash; ${missioEsc(attribution)}</span>`
      : ""
  }</td></tr></table>`;
}

export function missioButton(
  url: string,
  label: string,
  variant: "filled" | "outline" | "link" = "filled"
): string {
  if (variant === "link") {
    return `<p style="margin:6px 0 18px;"><a href="${missioEsc(url)}" style="font-family:${F.BODY};font-size:15px;font-weight:700;color:${C.EMBER};text-decoration:underline;text-decoration-color:${C.EMBER};">${missioEsc(label)} &rarr;</a></p>`;
  }
  const outline = variant === "outline";
  // Filled = clay stamp with cream type (the primary CTA). Outline =
  // clay border on the dark paper.
  const bg = outline ? "transparent" : C.EMBER;
  const fg = outline ? C.EMBER : C.OFFWHITE;
  const border = `2px solid ${C.EMBER}`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 6px;"><tr><td style="background:${bg};border:${border};">
<a href="${missioEsc(url)}" style="display:inline-block;padding:13px 30px;${DISPLAY_STYLE}font-size:15px;letter-spacing:0.12em;text-transform:uppercase;color:${fg};text-decoration:none;">${missioEsc(label)}</a>
</td></tr></table>`;
}

export function missioList(items: string[]): string {
  const rows = items
    .map(
      (it) =>
        `<tr><td style="padding:10px 14px;border:2px solid ${C.LINE};background:${C.INK};font-family:${F.BODY};font-size:14px;color:${C.BONE};">${missioEsc(it)}</td></tr><tr><td style="height:7px;line-height:7px;font-size:0;">&nbsp;</td></tr>`
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:2px 0 14px;">${rows}</table>`;
}

export function missioDivider(style: "rule" | "dots" | "space" = "rule"): string {
  if (style === "space") {
    return `<div style="height:20px;line-height:20px;font-size:0;">&nbsp;</div>`;
  }
  if (style === "dots") {
    return `<p style="margin:14px 0;text-align:center;font-family:${F.BODY};font-size:16px;letter-spacing:0.4em;color:${C.EMBER};">&bull;&nbsp;&bull;&nbsp;&bull;</p>`;
  }
  return `<div style="margin:20px 0;border-top:2px dashed ${C.EMBER};line-height:0;font-size:0;">&nbsp;</div>`;
}

export function missioSpacer(size: "sm" | "md" | "lg" | "xl" = "md"): string {
  const h = { sm: 8, md: 16, lg: 28, xl: 44 }[size];
  return `<div style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</div>`;
}

export function missioImage(url: string, alt: string, caption?: string | null): string {
  return `<p style="margin:0 0 16px;"><img src="${missioEsc(url)}" alt="${missioEsc(alt)}" width="544" style="display:block;width:100%;max-width:544px;height:auto;border:2px solid ${C.LINE};" />${
    caption
      ? `<span style="display:block;margin-top:6px;font-family:${F.BODY};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.EMBER};">${missioEsc(caption)}</span>`
      : ""
  }</p>`;
}

// ── Chrome ──────────────────────────────────────────────────
// The outer wrapper. Caller renders bodyHtml (eyebrow/heading/body/
// blocks/etc) and gets back a full <!doctype html> document.
//
// Layout: ink surround → ink ticker → ink masthead → pine body
// → ink footer. The body slot is generic so transactional copy,
// workflow blocks, or ticket stubs all use the same chrome.

export interface MissioChromeOptions {
  /** Browser-tab title. Defaults to "MISSIO". */
  title?: string;
  /** Hidden inbox-preview text (Gmail/iOS). */
  previewText?: string;
  /** Pre-rendered inner HTML for the pine-paper body slot. */
  bodyHtml: string;
  /** Used to build absolute URLs for any assets. */
  siteUrl?: string | null;
}

// MISSIO logo lockup — rendered as live serif text (no image asset).
// `height` scales the masthead vs footer instances; the font-size is
// derived from it. `base` is unused (text lockup needs no asset URL).
function missioLockup(base: string, height: number): string {
  void base;
  const fontSize = Math.round(height * 0.9);
  return `<span style="display:inline-block;font-family:${F.DISPLAY};font-weight:700;font-size:${fontSize}px;line-height:1;letter-spacing:0.14em;text-transform:uppercase;color:${C.OFFWHITE};">MISSIO</span>`;
}

export function missioChrome(opts: MissioChromeOptions): string {
  const base = siteBase(opts.siteUrl);
  const title = opts.title ?? "MISSIO";
  const preview = opts.previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${C.NAVY};">${missioEsc(opts.previewText)}</div>`
    : "";

  // Ticker repeats the slogan; sized to fit the 600px table.
  const ticker = `${MISSIO_SLOGAN}&nbsp;&nbsp;${MARK}&nbsp;&nbsp;${MISSIO_SLOGAN}&nbsp;&nbsp;${MARK}&nbsp;&nbsp;${MISSIO_SLOGAN}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${missioEsc(title)}</title>
  ${MISSIO_FONT_LINK}
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
                <td valign="middle">${missioLockup(base, 40)}</td>
                <td valign="middle" align="right" style="font-family:${F.BODY};font-size:10px;font-weight:700;color:${C.EMBER};letter-spacing:0.18em;text-transform:uppercase;">
                  CHURCH PLANT
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Pine body — caller-supplied content -->
        <tr>
          <td style="background:${C.NAVY};color:${C.BONE};padding:34px 28px 28px 28px;">
            ${opts.bodyHtml}
          </td>
        </tr>

        <!-- Ink footer -->
        <tr>
          <td style="background:${C.INK};color:${C.BONE};padding:26px 28px;text-align:center;border-top:1px solid ${C.LINE};">
            <p style="margin:0;">${missioLockup(base, 54)}</p>
            <p style="margin:14px 0 0;font-family:${F.BODY};font-size:12px;font-style:italic;line-height:1.6;color:${C.BONE};opacity:0.9;max-width:420px;margin-left:auto;margin-right:auto;">
              ${missioEsc(MISSIO_VISION)}
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
// preachersEmailShell / missioEmailShell without changing per-template
// glue code.

export function missioEmailShell(opts: EmailShellOptions): string {
  const eyebrow = opts.eyebrow ? missioEyebrow(opts.eyebrow) : "";
  // Heading from EmailShellOptions may contain literal "<br/>" — keep it.
  const heading = missioHeading(opts.heading, { raw: true });
  const ctaHtml = opts.cta ? missioButton(opts.cta.url, opts.cta.label, "filled") : "";

  const bodyHtml = `${eyebrow}${heading}${opts.bodyHtml}${ctaHtml}`;

  return missioChrome({
    title: opts.title ?? opts.eyebrow,
    previewText: opts.preheader ?? opts.eyebrow,
    bodyHtml,
    siteUrl: opts.siteUrl,
  });
}
