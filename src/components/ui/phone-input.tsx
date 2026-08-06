"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { COUNTRIES, splitPhone } from "@/lib/profile/options";

/**
 * Phone input with a country-code dropdown and a digits field.
 *
 * The bound value is the canonical concatenation: `"+27 71 234 5678"`.
 * Internally we track dial + number separately so re-rendering the
 * stored value (e.g. when the form pre-fills) puts the country code
 * back in the dropdown rather than dumping `+27...` into the digits.
 */
export function PhoneInput({
  id,
  value,
  onChange,
  placeholder,
  required,
  defaultDial = "+27",
}: {
  id?: string;
  value: string;
  onChange: (combined: string) => void;
  placeholder?: string;
  required?: boolean;
  defaultDial?: string;
}) {
  // Derive dial + number from the parent-controlled value so the field
  // stays in sync if the parent overrides it. Memoize per-value so we
  // don't re-parse on unrelated re-renders.
  const parsed = useMemo(
    () => (value ? splitPhone(value) : { dial: defaultDial, number: "" }),
    [value, defaultDial]
  );

  const [dial, setDial] = useState(parsed.dial);
  const [number, setNumber] = useState(parsed.number);

  // If the parent value diverges from our internal state (e.g. user
  // pasted into another form field and came back), reconcile.
  if (parsed.dial !== dial || parsed.number !== number) {
    if (!value && number !== "") {
      // parent cleared us
      setDial(defaultDial);
      setNumber("");
    }
  }

  // Sorted by dial code for fast scanning. Group countries that share a
  // dial code (e.g. US/CA both use +1) into a single entry that lists all
  // their names — "+1 United States, Canada" — instead of one flag.
  const dialOptions = useMemo(() => {
    const byDial = new Map<string, string[]>();
    for (const c of COUNTRIES) {
      const names = byDial.get(c.dial);
      if (names) names.push(c.name);
      else byDial.set(c.dial, [c.name]);
    }
    const out: { dial: string; label: string }[] = [];
    for (const [dialCode, names] of byDial) {
      // Prefer United States first where it shares a code, then alphabetical.
      const ordered = [...names].sort((a, b) => {
        if (a === "United States") return -1;
        if (b === "United States") return 1;
        return a.localeCompare(b);
      });
      out.push({ dial: dialCode, label: `${dialCode} ${ordered.join(", ")}` });
    }
    return out.sort((a, b) => {
      // numeric-ish sort by digits after the +
      const an = parseInt(a.dial.slice(1), 10);
      const bn = parseInt(b.dial.slice(1), 10);
      return an - bn;
    });
  }, []);

  function emit(nextDial: string, nextNumber: string) {
    const trimmed = nextNumber.trim();
    if (!trimmed) {
      onChange("");
      return;
    }
    onChange(`${nextDial} ${trimmed}`);
  }

  return (
    <div className="flex gap-2">
      <select
        value={dial}
        onChange={(e) => {
          setDial(e.target.value);
          emit(e.target.value, number);
        }}
        className="flex h-10 max-w-[45%] rounded-md border border-input bg-background px-2 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Country code"
      >
        {dialOptions.map((o) => (
          <option key={o.dial} value={o.dial}>
            {o.label}
          </option>
        ))}
      </select>
      <Input
        id={id}
        type="tel"
        inputMode="numeric"
        placeholder={placeholder ?? "71 234 5678"}
        value={number}
        required={required}
        onChange={(e) => {
          setNumber(e.target.value);
          emit(dial, e.target.value);
        }}
        className="flex-1"
      />
    </div>
  );
}
