// ============================================================
// Fire & Fragrance workflow-email template
// ============================================================
// A fixed, branded shell every workflow step email renders inside —
// the block editor only supplies the copy.
//
// IMPORTANT: this is the *Fire & Fragrance* brand (the hub's parent),
// NOT "The Send". The two are distinct identities and must never be
// designed using each other. F&F = Roboto / Space Mono, black + yellow
// + white, black pill buttons (source: the FFSA brand deck, encoded in
// src/lib/brand/ffsa.ts). The Send's navy/red/blue ticket aesthetic
// lives only in its own template.
//
// Email-safe: inline CSS, single 600px table. Roboto / Space Mono are
// loaded via Google Fonts for clients that support webfonts (Apple Mail,
// iOS); everything falls back to Arial / Courier elsewhere.
// ============================================================

import sanitizeHtml from "sanitize-html";
import type { CampaignBody, CampaignBlock } from "@/lib/campaigns/blocks";
import {
  SEND_COLORS,
  SEND_FONTS,
  sendEyebrow,
  sendHeading,
  sendButton,
  sendQuote,
  sendDivider,
  sendSpacer,
  sendImage,
  sendEsc,
  theSendChrome,
} from "./the-send-shell";
import {
  CAMPS_COLORS,
  CAMPS_FONTS,
  campsEyebrow,
  campsHeading,
  campsButton,
  campsQuote,
  campsDivider,
  campsSpacer,
  campsImage,
  campsEsc,
  campsChrome,
} from "./ffsa-camps-shell";
import {
  PREACHERS_COLORS,
  PREACHERS_FONTS,
  preachersEyebrow,
  preachersHeading,
  preachersButton,
  preachersQuote,
  preachersDivider,
  preachersSpacer,
  preachersImage,
  preachersEsc,
  preachersChrome,
} from "./preachers-shell";
import {
  WILD_ONES_COLORS,
  WILD_ONES_FONTS,
  wildOnesEyebrow,
  wildOnesHeading,
  wildOnesButton,
  wildOnesQuote,
  wildOnesDivider,
  wildOnesSpacer,
  wildOnesImage,
  wildOnesEsc,
  wildOnesChrome,
} from "./wild-ones-shell";
import {
  MISSIO_COLORS,
  MISSIO_FONTS,
  missioEyebrow,
  missioHeading,
  missioButton,
  missioQuote,
  missioDivider,
  missioSpacer,
  missioImage,
  missioEsc,
  missioChrome,
} from "./missio-shell";
import { FFSA_FONTS } from "@/lib/brand/ffsa";
import {
  FE,
  feEsc,
  feEyebrow,
  feHeading,
  feButton,
  feQuote,
  feDivider,
  feSpacer,
  feImage,
  ffsaEmailDocument,
} from "./ffsa-chrome";

// F&F campaign/workflow emails now render in the canonical FFSA
// editorial-black chrome (ffsa-chrome.ts) — the same identity as the
// ticketing landing page and every other FFSA send. The block editor
// content is styled onto the black body below; the SEND / Camps /
// PREACHERS variants further down keep their own chrome.
const SANS = FFSA_FONTS.BODY;
const MONO = FFSA_FONTS.MONO;

function esc(s: string | null | undefined): string {
  return feEsc(s);
}

function richText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "a", "span", "ul", "ol", "li"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    transformTags: {
      a: (_t, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          style: `color:${FE.YELLOW};text-decoration:underline;text-decoration-color:${FE.YELLOW};`,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      p: () => ({
        tagName: "p",
        attribs: {
          style: `margin:0 0 4px;font-family:${SANS};font-size:15px;line-height:1.72;color:${FE.BONE};`,
        },
      }),
      strong: () => ({ tagName: "strong", attribs: { style: `color:${FE.WHITE};font-weight:700;` } }),
      b: () => ({ tagName: "strong", attribs: { style: `color:${FE.WHITE};font-weight:700;` } }),
    },
  });
}

