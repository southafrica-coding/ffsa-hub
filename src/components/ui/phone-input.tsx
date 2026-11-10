"use client";

import { useMemo, useState } from "react";
import { COUNTRIES, splitPhone } from "@/lib/profile/options";
import { matchDial } from "./phone-country";

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
  storage = "display",
  wrapperClassName = "flex gap-2",
  selectClassName,
  inputClassName,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
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
  /** `e164` stores a leading + and digits only, which is what the form builder keeps. */
  storage?: "display" | "e164";
  wrapperClassName?: string;
  selectClassName?: string;
  inputClassName?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
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
    const digits = nextNumber.replace(/\D/g, "");
    if (!digits) {
      onChange("");
      return;
    }
    if (storage === "e164") {
      onChange(`${nextDial}${digits}`);
      return;
    }
    onChange(`${nextDial}${separator}${digits}`);
  }

  function onNumber(raw: string) {
    const compact = raw.replace(/\s/g, "");
    const international = compact.startsWith("+")
      ? compact.slice(1).replace(/\D/g, "")
      : compact.startsWith("00")
        ? compact.slice(2).replace(/\D/g, "")
        : null;
    if (international) {
      const match = matchDial(international, COUNTRIES);
      if (match) {
        const rest = international.slice(match.dial.replace(/\D/g, "").length);
        if (rest.length > 0) {
          setIso(match.iso);
          setNumber(rest);
          emit(match.dial, rest);
          return;
        }
      }
      setNumber(raw);
      return;
    }
    setNumber(raw);
    emit(dial, raw);
  }

  return (
    <div className={wrapperClassName} style={{ display: "flex", gap: 8, minWidth: 0 }}>
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
        className={selectClassName ?? `${controlClass} px-2`}
        style={{ flex: "0 0 116px", width: 116, maxWidth: 116 }}
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
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        className={inputClassName ?? controlClass}
        style={{ flex: "1 1 auto", minWidth: 0 }}
      />
    </div>
  );
}
