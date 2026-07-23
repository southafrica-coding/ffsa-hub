// ============================================================
// Campaign body — block-based composer + editorial email renderer.
//
// Blocks are stored in campaigns.body_source (jsonb) and rendered
// to email-safe HTML (campaigns.body_html) at save time. The
// renderer produces bold-editorial output: warm off-white paper,
// confident display typography, refined CTAs, asymmetric layouts.
// ============================================================

import sanitizeHtml from "sanitize-html";
import {
  BRAND_DEFAULTS,
  mergeBrand,
  type EffectiveBrand,
  type SocialLink,
  type BrandKitRow,
} from "@/services/brand";

// ────────────────────────────────────────────────────────────
// Block type union
// ────────────────────────────────────────────────────────────

export type ButtonStyle = "filled" | "outline" | "link";
export type DividerStyle = "rule" | "dots" | "space";
export type SpacerSize = "sm" | "md" | "lg" | "xl";
export type ImageTextLayout = "image-left" | "image-right";

export type CampaignBlock =
  // Core 5 (with optional polish fields)
  | { id: string; type: "heading"; text: string; eyebrow?: string }
  | { id: string; type: "text"; text: string; dropCap?: boolean }
  | {
      id: string;
      type: "button";
      text: string;
      url: string;
      style?: ButtonStyle;
    }
  | {
      id: string;
      type: "image";
      url: string;
      alt: string;
      caption?: string;
      fullBleed?: boolean;
    }
  | { id: string; type: "divider"; style?: DividerStyle }
  // New editorial primitives
  | { id: string; type: "eyebrow"; text: string }
  | { id: string; type: "quote"; text: string; attribution?: string }
  | { id: string; type: "spacer"; size?: SpacerSize }
  | {
      id: string;
      type: "image-text";
      url: string;
      alt: string;
      heading?: string;
      text: string;
      layout?: ImageTextLayout;
    }
  | {
      id: string;
      type: "cta";
      heading: string;
      text: string;
      buttonText: string;
      buttonUrl: string;
    };

export type CampaignBlockType = CampaignBlock["type"];

export type CampaignBody = {
  version: 1;
  blocks: CampaignBlock[];
};

let counter = 0;
export function newBlockId(): string {
  counter += 1;
  return `b_${Date.now().toString(36)}_${counter}`;
}

export function emptyCampaignBody(): CampaignBody {
  // Tasteful starter — demonstrates the editorial vocabulary so users see
  // what's possible the moment they open a fresh campaign.
  return {
    version: 1,
    blocks: [
      { id: newBlockId(), type: "eyebrow", text: "From the field" },
      { id: newBlockId(), type: "heading", text: "A weekend that changed everything" },
      {
        id: newBlockId(),
        type: "text",
        text: "Open with a sentence that draws the reader in. Editorial emails earn attention by leading with substance — a moment, a question, an image — rather than a greeting. Two short paragraphs is plenty before the first break.",
        dropCap: true,
      },
      { id: newBlockId(), type: "divider", style: "rule" },
      {
        id: newBlockId(),
        type: "quote",
        text: "The room was quiet at first. Then it wasn't.",
        attribution: "Team leader, Saturday session",
      },
      { id: newBlockId(), type: "spacer", size: "md" },
    ],
  };
}

// ────────────────────────────────────────────────────────────
// Sanitization helpers
// ────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeUrl(u: string): string {
  const t = (u || "").trim();
  return /^https?:\/\//i.test(t) ? t : "#";
}

function sanitizeRichText(input: string): string {
  const value = (input ?? "").toString();
  if (!value) return "";
  // Plain text path — preserves drafts written before rich text shipped.
  if (!/<[a-z][\s\S]*>/i.test(value)) {
    return escapeHtml(value).replace(/\n/g, "<br/>");
  }
  return sanitizeHtml(value, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "a"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
    },
  });
}

// ────────────────────────────────────────────────────────────
// Typography / color helpers
// ────────────────────────────────────────────────────────────

