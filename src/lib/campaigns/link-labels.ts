// Name the links in a rendered campaign, so the per-link click report can say
// "Register now (button)" instead of only showing a raw URL.
//
// Resend reports a click by the link's destination URL. Reading the anchors
// out of the campaign's own rendered HTML maps each URL back to what the
// reader actually saw and clicked: the button text, the link text, or an
// image's alt text. Two elements pointing at the same URL can't be told apart
// by the click (the provider only sees the URL), so their labels are joined.

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Map each href in `html` to a human label for the element(s) linking to it. */
export function extractLinkLabels(html: string): Map<string, string> {
  const labels = new Map<string, string[]>();
  const anchor = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(anchor)) {
    const href = decodeEntities(m[1]).trim();
    const inner = m[2];
    const text = decodeEntities(inner.replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    const alt = inner.match(/<img\b[^>]*\balt="([^"]*)"/i)?.[1];
    const label = text || (alt ? `Image: ${decodeEntities(alt)}` : "Image link");
    const list = labels.get(href) ?? [];
    if (!list.includes(label)) list.push(label);
    labels.set(href, list);
  }
  return new Map([...labels].map(([href, list]) => [href, list.join(" / ")]));
}

/**
 * The per-recipient "Manage email preferences" link carries a signed token, so
 * every recipient's copy is a different URL. Fold them into one row.
 */
export function isPreferencesLink(url: string): boolean {
  return /\/preferences\?t=/.test(url);
}
