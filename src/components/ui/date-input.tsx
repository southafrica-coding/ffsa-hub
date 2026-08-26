"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

// Free-form day-first date input.
// - Display / typing format: DD/MM/YYYY (also accepts DD/MM/YY)
// - Stored value (onChange payload): ISO YYYY-MM-DD, or "" while incomplete
// - No min/max constraints, no native picker — designed for birthdays and
//   expiry dates where the OS date picker is hostile (far-past / far-future).
//
// Two things this has to get right, because both used to fail SILENTLY —
// the box looked filled while the stored value was "", so the user was told
// a field was blank while staring at their own typing:
//
//   1. American input order. Plenty of our staff are US citizens and type
//      MM/DD/YYYY out of habit. When the middle number is > 12 there is no
//      valid day-first reading of it, so the month-first one is the only
//      thing the user can have meant — take it rather than storing nothing.
//      Genuinely ambiguous dates (both parts <= 12) stay day-first as
//      labelled; we never guess where a guess could be wrong.
//   2. Impossible calendar days. "31/02/2024" used to sail through as
//      2024-02-31 and blow up on the Postgres insert instead. Days are now
//      checked against the real length of the month.
//
// Anything the caller cannot parse is reported through `onValidityChange`
// so the field can show why, instead of failing somewhere far away.

function isoToDisplay(iso: string): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return iso;
}

// Days in a month, honouring leap years, so 31/02 and 31/04 are rejected
// here rather than by the database.
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export type DateParse =
  | { iso: string; problem: null }
  // "incomplete" = still being typed; not an error worth showing.
  | { iso: ""; problem: "incomplete" | "impossible-day" | "bad-month" };

export function parseDisplayDate(display: string): DateParse {
  const m = display.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return { iso: "", problem: "incomplete" };
  let dN = parseInt(m[1], 10);
  let mN = parseInt(m[2], 10);
  let yN = parseInt(m[3], 10);
  if (m[3].length === 2) yN = yN < 30 ? 2000 + yN : 1900 + yN;

  // Month-first rescue: a middle number over 12 cannot be a month, so the
  // user typed MM/DD. Only unambiguous when the first number IS a valid
  // month — otherwise there's no reading at all.
  if (mN > 12 && dN >= 1 && dN <= 12) {
    const swap = dN;
    dN = mN;
    mN = swap;
  }

  if (mN < 1 || mN > 12) return { iso: "", problem: "bad-month" };
  if (dN < 1 || dN > daysInMonth(yN, mN)) {
    return { iso: "", problem: "impossible-day" };
  }

  const dd = String(dN).padStart(2, "0");
  const mm = String(mN).padStart(2, "0");
  const yyyy = String(yN).padStart(4, "0");
  return { iso: `${yyyy}-${mm}-${dd}`, problem: null };
}

function displayToIso(display: string): string {
  return parseDisplayDate(display).iso;
}

function autoFormat(input: string): string {
  // Allow only digits and slashes.
  const cleaned = input.replace(/[^\d/]/g, "");

  // Split on user-typed slashes, then distribute characters across the
  // day / month / year buckets (capped at 2/2/4). Overflow from one bucket
  // spills into the next AND is what we use to decide whether to auto-insert
  // a slash — so typing all 8 digits straight, or typing "28/082026", or
  // typing "28/8/2026" all reconstruct to the right shape.
  const userSegments = cleaned.split("/");
  let day = "";
  let month = "";
  let year = "";
  let bucket: 0 | 1 | 2 = 0;
  let overflowedToMonth = false;
  let overflowedToYear = false;

  for (let i = 0; i < userSegments.length; i++) {
    let chars = userSegments[i];
    while (chars.length > 0 && bucket <= 2) {
      const capacity =
        bucket === 0 ? 2 - day.length
        : bucket === 1 ? 2 - month.length
        : 4 - year.length;
      if (capacity === 0) {
        if (bucket === 0) overflowedToMonth = true;
        else if (bucket === 1) overflowedToYear = true;
        bucket = (bucket + 1) as 0 | 1 | 2;
        continue;
      }
      const take = chars.slice(0, capacity);
      chars = chars.slice(capacity);
      if (bucket === 0) day += take;
      else if (bucket === 1) month += take;
      else year += take;
    }
    if (i < userSegments.length - 1) {
      bucket = Math.min(bucket + 1, 2) as 0 | 1 | 2;
    }
  }

  let result = day;
  const showFirstSlash = userSegments.length >= 2 || overflowedToMonth;
  if (showFirstSlash) result += "/" + month;
  const showSecondSlash = userSegments.length >= 3 || overflowedToYear;
  if (showSecondSlash) result += "/" + year;
  return result;
}

export interface DateInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: string;
  onChange: (isoOrEmpty: string) => void;
  // Set when the typed text looks finished but isn't a real date. Callers
  // that don't care can ignore it; the field explains itself regardless.
  onValidityChange?: (problem: DateParse["problem"]) => void;
}

export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ value, onChange, onValidityChange, className, placeholder = "DD/MM/YYYY", ...rest }, ref) => {
    const [display, setDisplay] = React.useState<string>(() => isoToDisplay(value));
    const [problem, setProblem] = React.useState<DateParse["problem"]>(null);

    React.useEffect(() => {
      const next = isoToDisplay(value);
      setDisplay((cur) => {
        if (next === "" && displayToIso(cur) === "") return cur;
        if (cur && next && displayToIso(cur) === value) return cur;
        return next;
      });
    }, [value]);

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const formatted = autoFormat(e.target.value);
      setDisplay(formatted);
      const parsed = parseDisplayDate(formatted);
      // A half-typed date isn't a mistake — only complain once they've
      // stopped short of something we can read.
      const next = formatted.length >= 8 ? parsed.problem : null;
      setProblem(next);
      onValidityChange?.(next);
      onChange(parsed.iso);
    }

    const message =
      problem === "bad-month"
        ? "That isn't a date we can read. Please use DD/MM/YYYY."
        : problem === "impossible-day"
          ? "That day doesn't exist in that month. Please check it."
          : null;

    return (
      <>
      <input
        ref={ref}
        aria-invalid={message ? true : undefined}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        maxLength={10}
        placeholder={placeholder}
        value={display}
        onChange={handleChange}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...rest}
      />
      {message && <p className="mt-1 text-xs text-destructive">{message}</p>}
      </>
    );
  }
);
DateInput.displayName = "DateInput";
