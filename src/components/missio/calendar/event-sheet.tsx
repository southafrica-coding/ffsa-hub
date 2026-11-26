"use client";

import { useState } from "react";
import { addDays, diffDays, formatDate, formatDay } from "@/lib/missio/calendar/dates";
import type { Occurrence } from "@/lib/missio/calendar/occurrences";
import {
  CAMPUS_LABEL,
  CAMPUSES,
  CATEGORY_LABEL,
  MISSIO_EVENT_CATEGORIES,
  type CalendarCampus,
  type CalendarEvent,
  type CalendarEventInput,
  type FieldErrors,
  type MissioEventCategory,
} from "@/lib/missio/calendar/types";
import shell from "../shell.module.css";
import { CalendarApiError, calendarErrorCopy, type CalendarClient } from "./client";
import { CalendarSheet } from "./sheet";
import { CategoryTag, Marker, whenLabel } from "./views";
import styles from "./calendar.module.css";

export type EndMode = "never" | "until" | "count";

export type Draft = {
  title: string;
  description: string;
  location: string;
  category: MissioEventCategory;
  campus: CalendarCampus;
  allDay: boolean;
  startsOn: string;
  endsOn: string;
  startTime: string;
  endTime: string;
  /** 0: doesn't repeat. n: every n weeks. */
  every: number;
  endMode: EndMode;
  until: string;
  count: string;
  skipDates: string[];
};

export function newDraft(day: string): Draft {
  return {
    title: "",
    description: "",
    location: "",
    category: "events",
    campus: "all",
    allDay: true,
    startsOn: day,
    endsOn: day,
    startTime: "09:00",
    endTime: "11:00",
    every: 0,
    endMode: "never",
    until: "",
    count: "",
    skipDates: [],
  };
}

export function draftFromEvent(event: CalendarEvent): Draft {
  return {
    title: event.title,
    description: event.description ?? "",
    location: event.location ?? "",
    category: event.category === "national" ? "events" : event.category,
    campus: event.campus,
    allDay: !event.startTime,
    startsOn: event.startsOn,
    endsOn: event.endsOn,
    startTime: event.startTime ?? "09:00",
    endTime: event.endTime ?? "11:00",
    every: event.repeat?.every ?? 0,
    endMode: event.repeat?.until ? "until" : event.repeat?.count ? "count" : "never",
    until: event.repeat?.until ?? "",
    count: event.repeat?.count ? String(event.repeat.count) : "",
    skipDates: event.skipDates,
  };
}

/** The form as the API's body. The API checks it again. */
export function draftToInput(draft: Draft): CalendarEventInput {
  const repeat =
    draft.every > 0
      ? {
          every: draft.every,
          until: draft.endMode === "until" && draft.until ? draft.until : null,
          count: draft.endMode === "count" && draft.count ? Number(draft.count) : null,
        }
      : null;
  return {
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    location: draft.location.trim() || null,
    category: draft.category,
    campus: draft.campus,
    startsOn: draft.startsOn,
    endsOn: draft.endsOn || draft.startsOn,
    startTime: draft.allDay ? null : draft.startTime,
    endTime: draft.allDay ? null : draft.endTime,
    repeat,
    skipDates: repeat ? draft.skipDates : [],
  };
}

const EVERY_OPTIONS = [
  { value: 0, label: "Doesn’t repeat" },
  { value: 1, label: "Every week" },
  { value: 2, label: "Every 2 weeks" },
  { value: 3, label: "Every 3 weeks" },
  { value: 4, label: "Every 4 weeks" },
];

function FieldError({ message }: { message?: string }) {
  return message ? <span className={styles.fieldError}>{message}</span> : null;
}

/**
 * Add or edit (board-less; Missio Claude Design tokens). `occurrence` is the
 * date the pastor tapped on a repeating event, so they can skip just that one.
 */
