"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import pw from "./pw.module.css";
import sl from "./sl.module.css";
import { songLibraryApi, uploadVersion } from "./api";
import { errorCopy, fieldCopy } from "./client";
import { libraryPaths, type LibraryScope } from "./paths";
import { ENTRY_LABEL, pathwayLabel } from "./stages";
import { SONG_ENTRY_POINTS, SONG_PATHWAYS, type CoWriterInput, type SongEntryPoint, type SongPathway } from "./types";

const ENTRY_ICON: Record<SongEntryPoint, string> = { lyric: "✎", melody: "♪", instrumental: "♫" };
const ENTRY_HINT: Record<SongEntryPoint, string> = { lyric: "Words first", melody: "A tune first", instrumental: "Playing first" };

export type UploadPreset = {
  title?: string;
  file?: File | null;
  entry?: SongEntryPoint;
  pathway?: SongPathway;
  holySpirit?: boolean;
  /** Hub users include user_id; a bare name is a person with no Hub account. */
  coWriters?: Array<string | CoWriterInput>;
  lyrics?: string;
};

function asCoWriter(value: string | CoWriterInput): CoWriterInput {
  if (typeof value === "string") return { display_name: value };
  return value;
}

function coWriterKey(c: CoWriterInput): string {
  return c.user_id ? `user:${c.user_id}` : `name:${c.display_name}`;
}

function coWriterPayload(c: CoWriterInput): CoWriterInput {
  if (c.user_id) return { user_id: c.user_id };
  return { display_name: c.display_name ?? "" };
}

