"use client";

import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  OUTCOMES,
  fieldMessage,
  type FieldError,
  type OutcomeValue,
  type StoryInput,
} from "./logic";

export function StoryFields({
  value,
  onChange,
  errors,
  idPrefix,
}: {
  value: StoryInput;
  onChange: (next: StoryInput) => void;
  errors: FieldError[];
  idPrefix: string;
}) {
  function set<K extends keyof StoryInput>(key: K, next: StoryInput[K]) {
    onChange({ ...value, [key]: next });
  }

  const titleError = fieldMessage(errors, "title");
  const bodyError = fieldMessage(errors, "body");
  const dateError = fieldMessage(errors, "occurred_on");
  const locationError = fieldMessage(errors, "location_label");
  const outcomeError = fieldMessage(errors, "outcome");
  const peopleError = fieldMessage(errors, "people_reached");
  const decisionsError = fieldMessage(errors, "decisions");
  const consentError = fieldMessage(errors, "consent_to_share");

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-title`}>Title</Label>
        <Input
          id={`${idPrefix}-title`}
          value={value.title}
          maxLength={140}
          autoComplete="off"
          placeholder="A short name for the story"
          aria-invalid={titleError ? true : undefined}
          onChange={(event) => set("title", event.target.value)}
        />
        <FieldHint error={titleError} note={`${value.title.trim().length} / 140`} />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-body`}>What happened</Label>
        <textarea
          id={`${idPrefix}-body`}
          value={value.body}
          rows={7}
          maxLength={20000}
          aria-invalid={bodyError ? true : undefined}
          onChange={(event) => set("body", event.target.value)}
          className="flex w-full"
        />
        <FieldHint
          error={bodyError}
          note={
            value.body.trim().length < 40
              ? `${40 - value.body.trim().length} more characters to reach 40`
              : `${value.body.trim().length.toLocaleString("en-ZA")} characters`
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-date`}>Day it happened</Label>
          <DateField
            id={`${idPrefix}-date`}
            value={value.occurred_on}
            onChange={(next) => set("occurred_on", next)}
          />
          <FieldHint error={dateError} note="South Africa time. Not a future day." />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-location`}>Where</Label>
          <Input
            id={`${idPrefix}-location`}
            value={value.location_label}
            maxLength={80}
            autoComplete="off"
            placeholder="Base, street, or town"
            aria-invalid={locationError ? true : undefined}
            onChange={(event) => set("location_label", event.target.value)}
          />
          <FieldHint error={locationError} />
        </div>
      </div>

      <div className="space-y-2">
        <div className="mono-label">Outcome</div>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Outcome">
          {OUTCOMES.map((outcome) => {
            const on = value.outcome === outcome.value;
            return (
              <button
                key={outcome.value}
                type="button"
                role="radio"
                aria-checked={on}
                className="chip bg-white"
                data-active={on ? "true" : undefined}
                onClick={() => set("outcome", outcome.value as OutcomeValue)}
              >
                {outcome.label}
              </button>
            );
          })}
        </div>
        <FieldHint error={outcomeError} note="Pick the furthest thing that happened." />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-people`}>People reached</Label>
          <Input
            id={`${idPrefix}-people`}
            inputMode="numeric"
            value={value.people_reached}
            aria-invalid={peopleError ? true : undefined}
            onChange={(event) => set("people_reached", event.target.value.replace(/[^\d]/g, ""))}
          />
          <FieldHint error={peopleError} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-decisions`}>Decisions</Label>
          <Input
            id={`${idPrefix}-decisions`}
            inputMode="numeric"
            value={value.decisions}
            aria-invalid={decisionsError ? true : undefined}
            onChange={(event) => set("decisions", event.target.value.replace(/[^\d]/g, ""))}
          />
          <FieldHint error={decisionsError} note="Cannot be more than the people reached." />
        </div>
      </div>

      <div className="border border-rule bg-bone px-4 py-3">
        <label className="flex items-start gap-3 text-[14px] leading-snug">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-black"
            checked={value.consent_to_share}
            onChange={(event) => set("consent_to_share", event.target.checked)}
          />
          <span>
            The people in this story have agreed it can be shared.
            <span className="mt-1 block text-[13px] leading-relaxed text-[color:var(--text-secondary)]">
              A draft can be saved without this. Submitting needs a yes, and so does the TV.
            </span>
          </span>
        </label>
        {consentError && <p className="mt-2 text-xs text-destructive">{consentError}</p>}
      </div>
    </div>
  );
}

function FieldHint({ error, note }: { error: string | null; note?: string }) {
  if (!error && !note) return null;
  return (
    <p className={error ? "text-xs text-destructive" : "text-xs text-[color:var(--text-tertiary)]"}>
      {error ?? note}
    </p>
  );
}
