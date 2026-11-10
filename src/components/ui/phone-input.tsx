"use client";

import { useMemo, useState } from "react";
import { COUNTRIES, splitPhone } from "@/lib/profile/options";

const controlClass =
  "h-9 rounded-md border border-rule-strong bg-bg px-3 text-body text-ink placeholder:text-[color:var(--text-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link";

/**
 * The one phone field. Country picker is a native select so it opens in
 * Safari. The stored value is `"+27 71 234 5678"` unless `separator` is set
 * (the form builder passes "" so it keeps its existing dial+digits string).
 */
export function PhoneInput({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  required,
  defaultDial = "+27",
  separator = " ",
  wrapperClassName = "flex gap-2",
  selectClassName,
  inputClassName,
}: {
  id?: string;
  value: string;
  onChange: (combined: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  required?: boolean;
  defaultDial?: string;
  /** Between the dial code and the national number. Default is a space. */
  separator?: string;
  wrapperClassName?: string;
  selectClassName?: string;
  inputClassName?: string;
}) {
  const parsed = useMemo(
    () => (value ? splitPhone(value) : { dial: defaultDial, number: "" }),
    // The field owns its text after mount. A later parent value is a pre-fill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const isoForDial = (dial: string) =>
    COUNTRIES.find((country) => country.dial === dial)?.iso ?? "ZA";

  const [iso, setIso] = useState(() => isoForDial(parsed.dial));
  const [number, setNumber] = useState(parsed.number);

  const dial = useMemo(
    () => COUNTRIES.find((country) => country.iso === iso)?.dial ?? defaultDial,
    [iso, defaultDial]
  );

  function emit(nextDial: string, nextNumber: string) {
    const trimmed = nextNumber.trim();
    onChange(trimmed ? `${nextDial}${separator}${trimmed}` : "");
  }

  function onNumber(raw: string) {
    const compact = raw.replace(/\s/g, "");
    const international = compact.startsWith("+")
      ? compact.slice(1)
      : compact.startsWith("00")
        ? compact.slice(2)
        : null;
    if (international) {
      const match = [...COUNTRIES]
        .sort((a, b) => b.dial.length - a.dial.length)
        .find((country) => international.startsWith(country.dial.slice(1)));
      if (match) {
        const rest = international.slice(match.dial.length - 1);
        if (rest.length > 0) {
          setIso(match.iso);
          setNumber(rest);
          emit(match.dial, rest);
          return;
        }
      }
    }
    setNumber(raw);
    emit(dial, raw);
  }

  return (
    <div className={wrapperClassName}>
      <select
        aria-label="Country code"
        value={iso}
        onChange={(event) => {
          const nextIso = event.target.value;
          setIso(nextIso);
          const nextDial = COUNTRIES.find((country) => country.iso === nextIso)?.dial ?? defaultDial;
          emit(nextDial, number);
        }}
        onBlur={onBlur}
        className={selectClassName ?? `${controlClass} w-[7.5rem] shrink-0 px-2`}
      >
        {COUNTRIES.map((country) => (
          <option key={country.iso} value={country.iso}>
            {country.flag} {country.dial} · {country.name}
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
        onChange={(event) => onNumber(event.target.value)}
        onBlur={onBlur}
        className={inputClassName ?? `${controlClass} min-w-0 flex-1`}
      />
    </div>
  );
}