export function UploadForm({
  scope,
  sourceTrainingId,
  preset,
}: {
  scope: LibraryScope;
  sourceTrainingId: string | null;
  preset?: UploadPreset;
}) {
  const paths = libraryPaths(scope);
  const router = useRouter();
  const id = useId();
  const [title, setTitle] = useState(preset?.title ?? "");
  const [file, setFile] = useState<File | null>(preset?.file ?? null);
  const [entry, setEntry] = useState<SongEntryPoint>(preset?.entry ?? "melody");
  const [pathway, setPathway] = useState<SongPathway>(preset?.pathway ?? "b1");
  const [holySpirit, setHolySpirit] = useState(preset?.holySpirit ?? false);
  const [coWriters, setCoWriters] = useState<CoWriterInput[]>(() => (preset?.coWriters ?? []).map(asCoWriter));
  const [coText, setCoText] = useState("");
  const [lyrics, setLyrics] = useState(preset?.lyrics ?? "");
  const [fields, setFields] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  function addCoWriter() {
    const name = coText.trim();
    if (!name) return;
    if (coWriters.some((c) => !c.user_id && c.display_name === name)) {
      setCoText("");
      return;
    }
    setCoWriters([...coWriters, { display_name: name }]);
    setCoText("");
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || savedId) return;
    if (!title.trim()) {
      setFields(["title"]);
      setError("Check the highlighted fields.");
      return;
    }
    setBusy(true);
    setError(null);
    setFields([]);
    const created = await songLibraryApi.upload({
      title: title.trim(),
      entry_point: entry,
      pathway: holySpirit ? null : pathway,
      holy_spirit_interrupt: holySpirit,
      lyrics_md: lyrics.trim() || null,
      source_training_id: sourceTrainingId,
      co_writers: coWriters.map(coWriterPayload),
    });
    if (!created.ok || !created.data?.song) {
      setBusy(false);
      if (!created.ok) setFields(created.fields);
      setError(errorCopy(created.ok ? null : created.code));
      return;
    }
    const songId = created.data.song.id;
    if (file) {
      const audio = await uploadVersion(songId, file);
      if (!audio.ok) {
        setBusy(false);
        setSavedId(songId);
        setError(`The song is saved, but the audio didn't upload. ${errorCopy(audio.code)}`);
        return;
      }
    }
    router.push(paths.song(songId));
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className={`${pw.sectionBar} ${pw.flush}`}>
        <h2 className={pw.sectionTitle}>Upload a song</h2>
        <span className={pw.sectionMeta}>starts at Idea / Entry</span>
      </div>
      {sourceTrainingId ? <p className={pw.hint}>Logged from a songwriting training.</p> : null}

      <div className={pw.field}>
        <label className={pw.label} htmlFor={`${id}-title`}>
          Working title
        </label>
        <input
          id={`${id}-title`}
          className={pw.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={fields.includes("title") || undefined}
          aria-describedby={fields.includes("title") ? `${id}-title-err` : undefined}
        />
        {fields.includes("title") ? (
          <p className={pw.error} id={`${id}-title-err`}>
            {fieldCopy("title")}
          </p>
        ) : null}
      </div>

      <div className={pw.field}>
        <label className={pw.label} htmlFor={`${id}-file`}>
          First audio
        </label>
        <div className={sl.file}>
          <input id={`${id}-file`} type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <p className={`${pw.small} ${pw.muted}`} style={{ marginTop: 8 }}>
          A voice memo is enough. A verse + chorus is a great start.
        </p>
      </div>

      <fieldset className={pw.field} style={{ border: 0, margin: 0 }}>
        <legend className={pw.label}>Entry point · where did it start?</legend>
        <div className={sl.entry} role="radiogroup" aria-label="Entry point">
          {SONG_ENTRY_POINTS.map((e) => (
            <button key={e} type="button" role="radio" aria-checked={entry === e} onClick={() => setEntry(e)}>
              <span className={sl.entryIc} aria-hidden="true">
                {ENTRY_ICON[e]}
              </span>
              <span>
                <span className={sl.entryK}>{ENTRY_LABEL[e]}</span>
                <span className={sl.entryS}>{ENTRY_HINT[e]}</span>
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className={pw.field} style={{ border: 0, margin: 0 }}>
        <legend className={pw.label}>Creative pathway · the next two steps</legend>
        <div className={sl.paths} role="radiogroup" aria-label="Creative pathway">
          {SONG_PATHWAYS.map((p, i) => (
            <button key={p} type="button" role="radio" aria-checked={!holySpirit && pathway === p} disabled={holySpirit} onClick={() => setPathway(p)}>
              <span className={sl.rad} aria-hidden="true" />
              <span className={pw.what}>
                <span className={pw.k} style={{ display: "block" }}>
                  {pathwayLabel(entry, p)}
                </span>
                <span className={pw.s} style={{ display: "block", color: "var(--text-tertiary)", fontSize: 12.5 }}>
                  Branch {i + 1}
                </span>
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className={pw.field}>
        <div className={pw.toggle}>
          <div>
            <div id={`${id}-hs`} style={{ fontWeight: 700 }}>
              Holy Spirit moment
            </div>
            <div className={`${pw.small} ${pw.muted}`} id={`${id}-hs-hint`}>
              It came all at once. Steps can be skipped.
            </div>
          </div>
          <span className={pw.switchHit}>
            <button
              type="button"
              role="switch"
              className={pw.switch}
              aria-checked={holySpirit}
              aria-labelledby={`${id}-hs`}
              aria-describedby={`${id}-hs-hint`}
              onClick={() => setHolySpirit((v) => !v)}
            />
          </span>
        </div>
      </div>

      <div className={pw.field}>
        <span className={pw.label} id={`${id}-co`}>
          Co-writers (optional)
        </span>
        {coWriters.length ? (
          <ul className={pw.chips} aria-labelledby={`${id}-co`} style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {coWriters.map((c) => {
              const name = c.display_name ?? "Co-writer";
              const noAccount = !c.user_id;
              return (
                <li key={coWriterKey(c)}>
                  <button
                    type="button"
                    className={`${pw.chipBtn} ${pw.chipBtnOn}`}
                    onClick={() => setCoWriters(coWriters.filter((x) => coWriterKey(x) !== coWriterKey(c)))}
                    aria-label={noAccount ? `Remove ${name} (no Hub account)` : `Remove ${name}`}
                  >
                    {name}
                    {noAccount ? <span className={`${pw.small} ${pw.muted}`}> No Hub account</span> : null}{" "}
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <div className={pw.addRow}>
          <input
            className={pw.input}
            value={coText}
            onChange={(e) => setCoText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCoWriter();
              }
            }}
            placeholder="Name (no Hub account)"
            aria-label="Add a co-writer with no Hub account"
          />
          <button type="button" className={pw.btn} onClick={addCoWriter}>
            + Add
          </button>
        </div>
        <p className={`${pw.small} ${pw.muted}`} style={{ marginTop: 8 }}>
          A person with no Hub account can&apos;t follow the song or sign off on credits.
        </p>
      </div>

      <div className={pw.field}>
        <label className={pw.label} htmlFor={`${id}-lyrics`}>
          Lyrics or notes (optional)
        </label>
        <textarea id={`${id}-lyrics`} className={pw.input} value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder="Paste lyrics, chords or a scripture" />
      </div>

      <div className={pw.notice}>
        <span className={pw.noticeTag}>HEADS UP</span>
        <span>The whole base can hear this as soon as you upload. Your subscribers get a Slack DM.</span>
      </div>
      {error ? (
        <p className={pw.status} role="alert">
          {error} {savedId ? <Link href={paths.song(savedId)}>Open the song</Link> : null}
        </p>
      ) : null}
      <div className={pw.savebar}>
        <Link className={pw.btn} href={paths.home}>
          Cancel
        </Link>
        <button type="submit" className={`${pw.btn} ${pw.primary}`} disabled={busy}>
          {busy ? "Uploading…" : "Upload song"}
        </button>
      </div>
    </form>
  );
}
