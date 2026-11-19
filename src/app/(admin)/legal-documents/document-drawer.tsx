"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { StatusPill } from "@/components/ffsa";
import {
  APPLICATION_STATE_LABEL,
  DOCUMENT_STATE_LABEL,
  applicationState,
  describeDays,
  documentState,
  isApplicationOpen,
} from "@/lib/legal/status";
import {
  APPLICATION_TONE,
  Button,
  DOCUMENT_STATUS_LABEL,
  DOCUMENT_TONE,
  DrawerSection,
  ErrorLine,
  Field,
  History,
  Select,
  TextArea,
  TextInput,
  callApi,
  formatBytes,
  formatDate,
  type AppRow,
  type DocRow,
  type FileRow,
  type FolderRow,
  type TypeRow,
} from "./legal-ui";

type Form = {
  folder_id: string;
  type_id: string;
  title: string;
  holder: string;
  issuer: string;
  reference_no: string;
  issued_on: string;
  expires_on: string;
  renew_lead_days: string;
  status: string;
  superseded_by: string;
  notes: string;
};

function toForm(doc: DocRow | null, folderId: string): Form {
  return {
    folder_id: doc?.folder_id ?? folderId,
    type_id: doc?.type_id ?? "",
    title: doc?.title ?? "",
    holder: doc?.holder ?? "",
    issuer: doc?.issuer ?? "",
    reference_no: doc?.reference_no ?? "",
    issued_on: doc?.issued_on ?? "",
    expires_on: doc?.expires_on ?? "",
    renew_lead_days: doc?.renew_lead_days == null ? "" : String(doc.renew_lead_days),
    status: doc?.status ?? "held",
    superseded_by: doc?.superseded_by ?? "",
    notes: doc?.notes ?? "",
  };
}

/** Empty strings become null so the API clears the field. */
function toBody(f: Form) {
  const n = (v: string) => (v.trim() === "" ? null : v.trim());
  return {
    folder_id: f.folder_id,
    type_id: n(f.type_id),
    title: f.title.trim(),
    holder: n(f.holder),
    issuer: n(f.issuer),
    reference_no: n(f.reference_no),
    issued_on: n(f.issued_on),
    expires_on: n(f.expires_on),
    renew_lead_days: f.renew_lead_days.trim() === "" ? null : Number(f.renew_lead_days),
    status: f.status,
    superseded_by: n(f.superseded_by),
    notes: n(f.notes),
  };
}

