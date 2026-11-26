"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import type { PwSongwritingTraining, PwTrainingFacilitator } from "@/lib/departments/db.types";
import pw from "@/components/song-library/pw.module.css";
import { errorCopy, fieldCopy } from "@/components/song-library/client";
import { formatSaDate } from "@/lib/format/sa-time";
import { songwritingApi } from "./api";
import { songwritingHref } from "./header";
import type { SongwritingData, TrainingInput } from "./types";
import { useSongwriting } from "./use-songwriting";

type Draft = {
  audience_label: string;
  month: string; // YYYY-MM
  day: string; // YYYY-MM-DD, optional, not stored
  location_text: string;
  nation_id: string;
  facilitators: string[];
  people_trained: string;
  songs_workshop: string;
  songs_post: string;
  languages: string[];
  notes: string;
  tentative: boolean;
};

function toDraft(t: PwSongwritingTraining | null, facilitators: PwTrainingFacilitator[]): Draft {
  return {
    audience_label: t?.audience_label ?? "",
    month: t ? `${t.year}-${String(t.month).padStart(2, "0")}` : "",
    day: "",
    location_text: t?.location_text ?? "",
    nation_id: t?.nation_id ?? "",
    facilitators: facilitators.map((f) => f.display_name),
    people_trained: t?.people_trained == null ? "" : String(t.people_trained),
    songs_workshop: t?.songs_workshop == null ? "" : String(t.songs_workshop),
    songs_post: t?.songs_post == null ? "" : String(t.songs_post),
    languages: t?.languages ?? [],
    notes: t?.notes ?? "",
    tentative: t?.status === "draft",
  };
}

/** Blank = unknown (null). Otherwise a whole number 0 or more. */
export function parseCount(value: string): number | null | "invalid" {
  const v = value.trim();
  if (v === "") return null;
  if (!/^\d+$/.test(v)) return "invalid";
  return Number(v);
}

export function toInput(d: Draft): { input: TrainingInput } | { fields: string[] } {
  const fields: string[] = [];
  const m = /^(\d{4})-(\d{2})$/.exec(d.month);
  const year = m ? Number(m[1]) : NaN;
  const month = m ? Number(m[2]) : NaN;
  if (!d.audience_label.trim()) fields.push("audience_label");
  if (!m || month < 1 || month > 12) fields.push("month");
  const trained = parseCount(d.people_trained);
  const workshop = parseCount(d.songs_workshop);
  const post = parseCount(d.songs_post);
  if (trained === "invalid") fields.push("people_trained");
  if (workshop === "invalid") fields.push("songs_workshop");
  if (post === "invalid") fields.push("songs_post");
  if (fields.length) return { fields };
  return {
    input: {
      audience_label: d.audience_label.trim(),
      year,
      month,
      location_text: d.location_text.trim() || null,
      nation_id: d.nation_id || null,
      people_trained: trained as number | null,
      songs_workshop: workshop as number | null,
      songs_post: post as number | null,
      languages: d.languages,
      notes: d.notes.trim() || null,
      status: d.tentative ? "draft" : "completed",
      facilitators: d.facilitators,
    },
  };
}

export function TrainingForm({
  slug,
  trainingId,
  initial,
}: {
  slug: string;
  /** null = add a new training. */
  trainingId: string | null;
  initial?: SongwritingData;
}) {
  const { loading, data } = useSongwriting(slug, initial);
  if (trainingId && loading) return <p className={pw.hint}>Loading the training…</p>;
  const training = trainingId ? (data.trainings.find((t) => t.id === trainingId) ?? null) : null;
  if (trainingId && !training) {
    return (
      <div className={pw.empty}>
        <div className={pw.emptyTitle}>Training not found</div>
        <p className={pw.emptyText}>It may have been deleted.</p>
        <Link className={`${pw.btn} ${pw.block}`} href={songwritingHref(slug, "trainings")} style={{ marginTop: 18 }}>
          Back to trainings
        </Link>
      </div>
    );
  }
  const facilitators = training ? data.facilitators.filter((f) => f.training_id === training.id) : [];
  return <TrainingFormBody key={training?.id ?? "new"} slug={slug} training={training} facilitators={facilitators} data={data} />;
}

