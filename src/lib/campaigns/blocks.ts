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

// ────────────────────────────────────────────────────────────
// Per-block style overrides (all optional — absence = editorial
// defaults, so existing stored bodies render unchanged).
// ────────────────────────────────────────────────────────────

export type BlockAlign = "left" | "center" | "right";
// "display"/"body" resolve to the two brand fonts; the named keys below are a
// curated menu (web-safe + Google webfonts) selectable per block or globally.
export type NamedFont =
  | "arial"
  | "helvetica"
  | "verdana"
  | "tahoma"
  | "trebuchet"
  | "georgia"
  | "times"
  | "courier"
  | "lato"
  | "roboto"
  | "opensans"
  | "montserrat"
  | "poppins"
  | "nunito"
  | "merriweather"
  | "playfair"
  | "lora";
export type BlockFontFamily = "display" | "body" | NamedFont;
export type BlockFontWeight = 400 | 500 | 600 | 700 | 800;

// ────────────────────────────────────────────────────────────
// Font catalog — the single source of truth for the composer's
// font menu and for resolving a family key to an email-safe stack.
// `google` (when present) is the Google Fonts family to load.
// ────────────────────────────────────────────────────────────

export type FontGroup = "brand" | "sans" | "serif" | "mono";
export type FontCatalogEntry = {
  key: BlockFontFamily;
  label: string;
  /** Email-safe CSS font-family stack. Empty for brand keys (resolved live). */
  stack: string;
  /** Google Fonts family name when this is a webfont (needs loading). */
  google?: string;
  group: FontGroup;
};

export const FONT_CATALOG: FontCatalogEntry[] = [
  { key: "body", label: "Body (brand)", stack: "", group: "brand" },
  { key: "display", label: "Display (brand)", stack: "", group: "brand" },
  // Web-safe sans
  { key: "arial", label: "Arial", stack: "Arial, 'Helvetica Neue', Helvetica, sans-serif", group: "sans" },
  { key: "helvetica", label: "Helvetica", stack: "'Helvetica Neue', Helvetica, Arial, sans-serif", group: "sans" },
  { key: "verdana", label: "Verdana", stack: "Verdana, Geneva, sans-serif", group: "sans" },
  { key: "tahoma", label: "Tahoma", stack: "Tahoma, Verdana, Segoe, sans-serif", group: "sans" },
  { key: "trebuchet", label: "Trebuchet MS", stack: "'Trebuchet MS', Tahoma, sans-serif", group: "sans" },
  // Web-safe serif / mono
  { key: "georgia", label: "Georgia", stack: "Georgia, 'Times New Roman', Times, serif", group: "serif" },
  { key: "times", label: "Times New Roman", stack: "'Times New Roman', Times, serif", group: "serif" },
  { key: "courier", label: "Courier New", stack: "'Courier New', Courier, monospace", group: "mono" },
  // Google webfonts (loaded on demand)
  { key: "lato", label: "Lato", stack: "'Lato', 'Helvetica Neue', Arial, sans-serif", google: "Lato", group: "sans" },
  { key: "roboto", label: "Roboto", stack: "'Roboto', 'Helvetica Neue', Arial, sans-serif", google: "Roboto", group: "sans" },
  { key: "opensans", label: "Open Sans", stack: "'Open Sans', 'Helvetica Neue', Arial, sans-serif", google: "Open Sans", group: "sans" },
  { key: "montserrat", label: "Montserrat", stack: "'Montserrat', 'Helvetica Neue', Arial, sans-serif", google: "Montserrat", group: "sans" },
  { key: "poppins", label: "Poppins", stack: "'Poppins', 'Helvetica Neue', Arial, sans-serif", google: "Poppins", group: "sans" },
  { key: "nunito", label: "Nunito", stack: "'Nunito', 'Helvetica Neue', Arial, sans-serif", google: "Nunito", group: "sans" },
  { key: "merriweather", label: "Merriweather", stack: "'Merriweather', Georgia, serif", google: "Merriweather", group: "serif" },
  { key: "playfair", label: "Playfair Display", stack: "'Playfair Display', Georgia, serif", google: "Playfair Display", group: "serif" },
  { key: "lora", label: "Lora", stack: "'Lora', Georgia, serif", google: "Lora", group: "serif" },
];

