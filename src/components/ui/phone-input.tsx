"use client";

import { PhoneInputNative } from "@/components/ui/phone-input-native";

/**
 * Phone input with a country-code picker and a digits field.
 *
 * The bound value is the canonical concatenation: `"+27 71 234 5678"`.
 *
 * This is a thin wrapper over {@link PhoneInputNative}, which uses a native
 * <select> for the country picker. It previously used a Radix Popover + cmdk
 * combobox, which doesn't open in Safari (same failure as the country and
 * nationality dropdowns fixed in PR #193) — so on Safari the code was stuck on
 * whatever the default dial was. The old version also dropped a freshly picked
 * country whenever the digits field was still empty, because it re-derived its
 * dial from the (empty) parent value on the next render.
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
  const fieldClass =
    "flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <PhoneInputNative
      id={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      required={required}
      defaultDial={defaultDial}
      selectClassName={`${fieldClass} px-2`}
      inputClassName={fieldClass}
    />
  );
}
