// Shared helpers for the public event link-preview (Open Graph) card.
// Used by both the event page's generateMetadata (title/description) and the
// dynamic opengraph-image route (the rendered share card).

export type OgBrand = "ff" | "the_send" | "ffsa_camps" | "preachers";

// Palette per brand, mirroring each storefront's masthead so a shared link
// feels like the event it points at. `bg` is the card background, `text` the
// title colour, `accent` the meta/label colour, `label` the brand eyebrow.
export const OG_BRAND: Record<
  OgBrand,
  { bg: string; text: string; accent: string; label: string }
> = {
  ff: { bg: "#0F1920", text: "#F7F5EF", accent: "#E4572E", label: "FIRE & FRAGRANCE" },
  preachers: { bg: "#1B2A33", text: "#EDE6D3", accent: "#EDE6D3", label: "PREACHERS" },
  ffsa_camps: { bg: "#2F65E8", text: "#F2E8CC", accent: "#FFFFFF", label: "FFSA CAMPS" },
  the_send: { bg: "#1C314C", text: "#F7F1E8", accent: "#FACF50", label: "THE SEND" },
};

// Mirrors resolveEventBrand() in the event page's routing, kept local so the
// card can pick a palette without importing the route module.
export function ogBrandFromEvent(event: {
  brand?: string | null;
  public_slug?: string | null;
  title?: string | null;
}): OgBrand {
  if (event.brand === "the_send") return "the_send";
  if (event.brand === "ffsa_camps") return "ffsa_camps";
  if (event.brand === "preachers") return "preachers";
  if (event.brand) return "ff";
  const slug = (event.public_slug ?? "").toLowerCase();
  const title = (event.title ?? "").toLowerCase();
  if (slug.includes("the-send") || title.includes("the send")) return "the_send";
  if (slug.includes("ffsa-camps") || slug.includes("camps") || title.includes("camps"))
    return "ffsa_camps";
  if (slug.includes("preachers") || title.includes("preachers")) return "preachers";
  return "ff";
}

function parts(date: string) {
  const dt = new Date(`${date}T00:00:00`);
  return {
    day: dt.getDate(),
    mon: dt.toLocaleString("en-GB", { month: "short" }),
    year: dt.getFullYear(),
  };
}

// "5 Jul 2026", "5–7 Jul 2026", "28 Jul – 2 Aug 2026", or across years.
export function formatEventDateRange(
  start?: string | null,
  end?: string | null
): string {
  if (!start) return "";
  const s = parts(start);
  if (!end || end === start) return `${s.day} ${s.mon} ${s.year}`;
  const e = parts(end);
  if (s.year === e.year && s.mon === e.mon)
    return `${s.day}–${e.day} ${s.mon} ${s.year}`;
  if (s.year === e.year)
    return `${s.day} ${s.mon} – ${e.day} ${e.mon} ${s.year}`;
  return `${s.day} ${s.mon} ${s.year} – ${e.day} ${e.mon} ${e.year}`;
}