const FONT_BY_KEY = new Map<string, FontCatalogEntry>(
  FONT_CATALOG.map((f) => [f.key, f])
);

/**
 * Single <link> href that loads every Google webfont in the catalog — used by
 * the composer so the live preview matches whatever font the user picks. All
 * families are known-valid, so the css2 request never 400s.
 */
export function editorWebFontsHref(): string {
  const families = FONT_CATALOG.filter((f) => f.google)
    .map(
      (f) =>
        `family=${encodeURIComponent(f.google as string)}:ital,wght@0,400;0,600;0,700;1,400`
    )
    .join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

export type BlockPadding = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

export type BlockFont = {
  family?: BlockFontFamily;
  sizePx?: number;
  weight?: BlockFontWeight;
  italic?: boolean;
  color?: string;
  lineHeight?: number; // unitless
};

export type BlockStyle = {
  bgColor?: string;
  padding?: BlockPadding;
  align?: BlockAlign;
  font?: BlockFont;
};

export type CampaignBlock =
  // Core 5 (with optional polish fields)
  | { id: string; type: "heading"; text: string; eyebrow?: string; blockStyle?: BlockStyle }
  | { id: string; type: "text"; text: string; dropCap?: boolean; blockStyle?: BlockStyle }
  | {
      id: string;
      type: "button";
      text: string;
      url: string;
      style?: ButtonStyle;
      /** Custom fill/border color; falls back to the brand accent. */
      bgColor?: string;
      /** Custom label color; falls back to white (filled) / brand (outline). */
      textColor?: string;
      blockStyle?: BlockStyle;
    }
  | {
      id: string;
      type: "image";
      url: string;
      alt: string;
      caption?: string;
      fullBleed?: boolean;
      blockStyle?: BlockStyle;
    }
  | { id: string; type: "divider"; style?: DividerStyle; blockStyle?: BlockStyle }
  // New editorial primitives
  | { id: string; type: "eyebrow"; text: string; blockStyle?: BlockStyle }
  | { id: string; type: "quote"; text: string; attribution?: string; blockStyle?: BlockStyle }
  | { id: string; type: "spacer"; size?: SpacerSize; blockStyle?: BlockStyle }
  | {
      id: string;
      type: "image-text";
      url: string;
      alt: string;
      heading?: string;
      text: string;
      layout?: ImageTextLayout;
      blockStyle?: BlockStyle;
    }
  | {
      id: string;
      type: "cta";
      heading: string;
      text: string;
      buttonText: string;
      buttonUrl: string;
      blockStyle?: BlockStyle;
    }
  // Multi-column text (2 or 3 side-by-side cells; stacks on mobile).
  | {
      id: string;
      type: "columns";
      cells: ColumnCell[];
      blockStyle?: BlockStyle;
    }
  // Social links row (falls back to the brand kit's social_links).
  | {
      id: string;
      type: "social";
      links?: SocialLink[];
      blockStyle?: BlockStyle;
    }
  // Multi-column SECTION — a container of columns, each holding any leaf
  // blocks. Depth is capped at 2 (a section may not contain a section).
  | {
      id: string;
      type: "section";
      layout: SectionLayout;
      columns: SectionColumn[];
      blockStyle?: BlockStyle;
    };

export type ColumnCell = { heading?: string; text: string };

// ────────────────────────────────────────────────────────────
// Sections (nested column layouts) + per-email design overrides
// ────────────────────────────────────────────────────────────

export type SectionLayout =
  | "1"
  | "1-1"
  | "1-1-1"
  | "1-1-1-1"
  | "1-2"
  | "2-1";

/** Column weight array for a layout — "1-2" → [1,2]. Shared by renderer + canvas. */
export function sectionColumnWeights(layout: SectionLayout): number[] {
  switch (layout) {
    case "1":
      return [1];
    case "1-1":
      return [1, 1];
    case "1-1-1":
      return [1, 1, 1];
    case "1-1-1-1":
      return [1, 1, 1, 1];
    case "1-2":
      return [1, 2];
    case "2-1":
      return [2, 1];
    default:
      return [1];
  }
}

export type SectionColumn = {
  id: string;
  blocks: CampaignBlock[];
  blockStyle?: BlockStyle;
};

/** Leaf block types that may be dropped inside a section column. Excludes
 *  "section" (no nesting) and legacy "columns". */
export const COLUMN_ALLOWED_TYPES: ReadonlySet<CampaignBlockType> = new Set([
  "heading",
  "text",
  "button",
  "image",
  "divider",
  "eyebrow",
  "quote",
  "spacer",
  "image-text",
  "cta",
  "social",
]);

/** Per-email global design overrides, layered over the Brand Kit. */
export type EmailDesign = {
  pageBgColor?: string;
  contentBgColor?: string;
  contentWidthPx?: number;
  borderWidth?: number;
  borderColor?: string;
  borderRadiusPx?: number;
  text?: {
    fontFamily?: BlockFontFamily;
    sizePx?: number;
    color?: string;
    lineHeight?: number;
  };
  heading?: { fontFamily?: BlockFontFamily; color?: string };
  linkColor?: string;
  buttonColor?: string;
};

export type CampaignBlockType = CampaignBlock["type"];

export type CampaignBody = {
  version: 1;
  blocks: CampaignBlock[];
  design?: EmailDesign;
};

// ────────────────────────────────────────────────────────────
// Theme — resolved render values (Brand Kit + per-email design).
// A superset of EffectiveBrand so all existing brand reads keep working;
// the extra tokens are the values the renderers used to hard-code.
// Precedence at render time: block.blockStyle > design > brand > literal.
// ────────────────────────────────────────────────────────────

export type Theme = EffectiveBrand & {
  pageBg: string;
  contentBg: string;
  contentWidth: number;
  cardBorderWidth: number;
  cardBorderColor: string;
  cardBorderRadius: number;
  linkColor: string;
  buttonFill: string;
  textFontFamily: BlockFontFamily;
  textSizePx: number;
  textColor: string;
  textLineHeight: number;
  headingFontFamily: BlockFontFamily;
  headingColor: string;
};

export function resolveTheme(
  brand: EffectiveBrand,
  design?: EmailDesign
): Theme {
  return {
    ...brand,
    pageBg: design?.pageBgColor || brand.bg_color || "#F7F5F0",
    contentBg: design?.contentBgColor || "#ffffff",
    contentWidth: design?.contentWidthPx || 660,
    cardBorderWidth: design?.borderWidth ?? 0,
    cardBorderColor: design?.borderColor || "#e5e5e5",
    cardBorderRadius: design?.borderRadiusPx ?? 6,
    linkColor: design?.linkColor || brand.accent_color,
    buttonFill: design?.buttonColor || brand.accent_color,
    textFontFamily: design?.text?.fontFamily || "body",
    textSizePx: design?.text?.sizePx ?? 17,
    textColor: design?.text?.color || brand.text_color,
    textLineHeight: design?.text?.lineHeight ?? 1.5,
    headingFontFamily: design?.heading?.fontFamily || "display",
    headingColor: design?.heading?.color || brand.primary_color,
  };
}

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
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "a"],
    allowedAttributes: { a: ["href", "target", "rel"], p: ["style"] },
    // Only per-paragraph spacing is allowed through on <p>; everything
    // else (colors, fonts, etc.) is applied by the render pipeline.
    allowedStyles: {
      p: {
        "line-height": [/^\d+(\.\d+)?$/],
        "margin-bottom": [/^\d+px$/],
      },
    },
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

