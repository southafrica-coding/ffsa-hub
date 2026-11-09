import { sanitizeEventDescription } from "@/lib/events/rich-text";

// Server-only rendering of rich_text lesson bodies. Reuses the event
// description sanitiser (sanitize-html allowlist: p, br, strong/em/u, h2/h3,
// lists, http(s)/mailto links forced to target=_blank rel=noopener noreferrer).
// Plain text is escaped and keeps its line breaks. Never ship this to the
// client bundle.
export function sanitizeLessonBody(body: string | null | undefined): string {
  return sanitizeEventDescription(body);
}
