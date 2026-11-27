"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import type { PwSongwritingTraining, PwTrainingFacilitator } from "@/lib/departments/db.types";
import pw from "@/components/song-library/pw.module.css";
import { errorCopy, fieldCopy } from "@/components/song-library/client";
import { formatSaDate } from "@/lib/format/sa-time";
import { songwritingApi } from "./api";
import { CannotEditNote, ChipListField, NotFoundNote } from "./fields";
import { songwritingHref } from "./header";
import { canEdit, cannotEditCopy } from "./permissions";
import { monthOfDate, toDraft, toInput, type TrainingDraft } from "./training-draft";
import type { SongwritingData } from "./types";
import { NoAccessNote } from "@/components/song-library/no-access";
import { useSongwriting } from "./use-songwriting";

export { parseCount, toInput, toDraft, checkTrainingDate } from "./training-draft";

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
  const { loading, data, denied } = useSongwriting(slug, initial);
  if (denied) return <NoAccessNote />;
  if (trainingId && loading) return <p className={pw.hint}>Loading the training…</p>;
  const back = songwritingHref(slug, "trainings");
  const training = trainingId ? (data.trainings.find((t) => t.id === trainingId) ?? null) : null;
  if (trainingId && !training) return <NotFoundNote title="Training not found" backHref={back} backLabel="Back to trainings" />;
  if (training && !canEdit(data.viewer, { kind: "training", created_by: training.created_by })) {
    return <CannotEditNote text={cannotEditCopy("training")} backHref={back} backLabel="Back to trainings" />;
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
  const [draft, setDraft] = useState<TrainingDraft>(() => toDraft(training, facilitators));
  const [fields, setFields] = useState<string[]>([]);
  const [fieldCode, setFieldCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const back = songwritingHref(slug, "trainings");
  const set = <K extends keyof TrainingDraft>(key: K, value: TrainingDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = toInput(draft);
    if ("fields" in parsed) {
      setFields(parsed.fields);
      setFieldCode(null);
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
      setFieldCode(result.code);
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
        {fieldCopy(name, fieldCode)}
      </p>
    ) : null;
  const describedBy = (name: string, hint?: string) =>
    [fields.includes(name) ? `${id}-${name}-err` : null, hint].filter(Boolean).join(" ") || undefined;

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
          aria-describedby={describedBy("audience_label", `${id}-name-hint`)}
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
          <label className={pw.label} htmlFor={`${id}-date`}>
            Date (optional)
          </label>
          <input
            id={`${id}-date`}
            type="date"
            className={pw.input}
            value={draft.training_date}
            onChange={(e) => {
              const value = e.target.value;
              setDraft((d) => ({ ...d, training_date: value, month: d.month || monthOfDate(value) }));
            }}
            aria-invalid={fields.includes("training_date") || undefined}
            aria-describedby={describedBy("training_date", `${id}-date-hint`)}
          />
          <p className={`${pw.small} ${pw.quiet}`} id={`${id}-date-hint`} style={{ marginTop: 6 }}>
            Saved with the training. It has to fall in the month above. Leave it blank to keep the month only.
          </p>
          {fieldError("training_date")}
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
          <select
            id={`${id}-nation`}
            className={pw.input}
            value={draft.nation_id}
            onChange={(e) => set("nation_id", e.target.value)}
            aria-invalid={fields.includes("nation_id") || undefined}
            aria-describedby={describedBy("nation_id")}
          >
            <option value="">Not set</option>
            {data.nations.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
                {n.status === "tentative" ? " (tentative)" : ""}
              </option>
            ))}
          </select>
          {fieldError("nation_id")}
        </div>
      </div>

      <ChipListField
        label="Trainers"
        values={draft.facilitators}
        onChange={(v) => set("facilitators", v)}
        addLabel="Add a trainer"
        placeholder="Trainer's name"
        error={fieldError("facilitators")}
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
        error={fieldError("languages")}
      />

      <div className={pw.field}>
        <label className={pw.label} htmlFor={`${id}-notes`}>
          Notes
        </label>
        <textarea
          id={`${id}-notes`}
          className={pw.input}
          value={draft.notes}
          onChange={(e) => set("notes", e.target.value)}
          aria-invalid={fields.includes("notes") || undefined}
          aria-describedby={describedBy("notes")}
        />
        {fieldError("notes")}
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

      {training && canEdit(data.viewer, { kind: "training", created_by: training.created_by }) ? (
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