function renderBlock(b: CampaignBlock): string {
  switch (b.type) {
    case "eyebrow":
      return feEyebrow(b.text);

    case "heading":
      return `${b.eyebrow ? feEyebrow(b.eyebrow) : ""}${feHeading(b.text)}`;

    case "text":
      return `<div style="margin:0 0 6px;">${richText(b.text)}</div>`;

    case "button": {
      const style = b.style ?? "filled";
      return feButton(b.url, b.text, style === "link" ? "link" : style === "outline" ? "outline" : "filled");
    }

    case "image":
      return feImage(b.url, b.alt, b.caption);

    case "quote":
      return feQuote(b.text, b.attribution);

    case "divider":
      return feDivider(b.style ?? "rule");

    case "spacer":
      return feSpacer(b.size ?? "md");

    case "image-text":
      return `${feImage(b.url, b.alt)}${
        b.heading
          ? `<h2 style="margin:0 0 6px;font-family:${FFSA_FONTS.DISPLAY};font-size:20px;line-height:1.1;font-weight:900;letter-spacing:-0.01em;text-transform:uppercase;color:${FE.WHITE};">${esc(b.heading)}</h2>`
          : ""
      }<div style="margin:0 0 6px;">${richText(b.text)}</div>`;

    default:
      return "";
  }
}

export type WorkflowEmailBrand =
  | "ff"
  | "the_send"
  | "ffsa_camps"
  | "preachers"
  | "wild_ones"
  | "missio";

export type WorkflowEmailOpts = {
  baseUrl: string; // e.g. https://www.ffsahub.com — for the logo assets
  prefsUrl: string; // manage-preferences / unsubscribe link
  previewText?: string;
  scheduler?: { url: string; label: string }; // optional "pick a time" button
  /**
   * Visual brand. Defaults to 'ff' (Fire & Fragrance — the existing
   * workflow shell). 'the_send' wraps the same block content in the
   * THE SEND chrome (navy/cream/gold); 'ffsa_camps' wraps it in the
   * FFSA Camps chrome (blue/cream). Either makes workflow steps fired
   * for that event match its storefront and ticket email.
   */
  brand?: WorkflowEmailBrand;
};

