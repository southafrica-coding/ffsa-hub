"use client";

import { useController, type Control } from "react-hook-form";
import { DateField as UiDateField } from "@/components/ui/date-field";
import { FieldWrapper } from "./field-wrapper";
import type { FormQuestion } from "@/lib/form-types";

export function DateField({
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
      <UiDateField
        id={question.id}
        value={field.value ?? ""}
        onChange={field.onChange}
        onBlur={field.onBlur}
        aria-invalid={!!fieldState.error}
        aria-describedby={fieldState.error ? `${question.id}-error` : undefined}
      />
    </FieldWrapper>
  );
}
