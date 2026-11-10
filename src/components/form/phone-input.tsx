"use client";

import { useController, type Control } from "react-hook-form";
import { PhoneInput as UiPhoneInput } from "@/components/ui/phone-input";
import { FieldWrapper } from "./field-wrapper";
import type { FormQuestion } from "@/lib/form-types";

/** Form-builder adapter over the shared phone field. */
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

  return (
    <FieldWrapper
      id={question.id}
      label={question.label}
      required={question.required}
      helpText={question.helpText}
      error={fieldState.error?.message}
    >
      <UiPhoneInput
        id={question.id}
        value={typeof field.value === "string" ? field.value : ""}
        onChange={field.onChange}
        onBlur={field.onBlur}
        required={question.required}
        storage="e164"
        aria-invalid={!!fieldState.error}
        aria-describedby={fieldState.error ? `${question.id}-error` : undefined}
      />
    </FieldWrapper>
  );
}
