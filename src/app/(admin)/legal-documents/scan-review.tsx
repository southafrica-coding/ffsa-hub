"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ffsa";
import { cn } from "@/lib/utils/cn";
import { FIELD_LABEL, READABLE_FIELDS, type StoredReading } from "@/lib/legal/reading";
import {
  Button,
  DrawerSection,
  ErrorLine,
  TEXT_RESET,
  callApi,
  formatBytes,
  formatDate,
  inputClass,
  type DocRow,
  type FileRow,
  type FolderRow,
  type TypeRow,
} from "./legal-ui";
import { Uploader } from "./document-drawer";

type Suggestion = { documentId: string; why: string } | null;
type ReadResult = { status: string; text: string | null; reading: StoredReading; suggestion: Suggestion };

const KEYS = ["type_key", ...READABLE_FIELDS] as const;
type Key = (typeof KEYS)[number];

export const READER_NOTE =
  "Scans are read by Claude, Anthropic's AI, to suggest the details. Nothing is saved to a document until you tick it and press Apply.";

/** Opens a scan in a new tab through a short-lived signed link. */
export async function openScan(id: string) {
  const tab = window.open("", "_blank");
  try {
    const r = await callApi<{ url: string }>("GET", `/api/legal/files/${id}`);
    if (tab) tab.location.href = r.url;
    else window.location.href = r.url;
  } catch (e) {
    tab?.close();
    throw e;
  }
}