export function renderWorkflowEmail(
  body: CampaignBody | null | undefined,
  opts: WorkflowEmailOpts
): string {
  if (opts.brand === "ffsa_camps") {
    return renderCampsWorkflowEmail(body, opts);
  }
  if (opts.brand === "preachers") {
    return renderPreachersWorkflowEmail(body, opts);
  }
  if (opts.brand === "wild_ones") {
    return renderWildOnesWorkflowEmail(body, opts);
  }
  if (opts.brand === "missio") {
    return renderMissioWorkflowEmail(body, opts);
  }
  if (opts.brand === "the_send") {
    return renderTheSendWorkflowEmail(body, opts);
  }
  const blocks = (body?.blocks ?? []).map(renderBlock).join("");

  // Optional availability scheduler — an inset panel with a stamped-yellow
  // button to the magic-token picker.
  const schedulerBlock = opts.scheduler
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:26px 0 6px;"><tr><td bgcolor="#0B0B0B" style="background:${FE.SURFACE};border:1px solid ${FE.LINE};border-radius:14px;padding:24px;text-align:center;">
<p style="margin:0 0 14px;font-family:${MONO};font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${FE.YELLOW};">&bull;&nbsp;&nbsp;Find a time to talk</p>
<table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td bgcolor="${FE.YELLOW}" style="background:${FE.YELLOW};border-radius:12px;">
<a href="${esc(opts.scheduler.url)}" style="display:inline-block;padding:15px 34px;font-family:${FFSA_FONTS.DISPLAY};font-size:14px;font-weight:900;letter-spacing:0.04em;text-transform:uppercase;color:${FE.BLACK};text-decoration:none;">${esc(opts.scheduler.label)}&nbsp;&nbsp;&rarr;</a>
</td></tr></table></td></tr></table>`
    : "";

  const prefsLink = `<a href="${esc(opts.prefsUrl)}" style="color:${FE.DIM};text-decoration:underline;">Manage email preferences</a>`;

  return ffsaEmailDocument({
    title: opts.previewText,
    previewText: opts.previewText,
    siteUrl: opts.baseUrl,
    bodyHtml:
      (blocks + schedulerBlock) ||
      `<p style="font-family:${SANS};font-size:15px;color:${FE.BONE};">&nbsp;</p>`,
    footerExtraHtml: prefsLink,
  });
}

// ============================================================
// THE SEND variant — same block editor, swapped chrome + per-block
// styling. Lives next to the F&F renderer so the two stay in lockstep
// as block types are added.
// ============================================================

const S = SEND_COLORS;
const SF = SEND_FONTS;

// SEND-styled rich text — same allowed tags as F&F so the block editor
// produces the same shape; only the inline styles differ (navy text,
// gold underline on links, body font Helvetica).
function sendRichText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "a", "span", "ul", "ol", "li"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    transformTags: {
      a: (_t, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          style: `color:${S.NAVY};text-decoration:underline;text-decoration-color:${S.GOLD};`,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      p: () => ({
        tagName: "p",
        attribs: {
          style: `margin:0 0 4px;font-family:${SF.BODY};font-size:15px;line-height:1.65;color:${S.NAVY};`,
        },
      }),
    },
  });
}

function renderSendBlock(b: CampaignBlock): string {
  switch (b.type) {
    case "eyebrow":
      return sendEyebrow(b.text);

    case "heading":
      return `${b.eyebrow ? sendEyebrow(b.eyebrow) : ""}${sendHeading(b.text)}`;

    case "text":
      return `<div style="margin:0 0 6px;font-family:${SF.BODY};font-size:15px;line-height:1.65;color:${S.NAVY};">${sendRichText(b.text)}</div>`;

    case "button":
      return sendButton(b.url, b.text, b.style ?? "filled");

    case "image":
      return sendImage(b.url, b.alt, b.caption);

    case "quote":
      return sendQuote(b.text, b.attribution);

    case "divider":
      return sendDivider(b.style ?? "rule");

    case "spacer":
      return sendSpacer(b.size ?? "md");

    case "image-text":
      return `${sendImage(b.url, b.alt)}${
        b.heading
          ? `<h2 style="margin:0 0 6px;font-family:${SF.DISPLAY};font-size:20px;line-height:1.1;font-weight:900;text-transform:uppercase;color:${S.NAVY};">${sendEsc(b.heading)}</h2>`
          : ""
      }<div style="margin:0 0 6px;font-family:${SF.BODY};font-size:15px;line-height:1.65;color:${S.NAVY};">${sendRichText(b.text)}</div>`;

    default:
      return "";
  }
}

export function renderTheSendWorkflowEmail(
  body: CampaignBody | null | undefined,
  opts: WorkflowEmailOpts
): string {
  const blocks = (body?.blocks ?? []).map(renderSendBlock).join("");

  // Scheduler — framed cream card with a navy pill button so it reads
  // as an action inside the SEND aesthetic.
  const schedulerBlock = opts.scheduler
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0 6px;"><tr><td style="background:${S.CREAM};border:2px solid ${S.NAVY};padding:22px;text-align:center;">
<p style="margin:0 0 14px;font-family:${SF.MONO};font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${S.BLUE};">// Find a time to talk</p>
${sendButton(opts.scheduler.url, opts.scheduler.label, "filled")}
</td></tr></table>`
    : "";

  // Preferences link footer — appended INSIDE the chrome body so it
  // sits on the cream paper above the navy footer. The chrome itself
  // doesn't know about prefsUrl.
  const prefsFooter = `<p style="margin:28px 0 0;padding-top:18px;border-top:2px dashed ${S.NAVY};font-family:${SF.MONO};font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${S.NAVY};opacity:0.75;text-align:center;"><a href="${sendEsc(opts.prefsUrl)}" style="color:${S.NAVY};text-decoration:underline;">Manage email preferences</a></p>`;

  const bodyHtml =
    (blocks + schedulerBlock) ||
    `<p style="font-family:${SF.BODY};font-size:15px;color:${S.NAVY};">&nbsp;</p>`;

  return theSendChrome({
    previewText: opts.previewText,
    bodyHtml: bodyHtml + prefsFooter,
    siteUrl: opts.baseUrl,
  });
}