export function DocumentPanel({
  doc,
  defaultFolderId,
  folders,
  types,
  documents,
  files,
  applications,
  today,
  onCreated,
  onOpenApplication,
  onStartApplication,
  onReviewFile,
}: {
  /** null = a new document. */
  doc: DocRow | null;
  defaultFolderId: string;
  folders: FolderRow[];
  types: TypeRow[];
  documents: DocRow[];
  files: FileRow[];
  applications: AppRow[];
  today: string;
  onCreated: (id: string) => void;
  onOpenApplication: (id: string) => void;
  onStartApplication: (doc: DocRow) => void;
  onReviewFile: (fileId: string) => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(() => toForm(doc, defaultFolderId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [version, setVersion] = useState(0);

  // A different document opened in the same drawer: start from its values.
  // Keyed on the id only: the admin shell refreshes the page every 10 s, and
  // a new `doc` object from that must not wipe what is being typed.
  const docId = doc?.id ?? null;
  useEffect(() => {
    setForm(toForm(doc, defaultFolderId));
    setError(null);
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, defaultFolderId]);

  const set = (key: keyof Form) => (v: string) => {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: v }));
  };

  const type = types.find((t) => t.id === form.type_id) ?? null;
  const docApps = doc ? applications.filter((a) => a.document_id === doc.id) : [];
  const docFiles = doc ? files.filter((f) => f.document_id === doc.id) : [];
  const state = doc
    ? documentState(
        {
          ...doc,
          type_lead_days: types.find((t) => t.id === doc.type_id)?.lead_days ?? null,
          has_open_application: docApps.some((a) => isApplicationOpen(a.status)),
        },
        today
      )
    : null;
  const replacements = documents.filter((d) => d.id !== doc?.id && d.folder_id === form.folder_id);
  const activeFolders = folders.filter((f) => !f.archived_at || f.id === form.folder_id);

  // Picking a type fills the blanks it can, never overwrites what's typed.
  function pickType(id: string) {
    const t = types.find((x) => x.id === id);
    setSaved(false);
    setForm((f) => ({
      ...f,
      type_id: id,
      title: f.title || t?.name || "",
      issuer: f.issuer || t?.issuer || "",
    }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (doc) {
        await callApi("PATCH", `/api/legal/documents/${doc.id}`, toBody(form));
        setSaved(true);
        setVersion((v) => v + 1);
      } else {
        const r = await callApi<{ document: { id: string } }>("POST", "/api/legal/documents", toBody(form));
        onCreated(r.document.id);
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {doc && state && (
        <div className="border-b border-ink bg-bone px-5 py-5 sm:px-6">
          <div className="mono-label mb-2">{folders.find((f) => f.id === doc.folder_id)?.name ?? "Folder"}</div>
          <h2 className="font-display text-[28px] font-black uppercase leading-[0.95]">{doc.title}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill tone={DOCUMENT_TONE[state.state]}>{DOCUMENT_STATE_LABEL[state.state]}</StatusPill>
            <span className="font-mono text-[11px] tracking-[0.06em] text-[color:var(--text-secondary)]">
              {state.state === "inactive" ? "Kept for the record" : describeDays(state.daysLeft)}
            </span>
          </div>
          {state.state === "expiring" && (
            <div className="mt-4">
              <Button onClick={() => onStartApplication(doc)}>Start the renewal</Button>
            </div>
          )}
        </div>
      )}

      <DrawerSection title={doc ? "Details" : "New document"}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Folder" className="sm:col-span-2">
            <Select value={form.folder_id} onChange={set("folder_id")} disabled={!!doc && docFiles.length > 0}>
              {activeFolders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Type" className="sm:col-span-2" hint={type && !type.is_confirmed ? "Draft type — lead time not confirmed yet." : undefined}>
            <Select value={form.type_id} onChange={pickType}>
              <option value="">No type</option>
              {(["organisation", "personal"] as const).map((cat) => (
                <optgroup key={cat} label={cat === "organisation" ? "Organisation" : "Personal"}>
                  {types.filter((t) => t.category === cat).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label="Title" className="sm:col-span-2">
            <TextInput value={form.title} onChange={set("title")} required maxLength={200} />
          </Field>
          <Field label="Holder" hint="Whose it is: FFSA, or a person.">
            <TextInput value={form.holder} onChange={set("holder")} maxLength={200} />
          </Field>
          <Field label="Issued by">
            <TextInput value={form.issuer} onChange={set("issuer")} maxLength={200} />
          </Field>
          <Field label="Reference number" className="sm:col-span-2">
            <TextInput value={form.reference_no} onChange={set("reference_no")} maxLength={120} autoComplete="off" />
          </Field>
          <Field label="Issued">
            <TextInput type="date" value={form.issued_on} onChange={set("issued_on")} />
          </Field>
          <Field label="Expires">
            <TextInput type="date" value={form.expires_on} onChange={set("expires_on")} />
          </Field>
          <Field label="Start renewing" hint={`Days before expiry. Blank = ${type ? `the type's ${type.lead_days}` : "60"}.`}>
            <TextInput type="number" inputMode="numeric" min={0} max={730} value={form.renew_lead_days} onChange={set("renew_lead_days")} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={set("status")}>
              {Object.entries(DOCUMENT_STATUS_LABEL).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </Select>
          </Field>
          {doc && (
            <Field label="Replaced by" className="sm:col-span-2">
              <Select value={form.superseded_by} onChange={set("superseded_by")}>
                <option value="">Not replaced</option>
                {replacements.map((d) => (
                  <option key={d.id} value={d.id}>{d.title}{d.expires_on ? ` (to ${formatDate(d.expires_on)})` : ""}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Notes" className="sm:col-span-2">
            <TextArea value={form.notes} onChange={set("notes")} />
          </Field>
        </div>
        <div className="mt-4 space-y-3">
          <ErrorLine message={error} />
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving || !form.title.trim() || !form.folder_id}>
              {saving ? "Saving…" : doc ? "Save changes" : "Add document"}
            </Button>
            {saved && <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-grass-text">Saved</span>}
          </div>
        </div>
      </DrawerSection>

      {doc && (
        <>
          <DrawerSection title="Scans and files" meta={docFiles.length ? `${docFiles.length}` : undefined}>
            <FileList files={docFiles} onChanged={() => router.refresh()} onReview={onReviewFile} />
            <div className="mt-3">
              <Uploader folderId={doc.folder_id} documentId={doc.id} />
            </div>
          </DrawerSection>

          <DrawerSection title="Applications">
            {docApps.length === 0 ? (
              <p className="text-[13px] text-[color:var(--text-tertiary)]">Nothing applied for yet.</p>
            ) : (
              <ul className="border-t border-rule">
                {docApps.map((a) => {
                  const s = applicationState(a, today);
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => onOpenApplication(a.id)}
                        className="!font-sans !font-normal normal-case tracking-normal flex min-h-11 w-full items-center justify-between gap-3 border-b border-rule py-2.5 text-left hover:bg-bone"
                      >
                        <span className="min-w-0 truncate text-[14px] font-semibold">{a.title}</span>
                        <StatusPill tone={APPLICATION_TONE[s]}>{APPLICATION_STATE_LABEL[s]}</StatusPill>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-3">
              <Button tone="outline" onClick={() => onStartApplication(doc)}>Start an application</Button>
            </div>
          </DrawerSection>

          <DrawerSection title="History">
            <History table="legal_documents" id={doc.id} version={version} />
          </DrawerSection>
        </>
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────
// FILES
// ────────────────────────────────────────────────────────────

export function FileList({
  files,
  onChanged,
  matchTo,
  onReview,
}: {
  files: FileRow[];
  onChanged: () => void;
  /** When given, each file gets a "match to document" picker. */
  matchTo?: DocRow[];
  /** When given, each file gets a button to its scan review. */
  onReview?: (fileId: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(id: string) {
    setError(null);
    // Open the tab first, synchronously, so pop-up blockers allow it.
    const tab = window.open("", "_blank");
    try {
      const r = await callApi<{ url: string }>("GET", `/api/legal/files/${id}`);
      if (tab) tab.location.href = r.url;
      else window.location.href = r.url;
    } catch (e) {
      tab?.close();
      setError((e as Error).message);
    }
  }

  async function act(id: string, run: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await run();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (files.length === 0) {
    return <p className="text-[13px] text-[color:var(--text-tertiary)]">No scans yet.</p>;
  }

  return (
    <div className="space-y-2">
      <ErrorLine message={error} />
      <ul className="border-t border-rule">
        {files.map((f) => (
          <li key={f.id} className="border-b border-rule py-2.5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => open(f.id)}
                className="!font-sans !font-normal normal-case tracking-normal min-h-11 min-w-0 flex-1 text-left hover:underline"
              >
                <span className="block truncate text-[14px] font-semibold">{f.original_name || "Scan"}</span>
                <span className="block font-mono text-[10px] tracking-[0.06em] text-[color:var(--text-tertiary)]">
                  {f.mime_type === "application/pdf" ? "PDF" : "Photo"} · {formatBytes(f.size_bytes)} · added {formatDate(f.created_at.slice(0, 10))}
                  {f.extraction_status === "done" ? " · read" : f.extraction_status === "failed" ? " · not read" : f.extraction_status === "pending" ? " · reading" : ""}
                </span>
              </button>
              {onReview && (
                <button
                  type="button"
                  onClick={() => onReview(f.id)}
                  className="inline-flex min-h-11 shrink-0 items-center border border-ink px-3 text-[9.5px] hover:bg-bone"
                >
                  Review
                </button>
              )}
              <button
                type="button"
                disabled={busy === f.id}
                onClick={() => {
                  if (window.confirm(`Delete ${f.original_name || "this scan"}? This can't be undone.`)) {
                    act(f.id, () => callApi("DELETE", `/api/legal/files/${f.id}`));
                  }
                }}
                className="flex h-11 w-11 shrink-0 items-center justify-center text-[color:var(--text-tertiary)] hover:text-destructive"
                aria-label={`Delete ${f.original_name || "scan"}`}
              >
                ✕
              </button>
            </div>
            {matchTo && (
              <div className="mt-1.5">
                <select
                  aria-label="Match to a document"
                  className="block min-h-11 w-full"
                  value={f.document_id ?? ""}
                  disabled={busy === f.id}
                  onChange={(e) =>
                    act(f.id, () => callApi("PATCH", `/api/legal/files/${f.id}`, { document_id: e.target.value || null }))
                  }
                >
                  <option value="">Not matched to a document</option>
                  {matchTo.map((d) => (
                    <option key={d.id} value={d.id}>{d.title}</option>
                  ))}
                </select>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic";

/**
 * Uploads one or more files into a folder (and optionally onto a document).
 * The API adds the row and signs a one-time upload; the browser sends the
 * file straight to storage; a failed upload removes the row again.
 */
export function Uploader({
  folderId,
  documentId,
  onUploaded,
  label = "Add scans",
}: {
  folderId: string;
  documentId?: string | null;
  /** Called with the files that landed, e.g. to read them next. */
  onUploaded?: (items: Array<{ id: string; name: string }>) => void;
  label?: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const supabase = useMemo(() => createClient(), []);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    const failed: string[] = [];
    const landed: Array<{ id: string; name: string }> = [];
    const all = Array.from(list);
    for (const [i, file] of all.entries()) {
      setProgress(`Uploading ${i + 1} of ${all.length}…`);
      let fileId: string | null = null;
      try {
        const r = await callApi<{ file: { id: string }; upload: { bucket: string; path: string; token: string } }>(
          "POST",
          "/api/legal/files",
          { folder_id: folderId, document_id: documentId ?? null, name: file.name, type: file.type, size: file.size }
        );
        fileId = r.file.id;
        const { error } = await supabase.storage
          .from(r.upload.bucket)
          .uploadToSignedUrl(r.upload.path, r.upload.token, file, { contentType: file.type });
        if (error) throw new Error(error.message);
        landed.push({ id: fileId, name: file.name });
      } catch (e) {
        failed.push(`${file.name}: ${(e as Error).message}`);
        if (fileId) await callApi("DELETE", `/api/legal/files/${fileId}`).catch(() => undefined);
      }
    }
    setProgress(null);
    setErrors(failed);
    if (input.current) input.current.value = "";
    router.refresh();
    if (landed.length) onUploaded?.(landed);
  }

  return (
    <div className="space-y-2">
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => upload(e.target.files)}
        aria-label="Choose scans to upload"
      />
      <Button tone="outline" onClick={() => input.current?.click()} disabled={!!progress}>
        {progress ?? label}
      </Button>
      <p className="text-[12px] text-[color:var(--text-tertiary)]">
        PDF or photos, up to 50 MB each. PDFs over 22 MB are kept but can&apos;t be read; scan long papers in parts.
      </p>
      {errors.map((e) => (
        <ErrorLine key={e} message={e} />
      ))}
    </div>
  );
}
