"use client";

import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type SelectOption = { value: string; label: string };

/**
 * A single-value dropdown for long lists (countries, nationalities,
 * passport-country) with the same external shape as a plain `<select>` —
 * pass options and a value/onChange.
 *
 * Implemented as a **native `<select>`** on purpose: the previous Radix
 * Popover + cmdk combobox did not open at all in Safari (a known WebKit
 * interaction bug), breaking the staff sign-up on the browsers our users
 * actually use. The native control opens reliably on Safari, iOS, Chrome and
 * Android, supports type-to-search (typeahead) and native scrolling, and
 * matches the country-code dropdown in `phone-input.tsx`.
 *
 * `searchPlaceholder` / `emptyText` are accepted but unused — kept so existing
 * call sites don't need to change.
 */
export function SearchableSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(
          "flex h-10 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          !value && "text-muted-foreground"
        )}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value} className="text-foreground">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
    </div>
  );
}
