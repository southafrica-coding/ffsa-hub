"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import type { PwNation } from "@/lib/departments/db.types";
import pw from "@/components/song-library/pw.module.css";
import { errorCopy, fieldCopy } from "@/components/song-library/client";
import { NoAccessNote } from "@/components/song-library/no-access";
import { formatSaDate } from "@/lib/format/sa-time";
import { slugify } from "@/lib/songwriting/validate";
import { songwritingApi } from "./api";
import { CannotEditNote, ChipListField, NotFoundNote } from "./fields";
import { nationHref, songwritingHref } from "./header";
import { CONTINENT_LABEL, NATION_STATUS_LABEL, PW_CONTINENTS, PW_NATION_STATUSES, nationToDraft, nationToInput, type NationDraft } from "./nation-draft";
import { canEdit, cannotEditCopy } from "./permissions";
import type { SongwritingData } from "./types";
import { useSongwriting } from "./use-songwriting";

export function NationForm({ slug, nationId, initial }: { slug: string; nationId: string | null; initial?: SongwritingData }) {
  const { loading, data, denied } = useSongwriting(slug, initial);
  if (denied) return <NoAccessNote />;
  if (nationId && loading) return <p className={pw.hint}>Loading the nation…</p>;
  const list = songwritingHref(slug, "nations");
  const nation = nationId ? (data.nations.find((n) => n.id === nationId) ?? null) : null;
  if (nationId && !nation) return <NotFoundNote title="Nation not found" backHref={list} backLabel="Back to nations" />;
  if (nation && !canEdit(data.viewer, { kind: "nation" })) {
    return <CannotEditNote text={cannotEditCopy("nation")} backHref={nationHref(slug, nation.id)} backLabel={`Back to ${nation.name}`} />;
  }
  return <NationFormBody key={nation?.id ?? "new"} slug={slug} nation={nation} data={data} />;
}

