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
// missio storefront for the source of truth), built around the
// official MISSIŌ wordmark:
//   - palette: LIGHT — warm off-white surround, lighter paper body,
//              near-black type, 1px near-black rules. No accent colour;
//              the black is the accent.
//   - display: Archivo (→ Helvetica Neue → Arial), bold, uppercase.
//   - body:    Archivo (→ Helvetica Neue → Arial)
//   - wordmark: the MISSIŌ PNG at /brands/missio/missio-wordmark.png.
//   - chrome:  off-white surround → paper card: wordmark masthead over a
//              1px rule → body → footer with the wordmark + scripture.
//   - corners: square. Generous whitespace.
//   - slogan:  "SENT ON MISSION"
//   - vision:  "As the Father has sent me, so I am sending you. — John 20:21"
//
// All inline-CSS, single 600px table — Gmail / Outlook / Apple Mail
// safe. Archivo is pulled via <link> for webfont-capable clients (Apple
// Mail); everything else falls back to Helvetica/Arial.
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
// Shared with the public form shell (MISSIO_SHELL_TOKENS) and the
// storefront's scoped CSS so every MISSIO surface reads as one.
export const MISSIO_COLORS = {
  BG: "#E2E2DD", // warm off-white — page surround
  SURFACE: "#EDEDE8", // lighter surface — cards, inputs, ticket stubs
  PAPER: "#F4F4F0", // lightest — email body, raised cards
  INK: "#111111", // near-black — type, rules, primary buttons
  MUTED: "#4A4A46", // secondary type — 6.8:1 on BG (WCAG AA)
  HAIRLINE: "#C9C9C2", // decorative dividers only (never the sole cue)
  ON_INK: "#F4F4F0", // type on black buttons
} as const;

const C = MISSIO_COLORS;

export const MISSIO_FONTS = {
  // DISPLAY is used together with a bold weight + uppercase at each call
  // site. Archivo is the brand face; email clients without webfonts fall
  // back to Helvetica/Arial, which keep the same geometric-grotesque feel.
  DISPLAY: "'Archivo','Helvetica Neue',Helvetica,Arial,sans-serif",
  BODY: "'Archivo','Helvetica Neue',Helvetica,Arial,sans-serif",
} as const;

// Google Fonts <link> for the brand face — email progressive enhancement.
// Gmail strips it (falls back to Helvetica); Apple Mail honours it.
export const MISSIO_FONT_LINK =
  '<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;700;800&display=swap" rel="stylesheet" />';

const F = MISSIO_FONTS;

// Slogan + vision are the MISSIO analog of THE SEND's ticker line.
export const MISSIO_SLOGAN = "SENT ON MISSION";
export const MISSIO_VISION =
  "As the Father has sent me, so I am sending you. — John 20:21";

// The official wordmark (284x72 PNG, black on transparent).
export const MISSIO_WORDMARK_PATH = "/brands/missio/missio-wordmark.png";
const WORDMARK_RATIO = 72 / 284;

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

// The MISSIŌ wordmark as an <img>, `width` px wide. Absolute URL so it
// resolves inside mail clients.
export function missioWordmarkImg(siteUrl: string | null | undefined, width: number): string {
  const base = siteBase(siteUrl);
  const height = Math.round(width * WORDMARK_RATIO);
  return `<img src="${missioEsc(base + MISSIO_WORDMARK_PATH)}" alt="MISSIŌ" width="${width}" height="${height}" style="display:block;width:${width}px;height:${height}px;border:0;outline:none;text-decoration:none;" />`;
}

// Bold display style shared by every headline-level element.
const DISPLAY_STYLE = `font-family:${F.DISPLAY};font-weight:800;`;

// ── Content helpers ─────────────────────────────────────────
// Plain-text args are escaped. *Html() variants take pre-escaped HTML
// (sanitised upstream) so caller can splice <strong> / <em> / <a> in.

export function missioEyebrow(text: string): string {
  return `<p style="margin:0 0 12px;font-family:${F.BODY};font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${C.MUTED};">${missioEsc(text)}</p>`;
}

export function missioHeading(htmlOrText: string, opts?: { raw?: boolean }): string {
  const content = opts?.raw ? htmlOrText : missioEsc(htmlOrText);
  return `<h1 style="margin:0 0 20px;${DISPLAY_STYLE}font-size:36px;line-height:1.02;letter-spacing:-0.01em;text-transform:uppercase;color:${C.INK};">${content}</h1>`;
}

export function missioParagraph(html: string): string {
  return `<p style="margin:0 0 16px;font-family:${F.BODY};font-size:15px;line-height:1.7;color:${C.INK};">${html}</p>`;
}

export function missioStrongLine(text: string): string {
  return `<p style="margin:0 0 20px;${DISPLAY_STYLE}font-size:22px;letter-spacing:0;text-transform:uppercase;color:${C.INK};">${missioEsc(text)}</p>`;
}