function TrainingFormBody({
  slug,
  training,
  facilitators,
  data,
}: {
  slug: string;
  training: PwSongwritingTraining | null;
  facilitators: PwTrainingFacilitator[];
  data: SongwritingData;
}) {
  const router = useRouter();
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => toDraft(training, facilitators));
  const [fields, setFields] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const back = songwritingHref(slug, "trainings");
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = toInput(draft);
    if ("fields" in parsed) {
      setFields(parsed.fields);
      setError("Check the highlighted fields.");
      return;
    }
    setBusy(true);
    setError(null);
    setFields([]);
    const api = songwritingApi(slug);
    const result = training ? await api.updateTraining(training.id, parsed.input) : await api.createTraining(parsed.input);
    setBusy(false);
    if (!result.ok) {
      setFields(result.fields);
      setError(errorCopy(result.code));
      return;
    }
    router.push(back);
    router.refresh();
  }

  async function onDelete() {
    if (!training || busy) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    const result = await songwritingApi(slug).deleteTraining(training.id);
    setBusy(false);
    if (!result.ok) {
      setError(errorCopy(result.code));
      return;
    }
    router.push(back);
    router.refresh();
  }

  const fieldError = (name: string) =>
    fields.includes(name) ? (
      <p className={pw.error} id={`${id}-${name}-err`}>
        {fieldCopy(name)}
      </p>
    ) : null;
  const describedBy = (name: string) => (fields.includes(name) ? `${id}-${name}-err` : undefined);

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className={`${pw.sectionBar} ${pw.flush}`}>
        <h2 className={pw.sectionTitle}>{training ? "Edit training" : "Add training"}</h2>
        {training ? <span className={pw.sectionMeta}>last edited {formatSaDate(training.updated_at)}</span> : null}
      </div>

      <div className={pw.field}>
        <label className={pw.label} htmlFor={`${id}-name`}>
          Training name / group
        </label>
        <input
          id={`${id}-name`}
          className={pw.input}
          value={draft.audience_label}
          onChange={(e) => set("audience_label", e.target.value)}
          placeholder="e.g. DMM Leaders & DTS"
          aria-invalid={fields.includes("audience_label") || undefined}
          aria-describedby={describedBy("audience_label") ?? `${id}-name-hint`}
        />
        <p className={`${pw.small} ${pw.muted}`} id={`${id}-name-hint`} style={{ marginTop: 6 }}>
          For one person, write “1:1 training”, never their name.
        </p>
        {fieldError("audience_label")}
      </div>

      <div className={`${pw.field} ${pw.two}`}>
        <div>
          <label className={pw.label} htmlFor={`${id}-month`}>
            Month
          </label>
          <input
            id={`${id}-month`}
            type="month"
            className={pw.input}
            value={draft.month}
            onChange={(e) => set("month", e.target.value)}
            aria-invalid={fields.includes("month") || undefined}
            aria-describedby={describedBy("month")}
          />
          {fieldError("month")}
        </div>
        <div>
          <label className={pw.label} htmlFor={`${id}-day`}>
            Date (optional)
          </label>
          <input
            id={`${id}-day`}
            type="date"
            className={pw.input}
            value={draft.day}
            onChange={(e) => set("day", e.target.value)}
            aria-describedby={`${id}-day-hint`}
          />
          <p className={`${pw.small} ${pw.quiet}`} id={`${id}-day-hint`} style={{ marginTop: 6 }}>
            Not saved yet: trainings keep the month only.
          </p>
        </div>
      </div>

      <div className={`${pw.field} ${pw.two}`}>
        <div>
          <label className={pw.label} htmlFor={`${id}-place`}>
            Place
          </label>
          <input
            id={`${id}-place`}
            className={pw.input}
            value={draft.location_text}
            onChange={(e) => set("location_text", e.target.value)}
            placeholder="e.g. Potch"
          />
        </div>
        <div>
          <label className={pw.label} htmlFor={`${id}-nation`}>
            Nation
          </label>
          <select id={`${id}-nation`} className={pw.input} value={draft.nation_id} onChange={(e) => set("nation_id", e.target.value)}>
            <option value="">Not set</option>
            {data.nations.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
                {n.status === "tentative" ? " (tentative)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ChipListField
        label="Trainers"
        values={draft.facilitators}
        onChange={(v) => set("facilitators", v)}
        addLabel="Add a trainer"
        placeholder="Trainer's name"
      />

      <fieldset className={pw.field} style={{ border: 0, margin: 0 }}>
        <legend className={pw.label}>Numbers · leave blank if unknown</legend>
        <div className={pw.three}>
          {(
            [
              ["people_trained", "Trained"],
              ["songs_workshop", "Songs"],
              ["songs_post", "After"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <input
                id={`${id}-${key}`}
                className={pw.input}
                inputMode="numeric"
                pattern="[0-9]*"
                value={draft[key]}
                onChange={(e) => set(key, e.target.value)}
                placeholder="?"
                aria-invalid={fields.includes(key) || undefined}
                aria-describedby={describedBy(key)}
              />
              <label className={`${pw.mono} ${pw.under}`} htmlFor={`${id}-${key}`} style={{ display: "block" }}>
                {label}
              </label>
            </div>
          ))}
        </div>
        {fieldError("people_trained") ?? fieldError("songs_workshop") ?? fieldError("songs_post")}
      </fieldset>

      <ChipListField
        label="Languages"
        values={draft.languages}
        onChange={(v) => set("languages", v)}
        addLabel="Add a language"
        placeholder="e.g. Wana"
      />

      <div className={pw.field}>
        <label className={pw.label} htmlFor={`${id}-notes`}>
          Notes
        </label>
        <textarea id={`${id}-notes`} className={pw.input} value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>

      <div className={pw.field}>
        <div className={pw.toggle}>
          <div>
            <div id={`${id}-tent`} style={{ fontWeight: 700 }}>
              Tentative
            </div>
            <div className={`${pw.small} ${pw.muted}`} id={`${id}-tent-hint`}>
              Counts are a guess, or the nation isn&apos;t confirmed. Tentative trainings stay out of the totals.
            </div>
          </div>
          <span className={pw.switchHit}>
            <button
              type="button"
              role="switch"
              className={pw.switch}
              aria-checked={draft.tentative}
              aria-labelledby={`${id}-tent`}
              aria-describedby={`${id}-tent-hint`}
              onClick={() => set("tentative", !draft.tentative)}
            />
          </span>
        </div>
      </div>

      {training ? (
        <div className={pw.field}>
          <button type="button" className={`${pw.btn} ${pw.ghost} ${pw.danger} ${pw.block}`} onClick={onDelete} disabled={busy}>
            {confirmDelete ? "Tap again to delete" : "Delete training"}
          </button>
        </div>
      ) : null}

      {error ? (
        <p className={pw.status} role="alert">
          {error}
        </p>
      ) : null}

      <div className={pw.savebar}>
        <Link className={pw.btn} href={back}>
          Cancel
        </Link>
        <button type="submit" className={`${pw.btn} ${pw.primary}`} disabled={busy}>
          {busy ? "Saving…" : training ? "Save changes" : "Add training"}
        </button>
      </div>
    </form>
  );
}

function ChipListField({
  label,
  values,
  onChange,
  addLabel,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  addLabel: string;
  placeholder: string;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const add = () => {
    const value = text.trim();
    if (!value) return;
    if (!values.some((v) => v.toLowerCase() === value.toLowerCase())) onChange([...values, value]);
    setText("");
  };
  return (
    <div className={pw.field}>
      <span className={pw.label} id={`${id}-label`}>
        {label}
      </span>
      {values.length ? (
        <ul className={pw.chips} aria-labelledby={`${id}-label`} style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {values.map((v) => (
            <li key={v}>
              <button
                type="button"
                className={`${pw.chipBtn} ${pw.chipBtnOn}`}
                onClick={() => onChange(values.filter((x) => x !== v))}
                aria-label={`Remove ${v}`}
              >
                {v} <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={pw.addRow}>
        <input
          className={pw.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          aria-label={addLabel}
        />
        <button type="button" className={pw.btn} onClick={add}>
          + Add
        </button>
      </div>
    </div>
  );
}
