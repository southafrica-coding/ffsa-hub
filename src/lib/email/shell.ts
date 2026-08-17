import { FFSA_COLORS } from "@/lib/brand/ffsa";
import {
  FE,
  feEsc,
  feEyebrow,
  feHeading,
  feParagraph,
  feStrong,
  feButton,
  feNotice,
  ffsaEmailDocument,
} from "./ffsa-chrome";

// Shared branded email shell for FFSA Hub transactional emails.
//
// All "standard" templates (applications, references, invites, staff
// notifications, enrollment) compose their body through `renderEmailShell`,
// which now renders the canonical FFSA editorial-black chrome (see
// ffsa-chrome.ts) — the same identity as the ticketing landing page. This
// module keeps its historical signature + exports so every template is
// unchanged; only the look is unified.
//
// Bespoke event templates (THE SEND / Camps / PREACHERS) keep their own
// chrome — they don't route through here.

// Back-compat palette export. Templates that reference EMAIL_COLORS keep
// working; the values map onto the shared chrome tokens (FE).
export const EMAIL_COLORS = {
  BG: FE.BLACK,
  CARD: FE.SURFACE,
  BORDER: FE.LINE,
  TEXT: FE.WHITE,
  TEXT_DIM: FE.BONE,
  TEXT_DIMMER: FE.DIM,
  TEXT_FAINT: FE.FAINT,
  YELLOW: FE.YELLOW,
  GREEN: FE.GREEN,
  BLUE: FE.BLUE,
  BONE: FE.BONE,
} as const;

/** Kept for templates that still import escapeHtml from the shell. */
export const escapeHtml = feEsc;

export interface EmailCta {
  label: string;
  url: string;
}

export interface EmailShellOptions {
  /** Browser tab title. Defaults to the eyebrow. */
  title?: string;
  /** Hidden inbox-preview text (Gmail/iOS). */
  preheader?: string;
  /** Small uppercase label above the heading. */
  eyebrow: string;
  /** Main heading. Supports a single `<br/>` if needed. */
  heading: string;
  /** Raw inner HTML for the body — sanitise upstream. */
  bodyHtml: string;
  /**
   * Optional inset panel rendered below the body and above the CTA. Like the
   * CTA, it survives a leader rewriting the body copy (see
   * resolveProgramEmail) — use it for something the email must always say.
   */
  notice?: { label: string; html: string } | null;
  /** Optional primary call-to-action button. */
  cta?: EmailCta;
  /** Footer tagline. Ignored now — the chrome renders the deck slogan +
   *  contact row. Kept in the type so existing callers still compile. */
  tagline?: string | null;
  /** Used to build absolute URLs for embedded brand images. */
  siteUrl?: string | null;
}

/**
 * Renders the full branded email HTML around the given body content, in
 * the canonical FFSA editorial-black chrome (matches the landing page).
 */
export function renderEmailShell(opts: EmailShellOptions): string {
  const body = `${feEyebrow(opts.eyebrow)}${feHeading(opts.heading, {
    raw: true,
  })}${opts.bodyHtml}${
    opts.notice ? feNotice(opts.notice.label, opts.notice.html) : ""
  }${opts.cta ? feButton(opts.cta.url, opts.cta.label) : ""}`;

  return ffsaEmailDocument({
    title: opts.title ?? opts.eyebrow,
    previewText: opts.preheader,
    siteUrl: opts.siteUrl,
    bodyHtml: body,
  });
}

/**
 * Convenience helper for body paragraphs in the brand body colour.
 * Use inside `bodyHtml` so tone stays consistent.
 */
export function bodyParagraph(html: string): string {
  return feParagraph(html);
}

/** Strong inline highlight that matches body copy. */
export function emphasis(html: string): string {
  return feStrong(html);
}

// Re-export so anything reaching for the raw brand yellow still resolves.
export const BRAND_YELLOW = FFSA_COLORS.YELLOW;