export function missioQuote(text: string, attribution?: string | null): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 20px;"><tr><td style="border-left:2px solid ${C.INK};padding:2px 0 2px 18px;font-family:${F.BODY};font-size:17px;line-height:1.55;font-style:italic;color:${C.INK};">&ldquo;${missioEsc(text)}&rdquo;${
    attribution
      ? `<span style="display:block;margin-top:8px;font-family:${F.BODY};font-size:11px;font-style:normal;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${C.MUTED};">&mdash; ${missioEsc(attribution)}</span>`
      : ""
  }</td></tr></table>`;
}

export function missioButton(
  url: string,
  label: string,
  variant: "filled" | "outline" | "link" = "filled"
): string {
  if (variant === "link") {
    return `<p style="margin:6px 0 20px;"><a href="${missioEsc(url)}" style="font-family:${F.BODY};font-size:15px;font-weight:700;color:${C.INK};text-decoration:underline;text-decoration-color:${C.INK};">${missioEsc(label)} &rarr;</a></p>`;
  }
  const outline = variant === "outline";
  // Filled = black block with off-white type (the primary CTA). Outline =
  // 1px black border on the paper.
  const bg = outline ? "transparent" : C.INK;
  const fg = outline ? C.INK : C.ON_INK;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:10px 0 8px;"><tr><td style="background:${bg};border:1px solid ${C.INK};border-radius:2px;">
<a href="${missioEsc(url)}" style="display:inline-block;padding:14px 30px;${DISPLAY_STYLE}font-size:14px;letter-spacing:0.08em;text-transform:uppercase;color:${fg};text-decoration:none;">${missioEsc(label)}</a>
</td></tr></table>`;
}

export function missioList(items: string[]): string {
  const rows = items
    .map(
      (it) =>
        `<tr><td style="padding:12px 16px;border:1px solid ${C.INK};background:${C.SURFACE};font-family:${F.BODY};font-size:14px;color:${C.INK};">${missioEsc(it)}</td></tr><tr><td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>`
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:2px 0 16px;">${rows}</table>`;
}

export function missioDivider(style: "rule" | "dots" | "space" = "rule"): string {
  if (style === "space") {
    return `<div style="height:24px;line-height:24px;font-size:0;">&nbsp;</div>`;
  }
  if (style === "dots") {
    return `<p style="margin:16px 0;text-align:center;font-family:${F.BODY};font-size:16px;letter-spacing:0.4em;color:${C.INK};">&bull;&nbsp;&bull;&nbsp;&bull;</p>`;
  }
  return `<div style="margin:24px 0;border-top:1px solid ${C.INK};line-height:0;font-size:0;">&nbsp;</div>`;
}

export function missioSpacer(size: "sm" | "md" | "lg" | "xl" = "md"): string {
  const h = { sm: 8, md: 16, lg: 28, xl: 44 }[size];
  return `<div style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</div>`;
}

export function missioImage(url: string, alt: string, caption?: string | null): string {
  return `<p style="margin:0 0 18px;"><img src="${missioEsc(url)}" alt="${missioEsc(alt)}" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:1px solid ${C.INK};" />${
    caption
      ? `<span style="display:block;margin-top:8px;font-family:${F.BODY};font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${C.MUTED};">${missioEsc(caption)}</span>`
      : ""
  }</p>`;
}

// ── Chrome ──────────────────────────────────────────────────
// The outer wrapper. Caller renders bodyHtml (eyebrow/heading/body/
// blocks/etc) and gets back a full <!doctype html> document.
//
// Layout: off-white surround → paper card (wordmark masthead, 1px rule,
// body, 1px rule, footer). The body slot is generic so transactional
// copy, workflow blocks, or ticket stubs all use the same chrome.

export interface MissioChromeOptions {
  /** Browser-tab title. Defaults to "MISSIO". */
  title?: string;
  /** Hidden inbox-preview text (Gmail/iOS). */
  previewText?: string;
  /** Pre-rendered inner HTML for the paper body slot. */
  bodyHtml: string;
  /** Used to build absolute URLs for any assets. */
  siteUrl?: string | null;
}

export function missioChrome(opts: MissioChromeOptions): string {
  const title = opts.title ?? "MISSIO";
  const preview = opts.previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${C.BG};">${missioEsc(opts.previewText)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${missioEsc(title)}</title>
  ${MISSIO_FONT_LINK}
</head>
<body style="margin:0;padding:0;background:${C.BG};font-family:${F.BODY};color:${C.INK};">
  ${preview}
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${C.BG};padding:36px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:${C.PAPER};border:1px solid ${C.INK};table-layout:fixed;">

        <!-- Masthead: the MISSIŌ wordmark -->
        <tr>
          <td style="background:${C.PAPER};padding:30px 36px 26px;border-bottom:1px solid ${C.INK};">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td valign="middle">${missioWordmarkImg(opts.siteUrl, 132)}</td>
                <td valign="middle" align="right" style="font-family:${F.BODY};font-size:10px;font-weight:700;color:${C.MUTED};letter-spacing:0.2em;text-transform:uppercase;">
                  ${MISSIO_SLOGAN}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body — caller-supplied content -->
        <tr>
          <td style="background:${C.PAPER};color:${C.INK};padding:40px 36px 36px;">
            ${opts.bodyHtml}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td align="center" style="background:${C.SURFACE};color:${C.INK};padding:32px 36px;text-align:center;border-top:1px solid ${C.INK};">
            <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td>${missioWordmarkImg(opts.siteUrl, 112)}</td></tr></table>
            <p style="margin:16px auto 0;font-family:${F.BODY};font-size:12px;font-style:italic;line-height:1.6;color:${C.MUTED};max-width:420px;">
              ${missioEsc(MISSIO_VISION)}
            </p>
            <p style="margin:14px 0 0;font-family:${F.BODY};font-size:10px;font-weight:700;color:${C.MUTED};letter-spacing:0.2em;text-transform:uppercase;">
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