export function ScanReviewPanel({
  file,
  folders,
  types,
  documents,
  onApplied,
}: {
  file: FileRow;
  folders: FolderRow[];
  types: TypeRow[];
  documents: DocRow[];
  onApplied: (documentId: string) => void;
}) {
  const router = useRouter();
  const [result, setResult] = useState<ReadResult | null>(null);
  const [reading, setReading] = useState(file.extraction_status === "pending");
  const [error, setError] = useState<string | null>(null);

  // What the person has ticked and typed.
  const [values, setValues] = useState<Partial<Record<Key, string>>>({});
  const [ticked, setTicked] = useState<Partial<Record<Key, boolean>>>({});
  const [target, setTarget] = useState<string>("new");
  const [addNotes, setAddNotes] = useState(true);
  const [applying, setApplying] = useState(false);

  const folderDocs = documents.filter((d) => d.folder_id === file.folder_id);
  const folder = folders.find((f) => f.id === file.folder_id);

  function load(r: ReadResult) {
    setResult(r);
    const fields = r.reading.fields ?? {};
    const v: Partial<Record<Key, string>> = {};
    const t: Partial<Record<Key, boolean>> = {};
    for (const k of KEYS) {
      const f = fields[k];
      if (!f) continue;
      v[k] = f.value;
      // Pre-tick only what the reader was sure of and nobody has applied yet.
      t[k] = f.sure && !f.confirmed;
    }
    setValues(v);
    setTicked(t);
    setTarget(r.suggestion?.documentId ?? "new");
  }

  // Already read: fetch the stored reading (the list doesn't carry the text).
  useEffect(() => {
    if (file.extraction_status !== "done") return;
    let live = true;
    callApi<ReadResult>("GET", `/api/legal/files/${file.id}/read`)
      .then((r) => live && load(r))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [file.id, file.extraction_status]);

  async function read() {
    setReading(true);
    setError(null);
    try {
      load(await callApi<ReadResult>("POST", `/api/legal/files/${file.id}/read`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
      router.refresh();
    }
  }

  async function apply() {
    setApplying(true);
    setError(null);
    try {
      const chosen: Record<string, string> = {};
      for (const k of KEYS) if (ticked[k] && values[k]?.trim()) chosen[k] = values[k]!.trim();
      const r = await callApi<{ document_id: string }>("POST", `/api/legal/files/${file.id}/apply`, {
        document_id: target === "new" ? null : target,
        values: chosen,
        add_notes: addNotes,
      });
      router.refresh();
      onApplied(r.document_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApplying(false);
    }
  }

  const r = result?.reading;
  const anyField = r && Object.keys(r.fields ?? {}).length > 0;
  const titleNeeded = target === "new" && !(ticked.title && values.title?.trim());
  const matched = documents.find((d) => d.id === file.document_id);

  return (
    <>
      <div className="border-b border-ink bg-bone px-5 py-5 sm:px-6">
        <div className="mono-label mb-2">Scan · {folder?.name}</div>
        <h2 className="break-words font-display text-[24px] font-black uppercase leading-[0.95]">{file.original_name || "Scan"}</h2>
        <p className="mt-2 font-mono text-[11px] tracking-[0.06em] text-[color:var(--text-secondary)]">
          {file.mime_type === "application/pdf" ? "PDF" : "Photo"} · {formatBytes(file.size_bytes)} · added {formatDate(file.created_at.slice(0, 10))}
          {matched ? ` · filed under ${matched.title}` : " · not filed yet"}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button tone="outline" onClick={() => openScan(file.id).catch((e) => setError(e.message))}>Open scan</Button>
          <Button onClick={read} disabled={reading}>
            {reading ? "Reading…" : file.extraction_status === "done" || result ? "Read again" : "Read this scan"}
          </Button>
        </div>
        <p className={cn("mt-3 text-[12px] text-[color:var(--text-secondary)]", TEXT_RESET)}>{READER_NOTE}</p>
      </div>

      {error && (
        <div className="px-5 pt-4 sm:px-6">
          <ErrorLine message={error} />
        </div>
      )}

      {reading && (
        <DrawerSection title="Reading">
          <p className="text-[13px] text-[color:var(--text-secondary)]">
            Claude is reading the scan. A long PDF can take a minute or two; you can close this and come back.
          </p>
        </DrawerSection>
      )}

      {!reading && !result && file.extraction_status === "failed" && (
        <DrawerSection title="Not read">
          <p className="text-[13px] text-[color:var(--text-secondary)]">
            {file.extracted_fields?.error ? `${file.extracted_fields.error} ` : "The last read didn't work. "}
            Try again, or fill the details in by hand.
          </p>
        </DrawerSection>
      )}

      {r && (
        <>
          <DrawerSection title="What it is">
            {r.is_legible === false && (
              <p className="mb-3 border-l-2 border-destructive bg-[#FBEDEC] px-3 py-2 text-[13px] text-destructive">
                The scan is hard to read. Check every value against the paper, or scan it again.
              </p>
            )}
            {r.document_kind && <p className="mb-1 text-[15px] font-semibold">{r.document_kind}</p>}
            {r.summary && <p className="text-[14px] text-[color:var(--text-secondary)]">{r.summary}</p>}
            {(r.things_to_watch?.length ?? 0) > 0 && (
              <div className="mt-4 border-l-2 border-amber-border bg-[#FBF5E3] px-4 py-3">
                <div className="mono-label mb-2 !text-amber">Things to watch</div>
                <ul className="list-disc space-y-1 pl-4 text-[13.5px]">
                  {r.things_to_watch!.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
          </DrawerSection>

          <DrawerSection title="Details found" meta={anyField ? "Tick what is right" : undefined}>
            {!anyField ? (
              <p className="text-[13px] text-[color:var(--text-secondary)]">No details could be read. Fill them in on the document.</p>
            ) : (
              <ul className="border-t border-rule">
                {KEYS.filter((k) => r.fields?.[k]).map((k) => {
                  const f = r.fields![k]!;
                  const isDate = k === "issued_on" || k === "expires_on";
                  return (
                    <li key={k} className="flex items-start gap-3 border-b border-rule py-3">
                      <input
                        type="checkbox"
                        aria-label={`Use ${FIELD_LABEL[k]}`}
                        checked={!!ticked[k]}
                        onChange={(e) => setTicked((t) => ({ ...t, [k]: e.target.checked }))}
                        className="mt-3 h-5 w-5 shrink-0 accent-[#0A0A0A]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="mono-label">{FIELD_LABEL[k]}</span>
                          {!f.sure && <StatusPill tone="warn">Check this</StatusPill>}
                          {f.confirmed && <StatusPill tone="good">Applied</StatusPill>}
                        </div>
                        {k === "type_key" ? (
                          <select
                            aria-label={FIELD_LABEL[k]}
                            value={values[k] ?? ""}
                            onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                            className={inputClass}
                          >
                            {types.map((t) => (
                              <option key={t.key} value={t.key}>{t.name}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            aria-label={FIELD_LABEL[k]}
                            type={isDate ? "date" : "text"}
                            value={values[k] ?? ""}
                            onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                            className={inputClass}
                            autoComplete="off"
                          />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </DrawerSection>

          <DrawerSection title="File it under">
            <select
              aria-label="Document"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className={inputClass}
            >
              <option value="new">A new document in {folder?.name}</option>
              {folderDocs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                  {d.expires_on ? ` (to ${formatDate(d.expires_on)})` : ""}
                </option>
              ))}
            </select>
            {result?.suggestion && target === result.suggestion.documentId && (
              <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-tertiary)]">
                Suggested: {result.suggestion.why.toLowerCase()}
              </p>
            )}
            {target !== "new" && Object.values(ticked).some(Boolean) && (
              <p className="mt-2 text-[12.5px] text-[color:var(--text-secondary)]">
                The ticked details will replace what that document has now.
              </p>
            )}
            <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={addNotes}
                onChange={(e) => setAddNotes(e.target.checked)}
                className="h-5 w-5 shrink-0 accent-[#0A0A0A]"
              />
              <span className={cn("text-[14px] text-ink", TEXT_RESET)}>Add the summary and things to watch to the notes</span>
            </label>
            <div className="mt-4">
              <Button onClick={apply} disabled={applying || titleNeeded}>
                {applying ? "Saving…" : target === "new" ? "Apply to a new document" : "Apply"}
              </Button>
              {titleNeeded && (
                <p className="mt-2 text-[12.5px] text-[color:var(--text-secondary)]">Tick a title for the new document.</p>
              )}
            </div>
          </DrawerSection>

          {result?.text && (
            <DrawerSection title="Full text">
              <details>
                <summary className="min-h-11 cursor-pointer font-mono text-[10px] font-bold uppercase tracking-[0.14em]">
                  Show what was read
                </summary>
                <pre className="mt-3 max-h-[50vh] overflow-auto whitespace-pre-wrap break-words bg-bone p-3 font-mono text-[12px] leading-relaxed">
                  {result.text}
                </pre>
              </details>
            </DrawerSection>
          )}
        </>
      )}
    </>
  );
}

/**
 * Scan in: pick a folder, add many scans, and each is read as it lands.
 * Files arrive unfiled; the person files each from its review.
 */
export function ScanInPanel({
  folders,
  defaultFolderId,
  onReview,
}: {
  folders: FolderRow[];
  defaultFolderId: string;
  onReview: (fileId: string) => void;
}) {
  const router = useRouter();
  const [folderId, setFolderId] = useState(defaultFolderId);
  const [queue, setQueue] = useState<
    Array<{ id: string; name: string; state: "waiting" | "reading" | "read" | "failed"; error?: string }>
  >([]);

  async function readAll(items: Array<{ id: string; name: string }>) {
    setQueue((q) => [...q, ...items.map((it) => ({ ...it, state: "waiting" as const }))]);
    // One at a time: kinder to rate limits, and the first results arrive soonest.
    for (const { id } of items) {
      setQueue((q) => q.map((x) => (x.id === id ? { ...x, state: "reading" } : x)));
      try {
        await callApi("POST", `/api/legal/files/${id}/read`);
        setQueue((q) => q.map((x) => (x.id === id ? { ...x, state: "read" } : x)));
      } catch (e) {
        setQueue((q) => q.map((x) => (x.id === id ? { ...x, state: "failed", error: (e as Error).message } : x)));
      }
      router.refresh();
    }
  }

  const live = folders.filter((f) => !f.archived_at);
  return (
    <>
      <div className="border-b border-ink bg-bone px-5 py-5 sm:px-6">
        <div className="mono-label mb-2">Scan in</div>
        <h2 className="font-display text-[28px] font-black uppercase leading-[0.95]">Add papers</h2>
        <p className={cn("mt-3 text-[13px] text-[color:var(--text-secondary)]", TEXT_RESET)}>
          Pick the folder, add the scans, and each one is read as it arrives. Then open each scan to check what was
          found and file it.
        </p>
        <p className={cn("mt-2 text-[12px] text-[color:var(--text-secondary)]", TEXT_RESET)}>{READER_NOTE}</p>
      </div>
      <DrawerSection title="Folder">
        <select aria-label="Folder" value={folderId} onChange={(e) => setFolderId(e.target.value)} className={inputClass}>
          {live.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <div className="mt-4">
          <Uploader folderId={folderId} onUploaded={readAll} label="Choose scans" />
        </div>
      </DrawerSection>
      {queue.length > 0 && (
        <DrawerSection title="This batch" meta={`${queue.filter((q) => q.state === "read").length} of ${queue.length} read`}>
          <ul className="border-t border-rule">
            {queue.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => onReview(q.id)}
                  className="!font-sans !font-normal normal-case tracking-normal flex min-h-12 w-full items-center justify-between gap-3 border-b border-rule py-2 text-left hover:bg-bone"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-semibold">{q.name}</span>
                    {q.error && <span className="block text-[12px] text-destructive">{q.error}</span>}
                  </span>
                  <StatusPill tone={q.state === "read" ? "good" : q.state === "failed" ? "bad" : "quiet"}>
                    {q.state === "read" ? "Review" : q.state === "failed" ? "Not read" : q.state === "reading" ? "Reading…" : "Waiting"}
                  </StatusPill>
                </button>
              </li>
            ))}
          </ul>
        </DrawerSection>
      )}
    </>
  );
}