function googleFontHref(brand: EffectiveBrand): string {
  const fonts = new Set<string>();
  if (brand.display_font) fonts.add(brand.display_font);
  if (brand.body_font) fonts.add(brand.body_font);
  if (fonts.size === 0) return "";
  const families = Array.from(fonts)
    .map(
      (f) => `family=${encodeURIComponent(f)}:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400;1,600`
    )
    .join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

function displayStack(brand: EffectiveBrand): string {
  return `'${brand.display_font}', Georgia, 'Times New Roman', serif`;
}
function bodyStack(brand: EffectiveBrand): string {
  return `'${brand.body_font}', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif`;
}

/** Lightly lighten a hex color toward white. Used for muted surfaces. */
function softenHex(hex: string, amount = 0.06): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const lift = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${[lift(r), lift(g), lift(b)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

// ────────────────────────────────────────────────────────────
// Header + brand footer
// ────────────────────────────────────────────────────────────

function headerHtml(brand: EffectiveBrand): string {
  const band = `<tr><td style="height:4px;background:${brand.primary_color};border-radius:6px 6px 0 0;"></td></tr>`;
  if (!brand.logo_url) return band;
  return `${band}<tr><td style="padding:36px 56px 8px;text-align:left;">
<img src="${safeUrl(brand.logo_url)}" alt="${escapeHtml(brand.org_name)}" style="display:inline-block;max-height:48px;max-width:200px;height:auto;border:0;"/>
</td></tr>`;
}

const SOCIAL_LABELS: Record<SocialLink["platform"], string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  x: "X",
  tiktok: "TikTok",
  web: "Website",
};

function brandFooterHtml(brand: EffectiveBrand): string {
  const socials = brand.social_links
    .filter((s) => /^https?:\/\//i.test(s.url))
    .map(
      (s) =>
        `<a href="${safeUrl(s.url)}" style="color:${brand.primary_color};text-decoration:none;font-weight:600;margin:0 10px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(SOCIAL_LABELS[s.platform] ?? s.platform)}</a>`
    )
    .join("");

  const tagline = brand.footer_tagline
    ? `<div style="font-style:italic;color:${brand.text_color};opacity:0.7;margin-bottom:18px;font-family:${displayStack(brand)};font-size:15px;line-height:1.5;max-width:380px;margin-left:auto;margin-right:auto;">${escapeHtml(brand.footer_tagline)}</div>`
    : "";

  const socialRow = socials
    ? `<div style="margin-bottom:14px;">${socials}</div>`
    : "";

  const address = brand.org_address
    ? `<div style="opacity:0.6;font-size:11px;line-height:1.7;letter-spacing:0.02em;">${escapeHtml(brand.org_address).replace(/\n/g, "<br/>")}</div>`
    : "";

  // Small rule above footer for editorial separation.
  return `<tr><td style="padding:8px 56px 40px;">
<div style="border-top:1px solid ${softenHex(brand.text_color, 0.7)};margin-bottom:28px;"></div>
<div style="text-align:center;font-family:${bodyStack(brand)};font-size:12px;line-height:1.6;color:${brand.text_color};">
${tagline}
<div style="font-weight:700;letter-spacing:0.22em;text-transform:uppercase;font-size:10px;color:${brand.primary_color};margin-bottom:10px;">${escapeHtml(brand.org_name)}</div>
${socialRow}
${address}
</div>
</td></tr>`;
}

// ────────────────────────────────────────────────────────────
// Block renderers
// ────────────────────────────────────────────────────────────

function eyebrowHtml(text: string, brand: EffectiveBrand): string {
  return `<div style="font-family:${bodyStack(brand)};font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${brand.primary_color};margin-bottom:14px;">${escapeHtml(text)}</div>`;
}

function buttonHtml(
  text: string,
  url: string,
  style: ButtonStyle,
  brand: EffectiveBrand
): string {
  const label = escapeHtml(text);
  const href = safeUrl(url);
  if (style === "link") {
    return `<a href="${href}" style="font-family:${bodyStack(brand)};font-size:14px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${brand.accent_color};text-decoration:none;border-bottom:1.5px solid ${brand.accent_color};padding-bottom:2px;">${label} &nbsp;→</a>`;
  }
  if (style === "outline") {
    return `<a href="${href}" style="display:inline-block;background:transparent;color:${brand.primary_color};text-decoration:none;font-family:${bodyStack(brand)};font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;padding:13px 28px;border:1.5px solid ${brand.primary_color};border-radius:2px;">${label}</a>`;
  }
  // filled (default)
  return `<a href="${href}" style="display:inline-block;background:${brand.accent_color};color:#ffffff;text-decoration:none;font-family:${bodyStack(brand)};font-size:13px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;padding:14px 30px;border-radius:2px;">${label}</a>`;
}

function dividerHtml(style: DividerStyle, brand: EffectiveBrand): string {
  if (style === "space") {
    return `<tr><td style="padding:24px 0;line-height:0;">&nbsp;</td></tr>`;
  }
  if (style === "dots") {
    return `<tr><td style="padding:32px 0;text-align:center;font-size:14px;letter-spacing:1em;color:${brand.primary_color};">&middot;&nbsp;&middot;&nbsp;&middot;</td></tr>`;
  }
  // rule (default) — short left-anchored brand-colored rule
  return `<tr><td style="padding:32px 0;">
<div style="width:48px;height:2px;background:${brand.primary_color};"></div>
</td></tr>`;
}

function spacerHeight(size: SpacerSize): number {
  if (size === "sm") return 16;
  if (size === "lg") return 56;
  if (size === "xl") return 96;
  return 32; // md
}

function dropCapWrap(html: string, brand: EffectiveBrand): string {
  // Take the first character of the first text node and wrap in a span.
  // Works on plain or rich-text HTML alike. If we can't find a leading
  // letter, return the html untouched.
  const re = /(<p[^>]*>\s*)?([A-Za-z])/;
  const m = html.match(re);
  if (!m) return html;
  const idx = html.indexOf(m[2]);
  if (idx < 0) return html;
  const before = html.slice(0, idx);
  const after = html.slice(idx + 1);
  const cap = `<span style="float:left;font-family:${displayStack(brand)};font-size:54px;line-height:0.95;font-weight:800;color:${brand.primary_color};padding:6px 10px 0 0;">${m[2]}</span>`;
  return `${before}${cap}${after}`;
}

function imageHtml(
  block: Extract<CampaignBlock, { type: "image" }>,
  brand: EffectiveBrand
): string {
  const img = `<img src="${safeUrl(block.url)}" alt="${escapeHtml(block.alt || "")}" style="display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:2px;"/>`;
  const caption = block.caption
    ? `<div style="font-family:${displayStack(brand)};font-style:italic;font-size:13px;line-height:1.5;color:${brand.text_color};opacity:0.7;margin-top:10px;">${escapeHtml(block.caption)}</div>`
    : "";
  if (block.fullBleed) {
    // Visually break out of the standard 56px card padding.
    return `<tr><td style="padding:16px 0;"><div style="margin:0 -56px;">${img}</div>${caption ? `<div style="padding:0 56px;">${caption}</div>` : ""}</td></tr>`;
  }
  return `<tr><td style="padding:16px 0;">${img}${caption}</td></tr>`;
}

function quoteHtml(
  block: Extract<CampaignBlock, { type: "quote" }>,
  brand: EffectiveBrand
): string {
  const attribution = block.attribution
    ? `<div style="font-family:${bodyStack(brand)};font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${brand.text_color};opacity:0.55;margin-top:18px;">— ${escapeHtml(block.attribution)}</div>`
    : "";
  return `<tr><td style="padding:24px 0;">
<div style="border-left:3px solid ${brand.accent_color};padding:6px 0 6px 28px;">
<div style="font-family:${displayStack(brand)};font-style:italic;font-size:24px;line-height:1.4;font-weight:500;color:${brand.text_color};">${escapeHtml(block.text)}</div>
${attribution}
</div>
</td></tr>`;
}

function imageTextHtml(
  block: Extract<CampaignBlock, { type: "image-text" }>,
  brand: EffectiveBrand
): string {
  const img = `<img src="${safeUrl(block.url)}" alt="${escapeHtml(block.alt || "")}" style="display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:2px;"/>`;
  const heading = block.heading
    ? `<div style="font-family:${displayStack(brand)};font-size:22px;line-height:1.2;font-weight:700;letter-spacing:-0.015em;color:${brand.primary_color};margin-bottom:10px;">${escapeHtml(block.heading)}</div>`
    : "";
  const text = `<div style="font-family:${bodyStack(brand)};font-size:15px;line-height:1.5;color:${brand.text_color};">${sanitizeRichText(block.text)
    .replace(
      /<p(\s|>)/g,
      `<p style="margin:0 0 12px;font-family:${bodyStack(brand)};font-size:15px;line-height:1.5;color:${brand.text_color};"$1`
    )
    .replace(
      /<a(\s|>)/g,
      `<a style="color:${brand.accent_color};text-decoration:underline;"$1`
    )}</div>`;

  const imageCell = `<td valign="middle" style="width:46%;padding:0;" width="46%">${img}</td>`;
  const textCell = `<td valign="middle" style="width:46%;padding:0;" width="46%">${heading}${text}</td>`;
  const gap = `<td style="width:8%;" width="8%">&nbsp;</td>`;

  const cells =
    block.layout === "image-right"
      ? `${textCell}${gap}${imageCell}`
      : `${imageCell}${gap}${textCell}`;

  // Note: mobile clients without media-query support will see side-by-side
  // at a narrow width. The 46% widths keep it usable. A future pass can add
  // an inlined @media query that stacks below 480px in clients that honor it.
  return `<tr><td style="padding:24px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>
</td></tr>`;
}

function ctaHtml(
  block: Extract<CampaignBlock, { type: "cta" }>,
  brand: EffectiveBrand
): string {
  return `<tr><td style="padding:32px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${brand.primary_color};border-radius:4px;">
<tr><td style="padding:44px 40px;text-align:center;">
<div style="font-family:${displayStack(brand)};font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-0.015em;color:#ffffff;margin-bottom:12px;">${escapeHtml(block.heading)}</div>
<div style="font-family:${bodyStack(brand)};font-size:15px;line-height:1.65;color:#ffffff;opacity:0.85;margin:0 auto 22px;max-width:420px;">${escapeHtml(block.text)}</div>
<a href="${safeUrl(block.buttonUrl)}" style="display:inline-block;background:#ffffff;color:${brand.primary_color};text-decoration:none;font-family:${bodyStack(brand)};font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:14px 30px;border-radius:2px;">${escapeHtml(block.buttonText)}</a>
</td></tr>
</table>
</td></tr>`;
}

function renderBlock(block: CampaignBlock, brand: EffectiveBrand): string {
  switch (block.type) {
    case "heading": {
      const eyebrow = block.eyebrow ? eyebrowHtml(block.eyebrow, brand) : "";
      return `<tr><td style="padding:24px 0 12px;">${eyebrow}<div style="font-family:${displayStack(brand)};font-size:34px;line-height:1.1;font-weight:800;letter-spacing:-0.025em;color:${brand.primary_color};">${escapeHtml(block.text)}</div></td></tr>`;
    }
    case "text": {
      const safe = sanitizeRichText(block.text)
        .replace(
          /<p(\s|>)/g,
          `<p style="margin:0 0 16px;font-family:${bodyStack(brand)};font-size:17px;line-height:1.5;color:${brand.text_color};"$1`
        )
        .replace(
          /<a(\s|>)/g,
          `<a style="color:${brand.accent_color};text-decoration:underline;text-underline-offset:2px;"$1`
        );
      const final = block.dropCap ? dropCapWrap(safe, brand) : safe;
      return `<tr><td style="padding:2px 0;font-family:${bodyStack(brand)};font-size:17px;line-height:1.5;color:${brand.text_color};">${final}</td></tr>`;
    }
    case "button":
      return `<tr><td style="padding:20px 0;">${buttonHtml(block.text, block.url, block.style ?? "filled", brand)}</td></tr>`;
    case "image":
      return imageHtml(block, brand);
    case "divider":
      return dividerHtml(block.style ?? "rule", brand);
    case "eyebrow":
      return `<tr><td style="padding:18px 0 0;">${eyebrowHtml(block.text, brand)}</td></tr>`;
    case "quote":
      return quoteHtml(block, brand);
    case "spacer":
      return `<tr><td style="line-height:0;height:${spacerHeight(block.size ?? "md")}px;">&nbsp;</td></tr>`;
    case "image-text":
      return imageTextHtml(block, brand);
    case "cta":
      return ctaHtml(block, brand);
    default:
      return "";
  }
}

// ────────────────────────────────────────────────────────────
// Top-level render
// ────────────────────────────────────────────────────────────

export type RenderOpts = {
  previewText?: string;
  /** Per-recipient compliance footer (unsubscribe link). Appended after the brand footer. */
  footerHtml?: string;
  /** Brand kit — pass the effective brand from getEffectiveBrand(). Falls back to editorial defaults. */
  brand?: EffectiveBrand | BrandKitRow | null;
  /**
   * Render a subtle banner at the top of the email indicating this is a
   * preview / test send. Set on test-send only — keeps real campaigns
   * pristine while still letting designers see the same layout & spam
   * scoring as a real send.
   */
  testNotice?: string;
};

export function renderCampaignHtml(
  body: CampaignBody,
  opts: RenderOpts = {}
): string {
  const brand: EffectiveBrand =
    opts.brand &&
    "primary_color" in opts.brand &&
    typeof opts.brand.primary_color === "string"
      ? (opts.brand as EffectiveBrand)
      : mergeBrand((opts.brand as BrandKitRow) ?? null);

  const fontHref = googleFontHref(brand);
  const testNoticeRow = opts.testNotice
    ? `<tr><td style="background:${softenHex(brand.accent_color, 0.85)};border:1px dashed ${brand.accent_color};border-radius:3px;padding:10px 14px;margin-bottom:18px;">
<div style="font-family:${bodyStack(brand)};font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${brand.accent_color};">Preview</div>
<div style="font-family:${bodyStack(brand)};font-size:12px;color:${brand.text_color};opacity:0.75;margin-top:4px;">${escapeHtml(opts.testNotice)}</div>
</td></tr>
<tr><td style="height:14px;line-height:0;">&nbsp;</td></tr>`
    : "";
  const rows = testNoticeRow + body.blocks.map((b) => renderBlock(b, brand)).join("");

  const preview = opts.previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:transparent;">${escapeHtml(opts.previewText)}</div>`
    : "";

  // Warm off-white background — avoids the sterile blue-grey of #F8FAFC
  // and gives the email a "paper" feel that pairs well with editorial type.
  const pageBg = brand.bg_color || "#F7F5F0";

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
${fontHref ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="${fontHref}" rel="stylesheet">` : ""}
<title>${escapeHtml(brand.org_name)}</title>
</head>
<body style="margin:0;padding:0;background:${pageBg};font-family:${bodyStack(brand)};-webkit-font-smoothing:antialiased;">
${preview}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${pageBg};padding:40px 0;">
<tr><td align="center">
<table role="presentation" width="660" cellpadding="0" cellspacing="0" style="max-width:660px;width:100%;background:#ffffff;border-radius:6px;">
${headerHtml(brand)}
<tr><td style="padding:20px 56px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
</td></tr>
${brandFooterHtml(brand)}
</table>
${opts.footerHtml ?? ""}
</td></tr>
</table>
</body></html>`;
}

// ────────────────────────────────────────────────────────────
// Plain-text alternative
// ────────────────────────────────────────────────────────────

function htmlToPlainText(html: string): string {
  // Convert rich-text HTML back to readable plain text. Inline links become
  // "label (url)" so URLs are visible without the underline.
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Plain-text alternative of a campaign body. Pairing this with the HTML
 * version (via MIME multipart/alternative) is a major spam-filter signal:
 * mail providers downrank HTML-only marketing emails.
 */
export function renderCampaignText(
  body: CampaignBody,
  opts: { brand?: EffectiveBrand | BrandKitRow | null; testNotice?: string } = {}
): string {
  const brand: EffectiveBrand =
    opts.brand &&
    "primary_color" in opts.brand &&
    typeof opts.brand.primary_color === "string"
      ? (opts.brand as EffectiveBrand)
      : mergeBrand((opts.brand as BrandKitRow) ?? null);

  const lines: string[] = [];

  if (opts.testNotice) {
    lines.push(`[PREVIEW — ${opts.testNotice}]`, "");
  }

  for (const block of body.blocks) {
    switch (block.type) {
      case "eyebrow":
        lines.push(block.text.toUpperCase(), "");
        break;
      case "heading": {
        if (block.eyebrow) lines.push(block.eyebrow.toUpperCase());
        lines.push(block.text);
        lines.push("=".repeat(Math.min(block.text.length, 60)));
        lines.push("");
        break;
      }
      case "text":
        lines.push(htmlToPlainText(block.text), "");
        break;
      case "button":
        lines.push(`→ ${block.text}: ${block.url}`, "");
        break;
      case "image":
        if (block.caption) lines.push(`[Image — ${block.caption}]`, "");
        else if (block.alt) lines.push(`[Image — ${block.alt}]`, "");
        break;
      case "divider":
        lines.push("— — —", "");
        break;
      case "quote": {
        lines.push(`"${block.text}"`);
        if (block.attribution) lines.push(`  — ${block.attribution}`);
        lines.push("");
        break;
      }
      case "spacer":
        lines.push("");
        break;
      case "image-text": {
        if (block.heading) lines.push(block.heading);
        lines.push(htmlToPlainText(block.text), "");
        if (block.alt) lines.push(`[Image — ${block.alt}]`, "");
        break;
      }
      case "cta":
        lines.push(block.heading);
        lines.push(block.text);
        lines.push(`→ ${block.buttonText}: ${block.buttonUrl}`, "");
        break;
    }
  }

  // Brand-aware sign-off.
  lines.push("— — —");
  lines.push(brand.org_name);
  if (brand.org_address) lines.push(brand.org_address);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Re-export editorial defaults so the UI can show "this is what an empty brand
// kit looks like" without importing from the service directly.
export { BRAND_DEFAULTS } from "@/services/brand";
