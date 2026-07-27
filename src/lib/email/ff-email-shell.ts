// ============================================================
// Fire & Fragrance email shell (the scheduling set)
// ============================================================
// Now a thin adapter over the canonical FFSA editorial-black chrome
// (ffsa-chrome.ts) — the same identity as the ticketing landing page.
// The scheduling templates (scheduling-request / -confirmed /
// -slots-submitted) call these helpers; keeping the ff* names + signatures
// means those templates are unchanged while the look is unified.
// ============================================================

import {
  feEsc,
  feEyebrow,
  feHeading,
  feParagraph,
  feStrongLine,
  feQuote,
  feButton,
  feList,
  ffsaEmailDocument,
} from "./ffsa-chrome";

export function ffEsc(s: string | null | undefined): string {
  return feEsc(s);
}

export function ffEyebrow(text: string): string {
  return feEyebrow(text);
}

export function ffHeading(text: string): string {
  return feHeading(text);
}

// Caller is responsible for escaping any dynamic values spliced into `html`.
export function ffParagraph(html: string): string {
  return feParagraph(html);
}

export function ffStrongLine(text: string): string {
  return feStrongLine(text);
}

export function ffQuote(text: string): string {
  return feQuote(text);
}

export function ffButton(url: string, label: string): string {
  return feButton(url, label, "filled");
}

export function ffList(items: string[]): string {
  return feList(items);
}

// ── Shell ────────────────────────────────────────────────────

export function ffEmailShell(opts: {
  previewText?: string;
  content: string;
}): string {
  return ffsaEmailDocument({
    previewText: opts.previewText,
    bodyHtml: opts.content,
  });
}
