// ============================================================
// Fire & Fragrance workflow-email template
// ============================================================
// A fixed, branded shell every workflow step email renders inside —
// the block editor only supplies the copy.
//
// IMPORTANT: this is the *Fire & Fragrance* brand (the hub's parent),
// NOT "The Send". The two are distinct identities and must never be
// designed using each other. F&F = Roboto / Roboto Mono, black + gold
// + white, black pill buttons (source: fireandfragrance.com). The
// Send's navy/red/blue ticket aesthetic lives only in its own template.
//
// Email-safe: inline CSS, single 600px table. Roboto / Roboto Mono are
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

const BLACK = "#141414"; // masthead / footer
const INK = "#1A1A1A"; // headings + body text
const GOLD = "#F5C84B"; // the F&F accent
const PAPER = "#FBFAF7"; // warm near-white body
const MUTED = "#6E6E6E";
const WHITE = "#FFFFFF";

const SANS = "'Roboto',Arial,Helvetica,sans-serif";
const MONO = "'Roboto Mono','Courier New',Courier,monospace";

const FONT_LINK =
  '<link href="https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,400;0,500;0,700;0,900;1,400;1,700&family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet" />';

function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
          style: `color:${INK};text-decoration:underline;text-decoration-color:${GOLD};`,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      p: () => ({
        tagName: "p",
        attribs: {
          style: `margin:0 0 2px;font-family:${SANS};font-size:15px;line-height:1.45;color:${INK};`,
        },
      }),
    },
  });
}

function eyebrow(text: string): string {
  return `<p style="margin:0 0 8px;font-family:${MONO};font-size:11px;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;color:${INK};"><span style="color:${GOLD};">&bull;</span>&nbsp;&nbsp;${esc(text)}</p>`;
}

