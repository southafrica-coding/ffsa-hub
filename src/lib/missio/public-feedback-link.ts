import { MISSIO_WEEKLY_FEEDBACK_SLUG } from "@/lib/forms/templates/missio-weekly-feedback";

// ============================================================
// Missio weekly feedback — the one public link (client-safe)
// ============================================================
// Jack, 23 Nov 2026: one public link, and the person says which
// house church they are in. It is the generic /f/<slug> address of
// the seeded form; the page and submit route special-case this one
// form (kind + slug, no event) so it opens without a login even
// though the row's access_mode is still "token". No prod row change.
// ============================================================

export const MISSIO_PUBLIC_FEEDBACK_PATH = `/f/${MISSIO_WEEKLY_FEEDBACK_SLUG}`;

export const PUBLIC_HOUSE_QUESTION = "Which house church are you in?";

/** The honeypot field's name in the public POST body. Always empty for a person. */
export const PUBLIC_FEEDBACK_HONEYPOT = "website";

/**
 * What a public visitor may see of a house: nothing else, ever.
 * meetingDate is this week's meeting (YYYY-MM-DD), worked out on the server.
 */
export type PublicHouse = { id: string; number: number; name: string | null; meetingDate: string };

/** True only for the seeded Missio weekly feedback form (no event). */
export function isMissioPublicFeedbackForm(form: {
  kind?: unknown;
  slug?: unknown;
  event_id?: unknown;
} | null | undefined): boolean {
  if (!form) return false;
  return form.kind === "missio_weekly_feedback" && form.slug === MISSIO_WEEKLY_FEEDBACK_SLUG && !form.event_id;
}

/** "House 4 · Thabo & Lerato", or "House 4" when the house has no name yet. */
export function publicHouseLabel(house: { number: number; name: string | null }): string {
  const name = house.name?.trim() ?? "";
  return name ? `House ${house.number} · ${name}` : `House ${house.number}`;
}

/** The absolute public URL, given the page's origin ("" before it is known). */
export function missioPublicFeedbackUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}${MISSIO_PUBLIC_FEEDBACK_PATH}`;
}

/** The WhatsApp message for the shared form (not one house's link). */
export function missioPublicFeedbackWhatsApp(url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(
    `House church leaders: how was house church this week? Pick your house church, then fill it in. About five minutes: ${url}`
  )}`;
}