// ============================================================
// FFSA CAMPS variant — same block editor, swapped chrome + per-block
// styling. Lives next to the F&F + SEND renderers so all three stay in
// lockstep as block types are added. Blue/cream palette, heavy italic
// display, no mono device.
// ============================================================

const CC = CAMPS_COLORS;
const CF = CAMPS_FONTS;
const CAMPS_DISPLAY = `font-family:${CF.DISPLAY};font-style:italic;font-weight:900;`;

// Camps-styled rich text — same allowed tags as F&F/SEND so the block
// editor produces the same shape; only the inline styles differ (ink
// text, blue underline on links, body font Helvetica).
function campsRichText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "a", "span", "ul", "ol", "li"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    transformTags: {
      a: (_t, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          style: `color:${CC.BLUE};text-decoration:underline;text-decoration-color:${CC.BLUE};`,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      p: () => ({
        tagName: "p",
        attribs: {
          style: `margin:0 0 4px;font-family:${CF.BODY};font-size:15px;line-height:1.65;color:${CC.INK};`,
        },
      }),
    },
  });
}

function renderCampsBlock(b: CampaignBlock): string {
  switch (b.type) {
    case "eyebrow":
      return campsEyebrow(b.text);

    case "heading":
      return `${b.eyebrow ? campsEyebrow(b.eyebrow) : ""}${campsHeading(b.text)}`;

    case "text":
      return `<div style="margin:0 0 6px;font-family:${CF.BODY};font-size:15px;line-height:1.65;color:${CC.INK};">${campsRichText(b.text)}</div>`;

    case "button":
      return campsButton(b.url, b.text, b.style ?? "filled");

    case "image":
      return campsImage(b.url, b.alt, b.caption);

    case "quote":
      return campsQuote(b.text, b.attribution);

    case "divider":
      return campsDivider(b.style ?? "rule");

    case "spacer":
      return campsSpacer(b.size ?? "md");

    case "image-text":
      return `${campsImage(b.url, b.alt)}${
        b.heading
          ? `<h2 style="margin:0 0 6px;${CAMPS_DISPLAY}font-size:20px;line-height:1.05;text-transform:uppercase;color:${CC.INK};">${campsEsc(b.heading)}</h2>`
          : ""
      }<div style="margin:0 0 6px;font-family:${CF.BODY};font-size:15px;line-height:1.65;color:${CC.INK};">${campsRichText(b.text)}</div>`;

    default:
      return "";
  }
}

