import sanitizeHtml from "sanitize-html";

// ────────────────────────────────────────────────────────────
// Event description rich text
//
// Event descriptions used to be plain text typed into a <textarea> and
// rendered as a bare paragraph — line breaks collapsed and there was no
// way to format a schedule/agenda. They are now authored with a TipTap
// editor (src/components/events/description-editor.tsx) that emits a
// small, safe subset of HTML: paragraphs, line breaks, bold/italic,
// headings, bullet/numbered lists and links.
//
// This module is the single sanitisation choke point. It runs on the
// server (in the storefront's parent page) before the HTML reaches any
// storefront, so it covers every write path — the edit API and the
// direct-supabase create form alike — and keeps sanitize-html out of the
// client bundle.
// ────────────────────────────────────────────────────────────

const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "a",
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Returns clean HTML safe to render with dangerouslySetInnerHTML, or "".
 * Plain-text drafts written before rich text shipped are preserved by
 * escaping them and converting newlines to <br> so their spacing survives.
 */
export function sanitizeEventDescription(
  input: string | null | undefined
): string {
  const value = (input ?? "").toString().trim();
  if (!value) return "";

  // No tags → legacy plain-text draft: escape + preserve line breaks.
  if (!/<[a-z][\s\S]*>/i.test(value)) {
    return escapeHtml(value).replace(/\n/g, "<br/>");
  }

  return sanitizeHtml(value, {
    allowedTags: ALLOWED_TAGS,
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

/**
 * Strips the description down to plain text for contexts that can't render
 * markup — link-preview/meta descriptions and OG cards.
 */
export function eventDescriptionToPlainText(
  input: string | null | undefined
): string {
  const value = (input ?? "").toString();
  if (!value) return "";
  const stripped = sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
  });
  // Decode the handful of entities the stripper leaves behind, then
  // collapse whitespace so the one-line preview reads cleanly.
  return stripped
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