function NationFormBody({ slug, nation, data }: { slug: string; nation: PwNation | null; data: SongwritingData }) {
  const router = useRouter();
  const id = useId();
  const [draft, setDraft] = useState<NationDraft>(() => nationToDraft(nation));
  const [fields, setFields] = useState<string[]>([]);
  const [fieldCode, setFieldCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof NationDraft>(key: K, value: NationDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const back = nation ? nationHref(slug, nation.id) : songwritingHref(slug, "nations");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = nationToInput(draft, nation ? "edit" : "create");
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
    const result = nation ? await api.updateNation(nation.id, parsed.input) : await api.createNation(parsed.input);
    setBusy(false);
    if (!result.ok) {
      setFields(result.fields);
      setFieldCode(result.code);
      setError(errorCopy(result.code));
      return;
    }
    router.push(nationHref(slug, result.data.nation.id));
    router.refresh();
  }

  async function onDelete() {
    if (!nation || busy) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    const result = await songwritingApi(slug).deleteNation(nation.id);
    setBusy(false);
    if (!result.ok) {
      // 409 nation_has_leads / nation_has_trainings / nation_in_use: say why, keep the nation.
      setConfirmDelete(false);
      setError(errorCopy(result.code));
      return;
    }
    router.push(songwritingHref(slug, "nations"));
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
  const invalid = (name: string) => fields.includes(name) || undefined;

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className={`${pw.sectionBar} ${pw.flush}`}>
        <h2 className={pw.sectionTitle}>{nation ? "Edit nation" : "Add nation"}</h2>
        {nation ? <span className={pw.sectionMeta}>last edited {formatSaDate(nation.updated_at)}</span> : null}
      </div>

      <div className={pw.field}>
        <label className={pw.label} htmlFor={`${id}-name`}>
          Name
        </label>
        <input
          id={`${id}-name`}
          className={pw.input}
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Madagascar"
          aria-invalid={invalid("name")}
          aria-describedby={describedBy("name")}
        />
        {fieldError("name")}
      </div>

      <div className={`${pw.field} ${pw.two}`}>
        <div>
          <label className={pw.label} htmlFor={`${id}-iso`}>
            Country code
          </label>
          <input
            id={`${id}-iso`}
            className={pw.input}
            value={draft.iso_code}
            onChange={(e) => set("iso_code", e.target.value.toUpperCase())}
            placeholder="e.g. MG"
            maxLength={2}
            autoCapitalize="characters"
            autoComplete="off"
            aria-invalid={invalid("iso_code")}
            aria-describedby={describedBy("iso_code", `${id}-iso-hint`)}
          />
          <p className={`${pw.small} ${pw.quiet}`} id={`${id}-iso-hint`} style={{ marginTop: 6 }}>
            Two letters (ISO). Shown on the nation&apos;s tile.
          </p>
          {fieldError("iso_code")}
        </div>
        <div>
          <label className={pw.label} htmlFor={`${id}-continent`}>
            Continent
          </label>
          <select
            id={`${id}-continent`}
            className={pw.input}
            value={draft.continent}
            onChange={(e) => set("continent", e.target.value)}
            aria-invalid={invalid("continent")}
            aria-describedby={describedBy("continent")}
          >
            <option value="">Not set</option>
            {PW_CONTINENTS.map((c) => (
              <option key={c} value={c}>
                {CONTINENT_LABEL[c]}
              </option>
            ))}
          </select>
          {fieldError("continent")}
        </div>
      </div>

      <fieldset className={pw.field} style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className={pw.label}>Status</legend>
        <div className={pw.chips} role="radiogroup" aria-describedby={`${id}-status-hint`}>
          {PW_NATION_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={draft.status === s}
              className={`${pw.chipBtn} ${draft.status === s ? pw.chipBtnOn : ""}`}
              onClick={() => set("status", s)}
            >
              {NATION_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <p className={`${pw.small} ${pw.quiet}`} id={`${id}-status-hint`} style={{ marginTop: 6 }}>
          Tentative: we aren&apos;t sure yet. Its trainings stay out of the totals.
        </p>
        {fieldError("status")}
      </fieldset>

      <ChipListField
        label="Languages"
        values={draft.languages}
        onChange={(v) => set("languages", v)}
        addLabel="Add a language"
        placeholder="e.g. Malagasy"
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
          aria-invalid={invalid("notes")}
          aria-describedby={describedBy("notes")}
        />
        {fieldError("notes")}
      </div>

      <div className={pw.field}>
        <label className={pw.label} htmlFor={`${id}-slug`}>
          Slug{nation ? "" : " (optional)"}
        </label>
        <input
          id={`${id}-slug`}
          className={pw.input}
          value={draft.slug}
          onChange={(e) => set("slug", e.target.value)}
          placeholder={slugify(draft.name) || "e.g. madagascar"}
          autoCapitalize="none"
          autoComplete="off"
          aria-invalid={invalid("slug")}
          aria-describedby={describedBy("slug", `${id}-slug-hint`)}
        />
        <p className={`${pw.small} ${pw.quiet}`} id={`${id}-slug-hint`} style={{ marginTop: 6 }}>
          {nation ? "Lower-case letters, numbers and dashes." : "Leave it blank and the Hub makes one from the name."}
        </p>
        {fieldError("slug")}
      </div>

      {nation && canEdit(data.viewer, { kind: "nation" }) ? (
        <div className={pw.field}>
          <button type="button" className={`${pw.btn} ${pw.ghost} ${pw.danger} ${pw.block}`} onClick={onDelete} disabled={busy}>
            {confirmDelete ? "Tap again to delete" : "Delete nation"}
          </button>
          <p className={`${pw.small} ${pw.quiet}`} style={{ marginTop: 6 }}>
            Only a nation with no trainings and no leads can be deleted.
          </p>
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
          {busy ? "Saving…" : nation ? "Save changes" : "Add nation"}
        </button>
      </div>
    </form>
  );
}
