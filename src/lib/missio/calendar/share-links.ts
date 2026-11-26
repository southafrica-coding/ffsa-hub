// Share URLs for the Missio calendar. Safe in the browser: no secrets here.
//
// Feed:      https://<host>/api/serve/missio/calendar/<token>.ics
// Web view:  https://<host>/serve/missio/calendar/<token>
// Google:    https://calendar.google.com/calendar/r?cid=<webcal feed URL, URL-encoded>
// Apple:     webcal://<host>/api/serve/missio/calendar/<token>.ics

/** Leaves out public holidays and school terms, for people whose calendar has them already. */
export const NO_NATIONAL_PARAM = "national=0";

export function calendarFeedPath(token: string): string {
  return `/api/serve/missio/calendar/${token}.ics`;
}

export function calendarWebPath(token: string): string {
  return `/serve/missio/calendar/${token}`;
}

/** The same feed on the webcal scheme, which Apple Calendar and Outlook open as a subscription. */
export function webcalUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^https?:\/\//i, "webcal://");
}

/**
 * Google Calendar's "add by URL" page. Google fetches the feed from its
 * own servers, so the feed must be public https (localhost won't work).
 */
export function googleSubscribeUrl(httpsUrl: string): string {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl(httpsUrl))}`;
}

export function withoutNational(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${NO_NATIONAL_PARAM}`;
}

export type CalendarShare = {
  feedUrl: string;
  webUrl: string;
  /** First characters of the token, so a pastor can tell two links apart. */
  prefix: string;
  rotatedAt: string | null;
};
