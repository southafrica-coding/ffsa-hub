// South African public holidays by rule, for any year (Gideon, 24 Nov 2026: they aren't
// working days, so the International Team hold skips them). Migration 365's
// sa_public_holiday() is the same rule in SQL.
//
//   Fixed: 1 Jan, 21 Mar, 27 Apr, 1 May, 16 Jun, 9 Aug, 24 Sep, 16 Dec, 25 Dec, 26 Dec.
//   Easter: Good Friday and Family Day (the Monday after Easter).
//   Public Holidays Act 36 of 1994, s2(1): a holiday on a Sunday is also observed on the
//   following Monday.
// One-off days the President declares (election days, for example) aren't rules, so
// they aren't here. sa-holidays.test.ts checks this against the Missio calendar's
// official 2026–2028 list.

const FIXED = ["01-01", "03-21", "04-27", "05-01", "06-16", "08-09", "09-24", "12-16", "12-25", "12-26"];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (s: string, days: number) => {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};

/** Easter Sunday (Gregorian), ISO date. */
export function easterSunday(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(new Date(Date.UTC(y, month - 1, day)));
}

const isFixed = (s: string) => FIXED.includes(s.slice(5));

export function isSaPublicHoliday(s: string): boolean {
  if (isFixed(s)) return true;
  const easter = easterSunday(Number(s.slice(0, 4)));
  if (s === shift(easter, -2) || s === shift(easter, 1)) return true;
  // Monday after a fixed holiday on a Sunday (Good Friday and Family Day never are).
  const monday = new Date(s + "T00:00:00Z").getUTCDay() === 1;
  return monday && isFixed(shift(s, -1));
}

/** Mon–Fri and not a public holiday. */
export function isWorkingDay(s: string): boolean {
  const w = new Date(s + "T00:00:00Z").getUTCDay();
  return w !== 0 && w !== 6 && !isSaPublicHoliday(s);
}
