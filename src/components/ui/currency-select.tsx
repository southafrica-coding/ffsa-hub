"use client";

import { SearchableSelect } from "@/components/ui/searchable-select";
import { COMMON_OUTREACH_CURRENCIES, SUPPORTED_CURRENCIES } from "@/lib/currencies";

const NONE = "none";

/**
 * Pick from every supported currency. The usual outreach ones come first;
 * labels start with the code, so typing "BIF" jumps straight to it.
 */
export function CurrencySelect({
  value,
  onChange,
  allowNone = false,
  exclude = [],
  placeholder = "Select currency…",
}: {
  value: string;
  onChange: (code: string) => void;
  /** Offer "None", which comes back as "". */
  allowNone?: boolean;
  exclude?: string[];
  placeholder?: string;
}) {
  const skip = new Set(exclude);
  const common = new Set<string>(COMMON_OUTREACH_CURRENCIES);
  const label = (c: { code: string; name: string }) => `${c.code} — ${c.name}`;
  const options = [
    ...(allowNone ? [{ value: NONE, label: "None" }] : []),
    ...COMMON_OUTREACH_CURRENCIES.map((code) => SUPPORTED_CURRENCIES.find((c) => c.code === code))
      .filter((c): c is (typeof SUPPORTED_CURRENCIES)[number] => Boolean(c) && !skip.has(c!.code))
      .map((c) => ({ value: c.code, label: label(c) })),
    ...SUPPORTED_CURRENCIES.filter((c) => !common.has(c.code) && !skip.has(c.code)).map((c) => ({
      value: c.code,
      label: label(c),
    })),
  ];

  return (
    <SearchableSelect
      value={value ? value : allowNone ? NONE : ""}
      onChange={(v) => onChange(v === NONE ? "" : v)}
      options={options}
      placeholder={placeholder}
    />
  );
}