// Applies the default paragraph style to every <p>, honouring any
// per-paragraph overrides the author set in the editor (line-height +
// margin-bottom, whitelisted by the sanitizer above). Merging here — rather
// than blindly prepending a second style attribute — keeps the emitted HTML
// valid so email clients don't drop the override.
function styleParagraphs(
  html: string,
  pFont: string,
  defaultMarginBottomPx: number
): string {
  return html.replace(/<p([^>]*)>/gi, (_m, rawAttrs: string) => {
    const inline = /style="([^"]*)"/i.exec(rawAttrs)?.[1] ?? "";
    const lh = /line-height:\s*([\d.]+)/i.exec(inline)?.[1];
    const mb = /margin-bottom:\s*(\d+)px/i.exec(inline)?.[1];
    // pFont already carries a line-height; swap in the paragraph override.
    const font = lh
      ? pFont.replace(/line-height:[^;]*;?/i, `line-height:${lh};`)
      : pFont;
    return `<p style="margin:0 0 ${mb ?? defaultMarginBottomPx}px;${font}">`;
  });
}

// ────────────────────────────────────────────────────────────
// Typography / color helpers
// ────────────────────────────────────────────────────────────

function googleFontHref(brand: EffectiveBrand, body?: CampaignBody): string {
  const fonts = new Set<string>();
  if (brand.display_font) fonts.add(brand.display_font);
  if (brand.body_font) fonts.add(brand.body_font);
  if (body) namedGoogleFonts(body).forEach((f) => fonts.add(f));
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
// Per-block style → inline CSS helpers
// ────────────────────────────────────────────────────────────

function familyStack(
  family: BlockFontFamily | undefined,
  brand: EffectiveBrand
): string {
  if (!family || family === "body") return bodyStack(brand);
  if (family === "display") return displayStack(brand);
  const entry = FONT_BY_KEY.get(family);
  return entry?.stack || bodyStack(brand);
}

/** Google Fonts families referenced by named-font picks anywhere in a body. */
function namedGoogleFonts(body: CampaignBody): Set<string> {
  const names = new Set<string>();
  const add = (family?: BlockFontFamily) => {
    if (!family) return;
    const g = FONT_BY_KEY.get(family)?.google;
    if (g) names.add(g);
  };
  add(body.design?.text?.fontFamily);
  add(body.design?.heading?.fontFamily);
  const walk = (blocks: CampaignBlock[]) => {
    for (const b of blocks) {
      const bs = (b as { blockStyle?: BlockStyle }).blockStyle;
      add(bs?.font?.family);
      if (b.type === "section") b.columns.forEach((c) => walk(c.blocks));
    }
  };
  walk(body.blocks);
  return names;
}

/**
 * Padding for a block's wrapping <td>. When the user sets any explicit
 * padding it replaces the editorial default entirely (missing sides = 0);
 * otherwise the default string is kept so untouched blocks look identical.
 */
function padCss(p: BlockPadding | undefined, fallback: string): string {
  if (!p) return `padding:${fallback};`;
  const t = p.top ?? 0;
  const r = p.right ?? 0;
  const b = p.bottom ?? 0;
  const l = p.left ?? 0;
  return `padding:${t}px ${r}px ${b}px ${l}px;`;
}

/** Background + alignment overrides for a block's wrapping <td>. */
function tdExtraCss(style: BlockStyle | undefined): string {
  if (!style) return "";
  let css = "";
  if (style.bgColor) css += `background:${style.bgColor};`;
  if (style.align) css += `text-align:${style.align};`;
  return css;
}

/** Font CSS for a text/heading element, block overrides merged over defaults. */
function fontCss(
  font: BlockFont | undefined,
  brand: EffectiveBrand,
  defaults: {
    family: string;
    sizePx: number;
    weight: number;
    color: string;
    lineHeight: number;
  }
): string {
  const family = font?.family ? familyStack(font.family, brand) : defaults.family;
  const size = font?.sizePx ?? defaults.sizePx;
  const weight = font?.weight ?? defaults.weight;
  const color = font?.color ?? defaults.color;
  const lh = font?.lineHeight ?? defaults.lineHeight;
  const italic = font?.italic ? "font-style:italic;" : "";
  return `font-family:${family};font-size:${size}px;line-height:${lh};font-weight:${weight};${italic}color:${color};`;
}

// ────────────────────────────────────────────────────────────
// Header + brand footer
// ────────────────────────────────────────────────────────────

function headerHtml(brand: Theme): string {
  const r = brand.cardBorderRadius;
  const band = `<tr><td style="height:4px;background:${brand.primary_color};border-radius:${r}px ${r}px 0 0;"></td></tr>`;
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
  brand: Theme,
  colors?: { bgColor?: string; textColor?: string },
  font?: BlockFont
): string {
  const label = escapeHtml(text);
  const href = safeUrl(url);
  // Font overrides (family / weight / italic / size) layered over the per-style
  // defaults; letter-spacing + uppercase stay so the button keeps its shape.
  const fam = font?.family ? familyStack(font.family, brand) : bodyStack(brand);
  const italic = font?.italic ? "font-style:italic;" : "";
  const typeCss = (sizePx: number, weight: number) =>
    `font-family:${fam};font-size:${font?.sizePx ?? sizePx}px;font-weight:${
      font?.weight ?? weight
    };${italic}`;
  if (style === "link") {
    const linkColor =
      colors?.textColor || font?.color || colors?.bgColor || brand.linkColor;
    return `<a href="${href}" style="${typeCss(
      14,
      600
    )}letter-spacing:0.08em;text-transform:uppercase;color:${linkColor};text-decoration:none;border-bottom:1.5px solid ${linkColor};padding-bottom:2px;">${label} &nbsp;→</a>`;
  }
  if (style === "outline") {
    const line = colors?.bgColor || brand.primary_color;
    const label_color = colors?.textColor || font?.color || line;
    return `<a href="${href}" style="display:inline-block;background:transparent;color:${label_color};text-decoration:none;${typeCss(
      13,
      600
    )}letter-spacing:0.12em;text-transform:uppercase;padding:13px 28px;border:1.5px solid ${line};border-radius:2px;">${label}</a>`;
  }
  // filled (default)
  const fill = colors?.bgColor || brand.buttonFill;
  const fg = colors?.textColor || font?.color || "#ffffff";
  return `<a href="${href}" style="display:inline-block;background:${fill};color:${fg};text-decoration:none;${typeCss(
    13,
    600
  )}letter-spacing:0.12em;text-transform:uppercase;padding:14px 30px;border-radius:2px;">${label}</a>`;
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
  brand: Theme,
  ctx: RenderCtx = {}
): string {
  const img = `<img src="${safeUrl(block.url)}" alt="${escapeHtml(block.alt || "")}" style="display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:2px;"/>`;
  const caption = block.caption
    ? `<div style="font-family:${displayStack(brand)};font-style:italic;font-size:13px;line-height:1.5;color:${brand.text_color};opacity:0.7;margin-top:10px;">${escapeHtml(block.caption)}</div>`
    : "";
  const td = `${padCss(block.blockStyle?.padding, "16px 0")}${tdExtraCss(block.blockStyle)}`;
  // Full-bleed breaks the 56px card padding — only valid at top level, never
  // inside a section column.
  if (block.fullBleed && !ctx.nested) {
    // Visually break out of the standard 56px card padding.
    return `<tr><td style="${td}"><div style="margin:0 -56px;">${img}</div>${caption ? `<div style="padding:0 56px;">${caption}</div>` : ""}</td></tr>`;
  }
  return `<tr><td style="${td}">${img}${caption}</td></tr>`;
}

function quoteHtml(
  block: Extract<CampaignBlock, { type: "quote" }>,
  brand: EffectiveBrand
): string {
  const attribution = block.attribution
    ? `<div style="font-family:${bodyStack(brand)};font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${brand.text_color};opacity:0.55;margin-top:18px;">— ${escapeHtml(block.attribution)}</div>`
    : "";
  const td = `${padCss(block.blockStyle?.padding, "24px 0")}${tdExtraCss(block.blockStyle)}`;
  return `<tr><td style="${td}">
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
  const textPFont = `font-family:${bodyStack(brand)};font-size:15px;line-height:1.5;color:${brand.text_color};`;
  const text = `<div style="${textPFont}">${styleParagraphs(
    sanitizeRichText(block.text),
    textPFont,
    12
  ).replace(
    /<a(\s|>)/g,
    `<a style="color:${brand.accent_color};text-decoration:underline;"$1`
  )}</div>`;

  const imageCell = `<td valign="middle" class="ff-stack" style="width:46%;padding:0;" width="46%">${img}</td>`;
  const textCell = `<td valign="middle" class="ff-stack" style="width:46%;padding:0;" width="46%">${heading}${text}</td>`;
  const gap = `<td class="ff-gap" style="width:8%;" width="8%">&nbsp;</td>`;

  const cells =
    block.layout === "image-right"
      ? `${textCell}${gap}${imageCell}`
      : `${imageCell}${gap}${textCell}`;

  // Cells carry .ff-stack / .ff-gap so the head media query stacks them to
  // full width on phones (clients that honor <style>); desktop stays 46/46.
  const td = `${padCss(block.blockStyle?.padding, "24px 0")}${tdExtraCss(block.blockStyle)}`;
  return `<tr><td style="${td}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>
</td></tr>`;
}

function ctaHtml(
  block: Extract<CampaignBlock, { type: "cta" }>,
  brand: EffectiveBrand
): string {
  const td = `${padCss(block.blockStyle?.padding, "32px 0")}${tdExtraCss(block.blockStyle)}`;
  return `<tr><td style="${td}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${brand.primary_color};border-radius:4px;">
<tr><td style="padding:44px 40px;text-align:center;">
<div style="font-family:${displayStack(brand)};font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-0.015em;color:#ffffff;margin-bottom:12px;">${escapeHtml(block.heading)}</div>
<div style="font-family:${bodyStack(brand)};font-size:15px;line-height:1.65;color:#ffffff;opacity:0.85;margin:0 auto 22px;max-width:420px;">${escapeHtml(block.text)}</div>
<a href="${safeUrl(block.buttonUrl)}" style="display:inline-block;background:#ffffff;color:${brand.primary_color};text-decoration:none;font-family:${bodyStack(brand)};font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:14px 30px;border-radius:2px;">${escapeHtml(block.buttonText)}</a>
</td></tr>
</table>
</td></tr>`;
}

function columnsHtml(
  block: Extract<CampaignBlock, { type: "columns" }>,
  brand: EffectiveBrand
): string {
  const cells = block.cells.length ? block.cells : [{ text: "" }, { text: "" }];
  const n = Math.min(cells.length, 3);
  const cellPct = n === 3 ? 30 : 46;
  const gapPct = n === 3 ? 5 : 8;

  const renderCell = (c: ColumnCell): string => {
    const heading = c.heading
      ? `<div style="font-family:${displayStack(brand)};font-size:18px;line-height:1.25;font-weight:700;color:${brand.primary_color};margin-bottom:8px;">${escapeHtml(c.heading)}</div>`
      : "";
    const cellPFont = `font-family:${bodyStack(brand)};font-size:15px;line-height:1.55;color:${brand.text_color};`;
    const text = `<div style="${cellPFont}">${styleParagraphs(
      sanitizeRichText(c.text),
      cellPFont,
      12
    ).replace(
      /<a(\s|>)/g,
      `<a style="color:${brand.accent_color};text-decoration:underline;"$1`
    )}</div>`;
    return `<td valign="top" class="ff-stack" style="width:${cellPct}%;padding:0;" width="${cellPct}%">${heading}${text}</td>`;
  };

  const gap = `<td class="ff-gap" style="width:${gapPct}%;" width="${gapPct}%">&nbsp;</td>`;
  const row = cells.slice(0, 3).map(renderCell).join(gap);
  const td = `${padCss(block.blockStyle?.padding, "20px 0")}${tdExtraCss(block.blockStyle)}`;
  return `<tr><td style="${td}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${row}</tr></table>
</td></tr>`;
}

function socialHtml(
  block: Extract<CampaignBlock, { type: "social" }>,
  brand: EffectiveBrand
): string {
  const links = (block.links && block.links.length ? block.links : brand.social_links).filter(
    (s) => /^https?:\/\//i.test(s.url)
  );
  if (!links.length) return "";
  const pills = links
    .map(
      (s) =>
        `<a href="${safeUrl(s.url)}" style="display:inline-block;margin:0 6px 8px 0;padding:7px 14px;border:1px solid ${brand.primary_color};border-radius:999px;color:${brand.primary_color};text-decoration:none;font-family:${bodyStack(brand)};font-size:12px;font-weight:600;letter-spacing:0.04em;">${escapeHtml(SOCIAL_LABELS[s.platform] ?? s.platform)}</a>`
    )
    .join("");
  const align = block.blockStyle?.align ?? "center";
  const bg = block.blockStyle?.bgColor ? `background:${block.blockStyle.bgColor};` : "";
  const td = `${padCss(block.blockStyle?.padding, "20px 0")}text-align:${align};${bg}`;
  return `<tr><td style="${td}">${pills}</td></tr>`;
}

type RenderCtx = { nested?: boolean };

export function renderBlock(
  block: CampaignBlock,
  brand: Theme,
  ctx: RenderCtx = {}
): string {
  switch (block.type) {
    case "heading": {
      const eyebrow = block.eyebrow ? eyebrowHtml(block.eyebrow, brand) : "";
      const td = `${padCss(block.blockStyle?.padding, "24px 0 12px")}${tdExtraCss(block.blockStyle)}`;
      const headFont = fontCss(block.blockStyle?.font, brand, {
        family: familyStack(brand.headingFontFamily, brand),
        sizePx: 34,
        weight: 800,
        color: brand.headingColor,
        lineHeight: 1.1,
      });
      return `<tr><td style="${td}">${eyebrow}<div style="${headFont}letter-spacing:-0.025em;">${escapeHtml(block.text)}</div></td></tr>`;
    }
    case "text": {
      const pFont = fontCss(block.blockStyle?.font, brand, {
        family: familyStack(brand.textFontFamily, brand),
        sizePx: brand.textSizePx,
        weight: 400,
        color: brand.textColor,
        lineHeight: brand.textLineHeight,
      });
      const safe = styleParagraphs(sanitizeRichText(block.text), pFont, 16).replace(
        /<a(\s|>)/g,
        `<a style="color:${brand.linkColor};text-decoration:underline;text-underline-offset:2px;"$1`
      );
      const final = block.dropCap ? dropCapWrap(safe, brand) : safe;
      const td = `${padCss(block.blockStyle?.padding, "2px 0")}${tdExtraCss(block.blockStyle)}${pFont}`;
      return `<tr><td style="${td}">${final}</td></tr>`;
    }
    case "button": {
      const td = `${padCss(block.blockStyle?.padding, "20px 0")}${tdExtraCss(block.blockStyle)}`;
      return `<tr><td style="${td}">${buttonHtml(block.text, block.url, block.style ?? "filled", brand, { bgColor: block.bgColor, textColor: block.textColor }, block.blockStyle?.font)}</td></tr>`;
    }
    case "image":
      return imageHtml(block, brand, ctx);
    case "divider":
      return dividerHtml(block.style ?? "rule", brand);
    case "eyebrow": {
      const td = `${padCss(block.blockStyle?.padding, "18px 0 0")}${tdExtraCss(block.blockStyle)}`;
      return `<tr><td style="${td}">${eyebrowHtml(block.text, brand)}</td></tr>`;
    }
    case "quote":
      return quoteHtml(block, brand);
    case "spacer":
      return `<tr><td style="line-height:0;height:${spacerHeight(block.size ?? "md")}px;">&nbsp;</td></tr>`;
    case "image-text":
      return imageTextHtml(block, brand);
    case "cta":
      return ctaHtml(block, brand);
    case "columns":
      return columnsHtml(block, brand);
    case "social":
      return socialHtml(block, brand);
    case "section":
      return ctx.nested ? "" : sectionHtml(block, brand);
    default:
      return "";
  }
}

// Multi-column section — table of columns, each a nested table of its own
// blocks. Reuses every leaf renderer. Stacks on mobile via .ff-stack/.ff-gap
// (head @media), and holds columns side-by-side in Outlook via MSO ghost tds.
function sectionHtml(
  block: Extract<CampaignBlock, { type: "section" }>,
  brand: Theme
): string {
  const cols = block.columns ?? [];
  if (cols.length === 0) return "";
  const weights = sectionColumnWeights(block.layout);
  // Align weights to the actual column count — guards against layout/columns
  // drift (e.g. AI-generated or hand-edited bodies) that would otherwise emit
  // NaN widths.
  const colWeights = cols.map((_, i) => weights[i] ?? 1);
  const total = colWeights.reduce((a, b) => a + b, 0) || 1;
  const gapPct =
    cols.length >= 4 ? 3 : cols.length === 3 ? 4 : cols.length === 2 ? 6 : 0;
  const usablePct = 100 - gapPct * (cols.length - 1);
  // Integer percentages that sum EXACTLY to usablePct (remainder to the last
  // column), so total width is precisely 100% — no 101% overflow.
  const pcts = colWeights.map((w) =>
    Math.max(1, Math.floor((w / total) * usablePct))
  );
  const used = pcts.reduce((a, b) => a + b, 0);
  pcts[pcts.length - 1] += Math.max(0, usablePct - used);

  // Real percentage-width <td>s sit side-by-side in Outlook natively and stack
  // on mobile via the .ff-stack media query — no MSO ghost markup needed.
  const cells = cols.map((col, i) => {
    const inner =
      (col.blocks ?? [])
        .map((child) => renderBlock(child, brand, { nested: true }))
        .join("") || `<tr><td style="height:1px;line-height:0;">&nbsp;</td></tr>`;
    const gap =
      i < cols.length - 1
        ? `<td class="ff-gap" width="${gapPct}%" style="width:${gapPct}%;font-size:0;line-height:0;">&nbsp;</td>`
        : "";
    return `<td class="ff-stack" valign="top" width="${pcts[i]}%" style="width:${pcts[i]}%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${inner}</table>
</td>${gap}`;
  });

  const td = `${padCss(block.blockStyle?.padding, "12px 0")}${tdExtraCss(block.blockStyle)}`;
  return `<tr><td style="${td}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells.join("")}</tr></table>
</td></tr>`;
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
  const baseBrand: EffectiveBrand =
    opts.brand &&
    "primary_color" in opts.brand &&
    typeof opts.brand.primary_color === "string"
      ? (opts.brand as EffectiveBrand)
      : mergeBrand((opts.brand as BrandKitRow) ?? null);
  // Per-email design overrides layered over the Brand Kit.
  const brand: Theme = resolveTheme(baseBrand, body.design);

  const fontHref = googleFontHref(brand, body);
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
  const pageBg = brand.pageBg;
  const cardBorder = brand.cardBorderWidth
    ? `border:${brand.cardBorderWidth}px solid ${brand.cardBorderColor};`
    : "";

  return `<!DOCTYPE html>
<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
${fontHref ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="${fontHref}" rel="stylesheet">` : ""}
<title>${escapeHtml(brand.org_name)}</title>
<style>
  /* Stack multi-column layouts (columns / image-text) on phones. */
  @media only screen and (max-width:600px){
    .ff-stack{display:block!important;width:100%!important;max-width:100%!important;}
    .ff-gap{display:none!important;width:0!important;height:8px!important;}
    .ff-container{width:100%!important;}
    .ff-pad{padding-left:24px!important;padding-right:24px!important;}
  }
  a{text-decoration:none;}
</style>
</head>
<body style="margin:0;padding:0;background:${pageBg};font-family:${bodyStack(brand)};-webkit-font-smoothing:antialiased;">
${preview}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${pageBg}" style="background:${pageBg};padding:40px 0;">
<tr><td align="center">
<!--[if mso]><table role="presentation" width="${brand.contentWidth}" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="${brand.contentWidth}" cellpadding="0" cellspacing="0" class="ff-container" bgcolor="${brand.contentBg}" style="max-width:${brand.contentWidth}px;width:100%;background:${brand.contentBg};border-radius:${brand.cardBorderRadius}px;${cardBorder}">
${headerHtml(brand)}
<tr><td class="ff-pad" style="padding:20px 56px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
</td></tr>
${brandFooterHtml(brand)}
</table>
<!--[if mso]></td></tr></table><![endif]-->
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
      case "columns":
        for (const c of block.cells) {
          if (c.heading) lines.push(c.heading);
          lines.push(htmlToPlainText(c.text), "");
        }
        break;
      case "social": {
        const links = (block.links && block.links.length
          ? block.links
          : brand.social_links
        ).filter((s) => /^https?:\/\//i.test(s.url));
        if (links.length) {
          lines.push(
            links
              .map((s) => `${SOCIAL_LABELS[s.platform] ?? s.platform}: ${s.url}`)
              .join("  |  "),
            ""
          );
        }
        break;
      }
      case "section": {
        // Flatten columns in reading order; reuse the HTML renderer + strip tags.
        const theme = resolveTheme(brand);
        for (const col of block.columns ?? []) {
          for (const child of col.blocks ?? []) {
            const t = htmlToPlainText(renderBlock(child, theme, { nested: true }));
            if (t) lines.push(t, "");
          }
        }
        break;
      }
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
