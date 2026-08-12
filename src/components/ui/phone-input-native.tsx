"use client";

import { useMemo, useState } from "react";
import { COUNTRIES, splitPhone } from "@/lib/profile/options";

/**
 * Phone input with a country-code picker + a digits field.
 *
 * The bound value is the canonical concatenation `"+27 71 234 5678"` — a dial
 * code, a space, then the national number — so callers store one string that
 * always carries the country code.
 *
 * The country picker is a NATIVE <select> on purpose: the Radix Popover + cmdk
 * combobox used elsewhere doesn't open in Safari (see PR #193 / the country &
 * nationality dropdowns), and these forms include public event signups where
 * Safari must work. Native <select> is bulletproof across browsers.
 *
 * Styling is caller-supplied via selectClassName / inputClassName so the field
 * can match each branded storefront (cmp-input, ffx-input, …) as well as the
 * plain admin inputs.
 */
export function PhoneInputNative({
  id,
  value,
  onChange,
  placeholder,
  required,
  defaultDial = "+27",
  wrapperClassName = "flex gap-2",
  selectClassName,
  inputClassName,
}: {
  id?: string;
  value: string;
  onChange: (combined: string) => void;
  placeholder?: string;
  required?: boolean;
  defaultDial?: string;
  wrapperClassName?: string;
  selectClassName?: string;
  inputClassName?: string;
}) {
  // Derive dial + number from the parent-controlled value once at mount; the
  // fields then own their state (the value only feeds back in on a pre-fill).
  const parsed = useMemo(
    () => (value ? splitPhone(value) : { dial: defaultDial, number: "" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Several countries can share a dial code (e.g. +1); the <select> is keyed by
  // ISO so options stay unique. Map the parsed dial back to its first ISO.
  const isoForDial = (dial: string) =>
    COUNTRIES.find((c) => c.dial === dial)?.iso ?? "ZA";

  const [iso, setIso] = useState(() => isoForDial(parsed.dial));
  const [number, setNumber] = useState(parsed.number);

  const dial = useMemo(
    () => COUNTRIES.find((c) => c.iso === iso)?.dial ?? defaultDial,
    [iso, defaultDial]
  );

  function emit(nextDial: string, nextNumber: string) {
    const trimmed = nextNumber.trim();
    onChange(trimmed ? `${nextDial} ${trimmed}` : "");
  }

  return (
    <div className={wrapperClassName}>
      <select
        aria-label="Country code"
        value={iso}
        onChange={(e) => {
          const nextIso = e.target.value;
          setIso(nextIso);
          const nextDial =
            COUNTRIES.find((c) => c.iso === nextIso)?.dial ?? defaultDial;
          emit(nextDial, number);
        }}
        className={selectClassName}
        style={{ flex: "0 0 auto", width: "116px" }}
      >
        {COUNTRIES.map((c) => (
          <option key={c.iso} value={c.iso}>
            {c.flag} {c.dial} · {c.name}
          </option>
        ))}
      </select>
      <input
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
        className={inputClassName}
        style={{ flex: "1 1 auto", minWidth: 0 }}
      />
    </div>
  );
}