export function renderCampsWorkflowEmail(
  body: CampaignBody | null | undefined,
  opts: WorkflowEmailOpts
): string {
  const blocks = (body?.blocks ?? []).map(renderCampsBlock).join("");

  // Scheduler — framed cream card with a blue pill button so it reads
  // as an action inside the FFSA Camps aesthetic.
  const schedulerBlock = opts.scheduler
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0 6px;"><tr><td style="background:${CC.WHITE};border:2px solid ${CC.BLUE};padding:22px;text-align:center;">
<p style="margin:0 0 14px;font-family:${CF.BODY};font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${CC.BLUE};">Find a time to talk</p>
${campsButton(opts.scheduler.url, opts.scheduler.label, "filled")}
</td></tr></table>`
    : "";

  // Preferences link footer — appended INSIDE the chrome body so it
  // sits on the cream paper above the blue footer. The chrome itself
  // doesn't know about prefsUrl.
  const prefsFooter = `<p style="margin:28px 0 0;padding-top:18px;border-top:2px dashed ${CC.BLUE};font-family:${CF.BODY};font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${CC.INK};opacity:0.75;text-align:center;"><a href="${campsEsc(opts.prefsUrl)}" style="color:${CC.INK};text-decoration:underline;">Manage email preferences</a></p>`;

  const bodyHtml =
    (blocks + schedulerBlock) ||
    `<p style="font-family:${CF.BODY};font-size:15px;color:${CC.INK};">&nbsp;</p>`;

  return campsChrome({
    previewText: opts.previewText,
    bodyHtml: bodyHtml + prefsFooter,
    siteUrl: opts.baseUrl,
  });
}

// ============================================================
// PREACHERS SA variant — same block editor, swapped chrome + per-block
// styling. Lives next to the F&F + SEND + Camps renderers so all four
// stay in lockstep as block types are added. DARK gunmetal navy paper,
// aged bone type, condensed heavy caps, strictly monochrome.
// ============================================================

const PC = PREACHERS_COLORS;
const PF = PREACHERS_FONTS;
const PREACHERS_DISPLAY = `font-family:${PF.DISPLAY};font-weight:900;`;

// PREACHERS-styled rich text — same allowed tags as F&F/SEND/Camps so the
// block editor produces the same shape; only the inline styles differ
// (off-white text on navy, bone underline on links, body font Helvetica).
function preachersRichText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "a", "span", "ul", "ol", "li"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    transformTags: {
      a: (_t, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          style: `color:${PC.BONE};text-decoration:underline;text-decoration-color:${PC.BONE};`,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      p: () => ({
        tagName: "p",
        attribs: {
          style: `margin:0 0 4px;font-family:${PF.BODY};font-size:15px;line-height:1.65;color:${PC.OFFWHITE};`,
        },
      }),
    },
  });
}

function renderPreachersBlock(b: CampaignBlock): string {
  switch (b.type) {
    case "eyebrow":
      return preachersEyebrow(b.text);

    case "heading":
      return `${b.eyebrow ? preachersEyebrow(b.eyebrow) : ""}${preachersHeading(b.text)}`;

    case "text":
      return `<div style="margin:0 0 6px;font-family:${PF.BODY};font-size:15px;line-height:1.65;color:${PC.OFFWHITE};">${preachersRichText(b.text)}</div>`;

    case "button":
      return preachersButton(b.url, b.text, b.style ?? "filled");

    case "image":
      return preachersImage(b.url, b.alt, b.caption);

    case "quote":
      return preachersQuote(b.text, b.attribution);

    case "divider":
      return preachersDivider(b.style ?? "rule");

    case "spacer":
      return preachersSpacer(b.size ?? "md");

    case "image-text":
      return `${preachersImage(b.url, b.alt)}${
        b.heading
          ? `<h2 style="margin:0 0 6px;${PREACHERS_DISPLAY}font-size:22px;line-height:1.02;text-transform:uppercase;color:${PC.BONE};">${preachersEsc(b.heading)}</h2>`
          : ""
      }<div style="margin:0 0 6px;font-family:${PF.BODY};font-size:15px;line-height:1.65;color:${PC.OFFWHITE};">${preachersRichText(b.text)}</div>`;

    default:
      return "";
  }
}

export function renderPreachersWorkflowEmail(
  body: CampaignBody | null | undefined,
  opts: WorkflowEmailOpts
): string {
  const blocks = (body?.blocks ?? []).map(renderPreachersBlock).join("");

  // Scheduler — framed ink card with a bone stamp button so it reads as
  // an action inside the PREACHERS aesthetic.
  const schedulerBlock = opts.scheduler
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0 6px;"><tr><td style="background:${PC.INK};border:2px solid ${PC.LINE};padding:22px;text-align:center;">
<p style="margin:0 0 14px;font-family:${PF.BODY};font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${PC.BONE};opacity:0.8;">Find a time to talk</p>
${preachersButton(opts.scheduler.url, opts.scheduler.label, "filled")}
</td></tr></table>`
    : "";

  // Preferences link footer — appended INSIDE the chrome body so it sits
  // on the navy paper above the ink footer. The chrome itself doesn't
  // know about prefsUrl.
  const prefsFooter = `<p style="margin:28px 0 0;padding-top:18px;border-top:2px dashed ${PC.LINE};font-family:${PF.BODY};font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${PC.OFFWHITE};opacity:0.7;text-align:center;"><a href="${preachersEsc(opts.prefsUrl)}" style="color:${PC.OFFWHITE};text-decoration:underline;">Manage email preferences</a></p>`;

  const bodyHtml =
    (blocks + schedulerBlock) ||
    `<p style="font-family:${PF.BODY};font-size:15px;color:${PC.OFFWHITE};">&nbsp;</p>`;

  return preachersChrome({
    previewText: opts.previewText,
    bodyHtml: bodyHtml + prefsFooter,
    siteUrl: opts.baseUrl,
  });
}

