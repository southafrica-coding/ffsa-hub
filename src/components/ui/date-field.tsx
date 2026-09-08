"use client";

import * as React from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { DateInput, type DateParse } from "@/components/ui/date-input";
import {
  monthGridDays,
  monthLabel,
  shiftMonth,
  isoMonth,
  isoDay,
  todayISO,
  WEEKDAY_HEADERS,
} from "@/lib/bookings/dates";

// A date box you can type into OR pick from a calendar.
//
// It wraps DateInput rather than replacing it, so the typing behaviour that
// took two rounds to get right (the MM/DD rescue, the 31/02 check) is
// untouched — the calendar is an addition, not a substitute.
//
// Deliberately NOT built on Radix Popover: that pattern silently fails to open
// in Safari (see ui/searchable-select.tsx), and a date field that doesn't open
// on a manager's iPhone is worse than no picker at all. This is a plain
// absolutely-positioned div in normal flow, closed on Escape or an outside
// pointerdown, with real <button> cells.

export function DateField({
  value,
  onChange,
  onValidityChange,
  id,
  className,
  disabled,
}: {
  value: string;
  onChange: (isoOrEmpty: string) => void;
  onValidityChange?: (problem: DateParse["problem"]) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const today = todayISO();
  const anchor = value || today;
  const [view, setView] = React.useState(() => ({
    year: parseInt(anchor.slice(0, 4), 10),
    month: parseInt(anchor.slice(5, 7), 10),
  }));

  // Jump the calendar to whatever was typed, so opening it never lands the
  // user in a different month from the one in the box.
  React.useEffect(() => {
    if (!value) return;
    setView({
      year: parseInt(value.slice(0, 4), 10),
      month: parseInt(value.slice(5, 7), 10),
    });
  }, [value]);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // pointerdown, not click — iOS Safari is reliable with pointer events.
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const days = monthGridDays(view.year, view.month);

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <div className="flex items-stretch gap-1.5">
        <DateInput
          id={id}
          value={value}
          onChange={onChange}
          onValidityChange={onValidityChange}
          disabled={disabled}
          className="flex-1"
        />
        <button
          type="button"
          disabled={disabled}
          aria-label={open ? "Close the calendar" : "Pick a date from the calendar"}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex h-10 w-10 shrink-0 items-center justify-center border border-rule bg-white text-ink hover:bg-bone disabled:opacity-50"
        >
          <CalendarIcon className="h-4 w-4" />
        </button>
      </div>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-[17.5rem] border border-ink bg-white p-3 shadow-md">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setView((v) => shiftMonth(v.year, v.month, -1))}
              className="flex h-7 w-7 items-center justify-center border border-rule hover:bg-bone"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="mono-label">{monthLabel(view.year, view.month)}</span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setView((v) => shiftMonth(v.year, v.month, 1))}
              className="flex h-7 w-7 items-center justify-center border border-rule hover:bg-bone"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-px">
            {WEEKDAY_HEADERS.map((w) => (
              <span
                key={w}
                className="py-1 text-center font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[color:var(--text-tertiary)]"
              >
                {w.slice(0, 1)}
              </span>
            ))}
            {days.map((d) => {
              const outside = isoMonth(d) !== view.month;
              const selected = d === value;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    onChange(d);
                    onValidityChange?.(null);
                    setOpen(false);
                  }}
                  className={cn(
                    "h-8 text-sm tabular-nums hover:bg-bone",
                    outside && "text-[color:var(--text-tertiary)]",
                    d === today && !selected && "font-bold underline",
                    selected && "bg-ink font-bold text-white hover:bg-ink"
                  )}
                >
                  {isoDay(d)}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-rule pt-2">
            <button
              type="button"
              onClick={() => {
                onChange(today);
                onValidityChange?.(null);
                setOpen(false);
              }}
              className="mono-label hover:underline"
            >
              Today
            </button>
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  onValidityChange?.(null);
                  setOpen(false);
                }}
                className="mono-label hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
