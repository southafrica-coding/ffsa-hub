"use client";

import { useState } from "react";
import { useController, type Control } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { countries, type Country } from "@/lib/countries";
import { FieldWrapper } from "./field-wrapper";
import type { FormQuestion } from "@/lib/form-types";

const DEFAULT_COUNTRY = countries.find((c) => c.iso2 === "ZA")!;

export function PhoneInput({
  question,
  control,
}: {
  question: FormQuestion;
  control: Control<any>;
}) {
  const { field, fieldState } = useController({
    name: question.id,
    control,
  });

  const [selectedCountry, setSelectedCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [localNumber, setLocalNumber] = useState(() => {
    if (field.value && typeof field.value === "string") {
      const match = countries.find(
        (c) => field.value.startsWith(c.dialCode) && c.iso2 !== "US"
      );
      if (match) {
        setSelectedCountry(match);
        return field.value.slice(match.dialCode.length);
      }
    }
    return "";
  });

  function handleCountrySelect(country: Country) {
    setSelectedCountry(country);
    const full = localNumber ? `${country.dialCode}${localNumber.replace(/\D/g, "")}` : "";
    field.onChange(full);
  }

  function handleNumberChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^\d\s-]/g, "");
    setLocalNumber(raw);
    const digits = raw.replace(/\D/g, "");
    const full = digits ? `${selectedCountry.dialCode}${digits}` : "";
    field.onChange(full);
  }

  return (
    <FieldWrapper
      id={question.id}
      label={question.label}
      required={question.required}
      helpText={question.helpText}
      error={fieldState.error?.message}
    >
      <div className="flex gap-2">
        {/* Native <select> on purpose: the Radix Popover + cmdk combobox
            doesn't open in Safari (see PR #193), which left the country code
            stuck on the default. Public sign-up forms must work in Safari. */}
        <select
          aria-label="Country code"
          value={selectedCountry.iso2}
          onChange={(e) => {
            const next = countries.find((c) => c.iso2 === e.target.value);
            if (next) handleCountrySelect(next);
          }}
          className="h-10 w-[140px] shrink-0 rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {countries.map((c) => (
            <option key={c.iso2} value={c.iso2}>
              {c.flag} {c.dialCode} · {c.name}
            </option>
          ))}
        </select>
        <Input
          id={question.id}
          type="tel"
          inputMode="tel"
          value={localNumber}
          onChange={handleNumberChange}
          onBlur={field.onBlur}
          placeholder="Phone number"
          className="flex-1"
          aria-invalid={!!fieldState.error}
          aria-describedby={
            fieldState.error ? `${question.id}-error` : undefined
          }
        />
      </div>
    </FieldWrapper>
  );
}