// ============================================================
// WILD ONES variant — same block editor, swapped chrome + per-block
// styling. Lives next to the F&F + SEND + Camps + PREACHERS renderers so
// all stay in lockstep as block types are added. DARK charcoal paper,
// bone type, condensed Oswald caps, one ember-orange accent.
// ============================================================

const WC = WILD_ONES_COLORS;
const WF = WILD_ONES_FONTS;
const WILD_ONES_DISPLAY = `font-family:${WF.DISPLAY};font-weight:700;`;

// WILD ONES-styled rich text — same allowed tags as the sibling brands so
// the block editor produces the same shape; only the inline styles differ
// (bone text on charcoal, ember underline on links, body font Helvetica).
function wildOnesRichText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "a", "span", "ul", "ol", "li"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    transformTags: {
      a: (_t, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          style: `color:${WC.EMBER};text-decoration:underline;text-decoration-color:${WC.EMBER};`,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      p: () => ({
        tagName: "p",
        attribs: {
          style: `margin:0 0 4px;font-family:${WF.BODY};font-size:15px;line-height:1.65;color:${WC.BONE};`,
        },
      }),
    },
  });
}

function renderWildOnesBlock(b: CampaignBlock): string {
  switch (b.type) {
    case "eyebrow":
      return wildOnesEyebrow(b.text);

    case "heading":
      return `${b.eyebrow ? wildOnesEyebrow(b.eyebrow) : ""}${wildOnesHeading(b.text)}`;

    case "text":
      return `<div style="margin:0 0 6px;font-family:${WF.BODY};font-size:15px;line-height:1.65;color:${WC.BONE};">${wildOnesRichText(b.text)}</div>`;

    case "button":
      return wildOnesButton(b.url, b.text, b.style ?? "filled");

    case "image":
      return wildOnesImage(b.url, b.alt, b.caption);

    case "quote":
      return wildOnesQuote(b.text, b.attribution);

    case "divider":
      return wildOnesDivider(b.style ?? "rule");

    case "spacer":
      return wildOnesSpacer(b.size ?? "md");

    case "image-text":
      return `${wildOnesImage(b.url, b.alt)}${
        b.heading
          ? `<h2 style="margin:0 0 6px;${WILD_ONES_DISPLAY}font-size:22px;line-height:1.02;text-transform:uppercase;color:${WC.OFFWHITE};">${wildOnesEsc(b.heading)}</h2>`
          : ""
      }<div style="margin:0 0 6px;font-family:${WF.BODY};font-size:15px;line-height:1.65;color:${WC.BONE};">${wildOnesRichText(b.text)}</div>`;

    default:
      return "";
  }
}