function renderBlock(b: CampaignBlock): string {
  switch (b.type) {
    case "eyebrow":
      return eyebrow(b.text);

    case "heading":
      return `${b.eyebrow ? eyebrow(b.eyebrow) : ""}<h1 style="margin:0 0 8px;font-family:${SANS};font-size:30px;line-height:1.06;font-weight:900;letter-spacing:-0.015em;text-transform:uppercase;color:${INK};">${esc(b.text)}</h1>`;

    case "text":
      return `<div style="margin:0 0 6px;font-family:${SANS};font-size:15px;line-height:1.45;color:${INK};">${richText(b.text)}</div>`;

    case "button": {
      const style = b.style ?? "filled";
      if (style === "link") {
        return `<p style="margin:6px 0 18px;"><a href="${esc(b.url)}" style="font-family:${SANS};font-size:15px;font-weight:700;color:${INK};text-decoration:underline;text-decoration-color:${GOLD};">${esc(b.text)} &rarr;</a></p>`;
      }
      const outline = style === "outline";
      const bg = outline ? PAPER : BLACK;
      const fg = outline ? INK : WHITE;
      const border = outline ? `2px solid ${INK}` : `2px solid ${BLACK}`;
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;"><tr><td style="border-radius:999px;background:${bg};border:${border};">
<a href="${esc(b.url)}" style="display:inline-block;padding:13px 30px;font-family:${SANS};font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${fg};text-decoration:none;">${esc(b.text)}</a>
</td></tr></table>`;
    }

    case "image":
      return `<p style="margin:0 0 16px;"><img src="${esc(b.url)}" alt="${esc(b.alt)}" width="544" style="display:block;width:100%;max-width:544px;height:auto;border:0;border-radius:10px;" />${
        b.caption
          ? `<span style="display:block;margin-top:6px;font-family:${MONO};font-size:11px;color:${MUTED};">${esc(b.caption)}</span>`
          : ""
      }</p>`;

    case "quote":
      return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:6px 0 18px;"><tr>
<td style="border-left:4px solid ${GOLD};padding:4px 0 4px 18px;font-family:${SANS};font-size:18px;line-height:1.5;font-style:italic;color:${INK};">${esc(b.text)}${
        b.attribution
          ? `<span style="display:block;margin-top:8px;font-family:${MONO};font-size:11px;font-style:normal;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">&mdash; ${esc(b.attribution)}</span>`
          : ""
      }</td></tr></table>`;

    case "divider": {
      const s = b.style ?? "rule";
      if (s === "space") return `<div style="height:20px;line-height:20px;font-size:0;">&nbsp;</div>`;
      if (s === "dots")
        return `<p style="margin:14px 0;text-align:center;font-family:${MONO};font-size:16px;letter-spacing:0.4em;color:${GOLD};">&middot;&nbsp;&middot;&nbsp;&middot;</p>`;
      return `<div style="margin:20px 0;border-top:1px solid ${INK};opacity:0.14;line-height:0;font-size:0;">&nbsp;</div>`;
    }

    case "spacer": {
      const h = { sm: 8, md: 16, lg: 28, xl: 44 }[b.size ?? "md"];
      return `<div style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</div>`;
    }

    case "image-text":
      return `<p style="margin:0 0 8px;"><img src="${esc(b.url)}" alt="${esc(b.alt)}" width="544" style="display:block;width:100%;max-width:544px;height:auto;border:0;border-radius:10px;" /></p>${
        b.heading
          ? `<h2 style="margin:0 0 4px;font-family:${SANS};font-size:20px;line-height:1.15;font-weight:900;text-transform:uppercase;color:${INK};">${esc(b.heading)}</h2>`
          : ""
      }<div style="margin:0 0 6px;font-family:${SANS};font-size:15px;line-height:1.45;color:${INK};">${richText(b.text)}</div>`;

    default:
      return "";
  }
}

export type WorkflowEmailBrand = "ff" | "the_send" | "ffsa_camps" | "preachers";

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
  if (opts.brand === "the_send") {
    return renderTheSendWorkflowEmail(body, opts);
  }
  const base = opts.baseUrl.replace(/\/$/, "");
  const blocks = (body?.blocks ?? []).map(renderBlock).join("");

  // Optional availability scheduler — a framed card with a pill button to the
  // magic-token picker. Recipient proposes times; they land on the follow-up.
  const schedulerBlock = opts.scheduler
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0 6px;"><tr><td style="background:${WHITE};border:1px solid rgba(20,20,20,0.14);border-radius:10px;padding:22px;text-align:center;">
<p style="margin:0 0 14px;font-family:${MONO};font-size:11px;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;color:${INK};"><span style="color:${GOLD};">&bull;</span>&nbsp;&nbsp;Find a time to talk</p>
<table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td style="border-radius:999px;background:${BLACK};">
<a href="${esc(opts.scheduler.url)}" style="display:inline-block;padding:14px 34px;font-family:${SANS};font-size:14px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${WHITE};text-decoration:none;">${esc(opts.scheduler.label)}</a>
</td></tr></table></td></tr></table>`
    : "";

  const preview = opts.previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${PAPER};">${esc(opts.previewText)}</div>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />${FONT_LINK}</head>
<body style="margin:0;padding:0;background:${BLACK};font-family:${SANS};color:${INK};">
${preview}
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${BLACK};padding:28px 10px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:${PAPER};table-layout:fixed;border-radius:8px;overflow:hidden;">

  <!-- Masthead -->
  <tr><td style="background:${BLACK};padding:18px 28px;border-bottom:2px solid ${GOLD};">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
      <td valign="middle">
        <img src="${base}/brand/ff-wordmark-white@email.png" alt="Fire &amp; Fragrance" width="148" height="auto" style="display:block;width:148px;height:auto;" />
      </td>
      <td valign="middle" align="right" style="font-family:${MONO};font-size:10px;color:${GOLD};letter-spacing:0.2em;text-transform:uppercase;">South&nbsp;Africa</td>
    </tr></table>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:${PAPER};padding:36px 30px 14px 30px;">
    ${(blocks + schedulerBlock) || `<p style="font-family:${SANS};font-size:15px;color:${INK};">&nbsp;</p>`}
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:${BLACK};border-top:2px solid ${GOLD};padding:28px 30px;text-align:center;">
    <img src="${base}/brand/ff-wordmark-white@email.png" alt="Fire &amp; Fragrance" width="124" height="auto" style="display:inline-block;width:124px;height:auto;" />
    <p style="margin:12px 0 0;font-family:${MONO};font-size:10px;color:${GOLD};letter-spacing:0.2em;text-transform:uppercase;">Fire &amp; Fragrance South Africa</p>
    <p style="margin:10px 0 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${WHITE};opacity:0.78;">
      <a href="${esc(opts.prefsUrl)}" style="color:${WHITE};text-decoration:underline;">Manage email preferences</a>
    </p>
    <p style="margin:8px 0 0;font-family:${MONO};font-size:9px;color:${WHITE};letter-spacing:0.16em;text-transform:uppercase;opacity:0.5;">Powered by FFSA Hub</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
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
