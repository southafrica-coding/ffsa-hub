"use client";

import { useController, type Control } from "react-hook-form";
import { FieldWrapper } from "./field-wrapper";
import { cn } from "@/lib/utils/cn";
import type { FormQuestion } from "@/lib/form-types";

const YES_NO_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export function YesNoSelect({
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
      <div className="flex gap-2" role="radiogroup" aria-label={question.label}>
        {YES_NO_OPTIONS.map((opt) => {
          const selected = field.value === opt.value;
          return (
            <label
              key={opt.value}
              data-slot="yes-no-option"
              data-state={selected ? "checked" : "unchecked"}
              className={cn(
                "flex-1 cursor-pointer rounded-md border px-4 py-2.5 text-center text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background text-foreground hover:bg-accent"
              )}
            >
              <input
                type="radio"
                name={question.id}
                value={opt.value}
                checked={selected}
                onChange={() => field.onChange(opt.value)}
                onBlur={field.onBlur}
                aria-invalid={!!fieldState.error}
                className="sr-only"
              />
              {opt.label}
            </label>
          );
        })}
      </div>
    </FieldWrapper>
  );
}