export function renderWildOnesWorkflowEmail(
  body: CampaignBody | null | undefined,
  opts: WorkflowEmailOpts
): string {
  const blocks = (body?.blocks ?? []).map(renderWildOnesBlock).join("");

  // Scheduler — framed ink card with an ember stamp button so it reads as
  // an action inside the WILD ONES aesthetic.
  const schedulerBlock = opts.scheduler
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0 6px;"><tr><td style="background:${WC.INK};border:2px solid ${WC.LINE};padding:22px;text-align:center;">
<p style="margin:0 0 14px;font-family:${WF.BODY};font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${WC.EMBER};">Find a time to talk</p>
${wildOnesButton(opts.scheduler.url, opts.scheduler.label, "filled")}
</td></tr></table>`
    : "";

  // Preferences link footer — appended INSIDE the chrome body so it sits
  // on the charcoal paper above the ink footer. The chrome itself doesn't
  // know about prefsUrl.
  const prefsFooter = `<p style="margin:28px 0 0;padding-top:18px;border-top:2px dashed ${WC.LINE};font-family:${WF.BODY};font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${WC.BONE};opacity:0.7;text-align:center;"><a href="${wildOnesEsc(opts.prefsUrl)}" style="color:${WC.EMBER};text-decoration:underline;">Manage email preferences</a></p>`;

  const bodyHtml =
    (blocks + schedulerBlock) ||
    `<p style="font-family:${WF.BODY};font-size:15px;color:${WC.BONE};">&nbsp;</p>`;

  return wildOnesChrome({
    previewText: opts.previewText,
    bodyHtml: bodyHtml + prefsFooter,
    siteUrl: opts.baseUrl,
  });
}

// ============================================================
// MISSIO workflow email — mirrors the WILD ONES variant above but in the
// MISSIO chrome. LIGHT off-white paper, near-black type and rules, bold
// Archivo caps, no accent colour.
// ============================================================

const MC = MISSIO_COLORS;
const MF = MISSIO_FONTS;
const MISSIO_DISPLAY = `font-family:${MF.DISPLAY};font-weight:800;`;

// MISSIO-styled rich text — same allowed tags as the sibling brands so
// the block editor produces the same shape; only the inline styles differ
// (near-black text on off-white, underlined links, body font Archivo).
function missioRichText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "a", "span", "ul", "ol", "li"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    transformTags: {
      a: (_t, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          style: `color:${MC.INK};text-decoration:underline;text-decoration-color:${MC.INK};`,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      p: () => ({
        tagName: "p",
        attribs: {
          style: `margin:0 0 4px;font-family:${MF.BODY};font-size:15px;line-height:1.65;color:${MC.INK};`,
        },
      }),
    },
  });
}

function renderMissioBlock(b: CampaignBlock): string {
  switch (b.type) {
    case "eyebrow":
      return missioEyebrow(b.text);

    case "heading":
      return `${b.eyebrow ? missioEyebrow(b.eyebrow) : ""}${missioHeading(b.text)}`;

    case "text":
      return `<div style="margin:0 0 6px;font-family:${MF.BODY};font-size:15px;line-height:1.65;color:${MC.INK};">${missioRichText(b.text)}</div>`;

    case "button":
      return missioButton(b.url, b.text, b.style ?? "filled");

    case "image":
      return missioImage(b.url, b.alt, b.caption);

    case "quote":
      return missioQuote(b.text, b.attribution);

    case "divider":
      return missioDivider(b.style ?? "rule");

    case "spacer":
      return missioSpacer(b.size ?? "md");

    case "image-text":
      return `${missioImage(b.url, b.alt)}${
        b.heading
          ? `<h2 style="margin:0 0 6px;${MISSIO_DISPLAY}font-size:22px;line-height:1.02;text-transform:uppercase;color:${MC.INK};">${missioEsc(b.heading)}</h2>`
          : ""
      }<div style="margin:0 0 6px;font-family:${MF.BODY};font-size:15px;line-height:1.65;color:${MC.INK};">${missioRichText(b.text)}</div>`;

    default:
      return "";
  }
}

export function renderMissioWorkflowEmail(
  body: CampaignBody | null | undefined,
  opts: WorkflowEmailOpts
): string {
  const blocks = (body?.blocks ?? []).map(renderMissioBlock).join("");

  // Scheduler — a framed surface card with the black primary button so it
  // reads as an action inside the MISSIO aesthetic.
  const schedulerBlock = opts.scheduler
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0 6px;"><tr><td style="background:${MC.SURFACE};border:1px solid ${MC.INK};padding:24px;text-align:center;">
<p style="margin:0 0 14px;font-family:${MF.BODY};font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${MC.MUTED};">Find a time to talk</p>
${missioButton(opts.scheduler.url, opts.scheduler.label, "filled")}
</td></tr></table>`
    : "";

  // Preferences link footer — appended INSIDE the chrome body so it sits
  // on the paper above the footer. The chrome itself doesn't
  // know about prefsUrl.
  const prefsFooter = `<p style="margin:28px 0 0;padding-top:18px;border-top:1px solid ${MC.HAIRLINE};font-family:${MF.BODY};font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${MC.MUTED};text-align:center;"><a href="${missioEsc(opts.prefsUrl)}" style="color:${MC.MUTED};text-decoration:underline;">Manage email preferences</a></p>`;

  const bodyHtml =
    (blocks + schedulerBlock) ||
    `<p style="font-family:${MF.BODY};font-size:15px;color:${MC.INK};">&nbsp;</p>`;

  return missioChrome({
    previewText: opts.previewText,
    bodyHtml: bodyHtml + prefsFooter,
    siteUrl: opts.baseUrl,
  });
}