export function EventSheet({
  client,
  event,
  occurrence,
  day,
  onClose,
  onSaved,
  onDeleted,
}: {
  client: CalendarClient;
  event: CalendarEvent | null;
  occurrence?: Occurrence | null;
  day: string;
  onClose: () => void;
  onSaved: (event: CalendarEvent) => void;
  onDeleted: (id: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => (event ? draftFromEvent(event) : newDraft(day)));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  async function save(next: Draft = draft) {
    if (pending) return;
    if (!next.title.trim()) {
      setErrors({ title: "Give it a title." });
      return;
    }
    setPending(true);
    setNotice(null);
    setErrors({});
    try {
      const input = draftToInput(next);
      const saved = event ? await client.update(event.id, input) : await client.create(input);
      onSaved(saved);
    } catch (caught) {
      const code = caught instanceof CalendarApiError ? caught.code : null;
      if (caught instanceof CalendarApiError) setErrors(caught.fieldErrors);
      setNotice(calendarErrorCopy(code));
      setPending(false);
    }
  }

  async function remove() {
    if (!event || pending) return;
    setPending(true);
    try {
      await client.remove(event.id);
      onDeleted(event.id);
    } catch (caught) {
      setConfirmDelete(false);
      setNotice(calendarErrorCopy(caught instanceof CalendarApiError ? caught.code : null));
      setPending(false);
    }
  }

  if (confirmDelete && event) {
    return (
      // A fresh sheet, so focus lands on "Keep it", not on Delete.
      <CalendarSheet
        key="confirm"
        title={`Delete “${event.title}”?`}
        testId="calendar-delete"
        onClose={() => setConfirmDelete(false)}
        focusFirstField={false}
        footer={
          <div className={styles.footRow}>
            <button type="button" className={shell.ghost} data-autofocus="" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
            <button type="button" className={styles.danger} disabled={pending} onClick={() => void remove()}>
              Delete for good
            </button>
          </div>
        }
      >
        <p className={styles.sheetText}>
          It comes off the Missio calendar and off every phone and Google calendar subscribed to it.
          {event.repeat ? " It repeats, so every date goes." : ""} There’s no undo.
        </p>
      </CalendarSheet>
    );
  }

  const repeating = draft.every > 0;
  const span = diffDays(draft.startsOn, draft.endsOn || draft.startsOn);

  return (
    <CalendarSheet
      key="edit"
      title={event ? "Edit event" : "Add an event"}
      testId="calendar-edit"
      onClose={onClose}
      footer={
        <div className={styles.footRow}>
          {event ? (
            <button type="button" className={styles.deleteLink} onClick={() => setConfirmDelete(true)}>
              Delete…
            </button>
          ) : (
            <span />
          )}
          <span className={styles.footActions}>
            <button type="button" className={shell.ghost} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={shell.primary} disabled={pending || !draft.title.trim()} onClick={() => void save()}>
              {pending ? "Saving…" : event ? "Save" : "Add to calendar"}
            </button>
          </span>
        </div>
      }
    >
      {notice ? (
        <p className={shell.alert} role="alert">
          {notice}
        </p>
      ) : null}
      {event?.repeat && occurrence ? (
        <div className={styles.skipBox}>
          <span>
            You opened {formatDay(occurrence.startsOn)}. Changes here apply to every date in the series.
          </span>
          <button
            type="button"
            className={shell.ghost}
            disabled={pending}
            onClick={() => {
              const next = { ...draft, skipDates: [...new Set([...draft.skipDates, occurrence.startsOn])].sort() };
              setDraft(next);
              void save(next);
            }}
          >
            Skip only {formatDate(occurrence.startsOn, false)}
          </button>
        </div>
      ) : null}
      <div className={shell.fields}>
        <label className={shell.field}>
          Title
          <input value={draft.title} maxLength={120} onChange={(e) => set("title", e.target.value)} aria-invalid={Boolean(errors.title)} />
          <FieldError message={errors.title} />
        </label>

        <fieldset className={styles.fieldset}>
          <legend>Category</legend>
          <div className={styles.choiceGrid}>
            {MISSIO_EVENT_CATEGORIES.map((category) => (
              <label key={category} className={styles.choice} data-cat={category}>
                <input type="radio" name="category" checked={draft.category === category} onChange={() => set("category", category)} />
                <Marker category={category} />
                <span>{CATEGORY_LABEL[category]}</span>
              </label>
            ))}
          </div>
          <FieldError message={errors.category} />
        </fieldset>

        <fieldset className={styles.fieldset}>
          <legend>Campus</legend>
          <div className={styles.segment} role="radiogroup" aria-label="Campus">
            {CAMPUSES.map((campus) => (
              <label key={campus} className={styles.segmentItem}>
                <input type="radio" name="campus" checked={draft.campus === campus} onChange={() => set("campus", campus)} />
                <span>{campus === "all" ? "Both" : CAMPUS_LABEL[campus]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className={styles.check}>
          <input type="checkbox" checked={draft.allDay} onChange={(e) => set("allDay", e.target.checked)} />
          All day
        </label>

        <div className={shell.row2}>
          <label className={shell.field}>
            {draft.allDay ? "First day" : "Starts"}
            <input
              type="date"
              value={draft.startsOn}
              onChange={(e) => {
                const value = e.target.value;
                setDraft((current) => {
                  // Keep the length when the start moves.
                  const length = Math.max(0, diffDays(current.startsOn, current.endsOn || current.startsOn));
                  return { ...current, startsOn: value, endsOn: value ? addDays(value, length) : current.endsOn };
                });
              }}
            />
            <FieldError message={errors.startsOn} />
          </label>
          <label className={shell.field}>
            {draft.allDay ? "Last day" : "Ends"}
            <input type="date" value={draft.endsOn} min={draft.startsOn} onChange={(e) => set("endsOn", e.target.value)} />
            <FieldError message={errors.endsOn} />
          </label>
        </div>
        {!draft.allDay ? (
          <div className={shell.row2}>
            <label className={shell.field}>
              Start time
              <input type="time" value={draft.startTime} step={300} onChange={(e) => set("startTime", e.target.value)} />
              <FieldError message={errors.startTime} />
            </label>
            <label className={shell.field}>
              End time
              <input type="time" value={draft.endTime} step={300} onChange={(e) => set("endTime", e.target.value)} />
              <FieldError message={errors.endTime} />
            </label>
          </div>
        ) : null}
        <p className={styles.hint}>
          {span > 0 ? `${span + 1} days. ` : ""}Johannesburg time (SAST).
        </p>

        <label className={shell.field}>
          Repeats
          <select value={draft.every} onChange={(e) => set("every", Number(e.target.value))}>
            {EVERY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <FieldError message={errors.repeatEvery} />
        </label>
        {repeating ? (
          <div className={shell.row2}>
            <label className={shell.field}>
              Ends
              <select value={draft.endMode} onChange={(e) => set("endMode", e.target.value as EndMode)}>
                <option value="never">Keeps going</option>
                <option value="until">On a date</option>
                <option value="count">After a number of times</option>
              </select>
            </label>
            {draft.endMode === "until" ? (
              <label className={shell.field}>
                Last date
                <input type="date" value={draft.until} min={draft.startsOn} onChange={(e) => set("until", e.target.value)} />
                <FieldError message={errors.repeatUntil} />
              </label>
            ) : draft.endMode === "count" ? (
              <label className={shell.field}>
                How many times
                <input type="number" inputMode="numeric" min={1} max={520} value={draft.count} onChange={(e) => set("count", e.target.value)} />
                <FieldError message={errors.repeatCount} />
              </label>
            ) : (
              <span />
            )}
          </div>
        ) : null}
        {repeating && draft.skipDates.length > 0 ? (
          <div className={styles.skips}>
            <span>Skipped:</span>
            {draft.skipDates.map((date) => (
              <button
                key={date}
                type="button"
                className={styles.skipChip}
                onClick={() => set("skipDates", draft.skipDates.filter((item) => item !== date))}
                aria-label={`Put ${formatDate(date)} back`}
              >
                {formatDate(date, false)} ×
              </button>
            ))}
          </div>
        ) : null}

        <label className={shell.field}>
          Where (optional)
          <input value={draft.location} maxLength={200} onChange={(e) => set("location", e.target.value)} />
          <FieldError message={errors.location} />
        </label>
        <label className={shell.field}>
          Notes (optional)
          <textarea className={styles.textarea} value={draft.description} maxLength={2000} onChange={(e) => set("description", e.target.value)} />
          <FieldError message={errors.description} />
        </label>
      </div>
    </CalendarSheet>
  );
}

/** Read-only: public holidays and school terms, and everything on the public page. */
export function EventDetail({
  occurrence,
  onClose,
  pastor,
}: {
  occurrence: Occurrence;
  onClose: () => void;
  pastor: boolean;
}) {
  const { event } = occurrence;
  return (
    <CalendarSheet title={event.title} testId="calendar-detail" onClose={onClose} focusFirstField={false}>
      <div className={styles.detail}>
        <CategoryTag category={event.category} />
        <p className={styles.detailWhen}>
          {occurrence.startsOn === occurrence.endsOn ? formatDay(occurrence.startsOn) : `${formatDay(occurrence.startsOn)} – ${formatDay(occurrence.endsOn)}`}
          {event.startTime ? ` · ${whenLabel(occurrence)}` : ""}
        </p>
        <p className={styles.detailMeta}>
          {CAMPUS_LABEL[event.campus]}
          {event.repeat ? ` · ${event.repeat.every === 1 ? "every week" : `every ${event.repeat.every} weeks`}` : ""}
        </p>
        {event.location ? <p className={styles.detailMeta}>{event.location}</p> : null}
        {event.description ? <p className={styles.sheetText}>{event.description}</p> : null}
        {event.note ? <p className={styles.hint}>{event.note}</p> : null}
        {pastor && event.source === "national" ? (
          <p className={styles.hint}>
            Public holidays and school terms come from the national calendar and can’t be edited here. Hide them with the
            “Holidays & school” filter.
          </p>
        ) : null}
      </div>
    </CalendarSheet>
  );
}
