// Event pages render on the server (often UTC) and hydrate in the browser.
// Pin both to South Africa so the HTML matches, whatever the process TZ is.

const LOCALE = "en-ZA";
const TIME_ZONE = "Africa/Johannesburg";

type Instant = Date | string | number;

function asDate(value: Instant): Date {
  return value instanceof Date ? value : new Date(value);
}

// toLocaleString, not a bare Intl.DateTimeFormat: with only a timeZone,
// DateTimeFormat defaults to the date and drops the clock.
const zone = { timeZone: TIME_ZONE } as const;

/** Date and time, en-ZA, always Africa/Johannesburg. */
export function formatSaDateTime(value: Instant): string {
  return asDate(value).toLocaleString(LOCALE, zone);
}

/** Time of day only. */
export function formatSaTime(value: Instant): string {
  return asDate(value).toLocaleTimeString(LOCALE, zone);
}

/** Calendar date only. */
export function formatSaDate(value: Instant): string {
  return asDate(value).toLocaleDateString(LOCALE, zone);
}
