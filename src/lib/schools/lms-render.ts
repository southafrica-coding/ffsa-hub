// Lesson bodies are plain text typed into a textarea. Render that text
// with line breaks kept, every character escaped, and bare http(s) URLs
// turned into links. Never parse the body as HTML: a pasted <script> or
// an <a href="javascript:"> must show up as text, not run.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Absolute http(s) only. javascript:, data:, and anything else stay text. */
function httpUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * Drop sentence punctuation that is not part of the URL.
 * A ")" stays when it closes a "(" inside the URL
 * (https://en.wikipedia.org/wiki/Foo_(bar)) and comes off when it only
 * closes the surrounding sentence.
 */
export function splitUrlTrailingPunctuation(raw: string): { core: string; suffix: string } {
  let core = raw;
  let suffix = "";
  while (/[.,;:!?\]]$/.test(core)) {
    suffix = core.slice(-1) + suffix;
    core = core.slice(0, -1);
  }
  while (core.endsWith(")") && unmatchedClosingParens(core) > 0) {
    suffix = ")" + suffix;
    core = core.slice(0, -1);
  }
  return { core, suffix };
}

function unmatchedClosingParens(value: string): number {
  let depth = 0;
  let extra = 0;
  for (const character of value) {
    if (character === "(") depth += 1;
    else if (character === ")") {
      if (depth === 0) extra += 1;
      else depth -= 1;
    }
  }
  return extra;
}

/**
 * Escape `body` and wrap each plain http(s) URL in an anchor.
 * Trailing sentence punctuation stays outside the link.
 */
export function linkifyLessonText(body: string | null | undefined): string {
  const value = (body ?? "").toString().replace(/\r\n/g, "\n").trim();
  if (!value) return "";

  let html = "";
  let last = 0;
  // A fresh regex each call: a shared /g pattern keeps lastIndex and can
  // skip the next lesson's links.
  const urls = /https?:\/\/[^\s<>"']+/gi;
  for (const match of value.matchAll(urls)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const { core, suffix } = splitUrlTrailingPunctuation(raw);
    html += escapeHtml(value.slice(last, start));
    const href = httpUrl(core);
    if (href) {
      const safe = escapeHtml(href);
      html += `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
      html += escapeHtml(suffix);
    } else {
      html += escapeHtml(raw);
    }
    last = start + raw.length;
  }
  html += escapeHtml(value.slice(last));
  return html.replace(/\n/g, "<br/>");
}

/** What students see for a rich_text lesson. Same output as linkifyLessonText. */
export function sanitizeLessonBody(body: string | null | undefined): string {
  return linkifyLessonText(body);
}
