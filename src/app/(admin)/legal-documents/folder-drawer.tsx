"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  DrawerSection,
  ErrorLine,
  FOLDER_KIND_LABEL,
  Field,
  History,
  Select,
  TextArea,
  TextInput,
  callApi,
  type DocRow,
  type FileRow,
  type FolderRow,
} from "./legal-ui";
import { FileList, Uploader } from "./document-drawer";

export function FolderPanel({
  folder,
  documents,
  files,
  onCreated,
  onReviewFile,
}: {
  /** null = a new folder. */
  folder: FolderRow | null;
  documents: DocRow[];
  files: FileRow[];
  onCreated: (id: string) => void;
  onReviewFile: (fileId: string) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(folder?.name ?? "");
  const [kind, setKind] = useState<string>(folder?.kind ?? "project");
  const [description, setDescription] = useState(folder?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const folderId = folder?.id ?? null;
  useEffect(() => {
    setName(folder?.name ?? "");
    setKind(folder?.kind ?? "project");
    setDescription(folder?.description ?? "");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);

  const unmatched = folder ? files.filter((f) => f.folder_id === folder.id && !f.document_id) : [];
  const folderDocs = folder ? documents.filter((d) => d.folder_id === folder.id) : [];

  async function run(fn: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await fn();
      setVersion((v) => v + 1);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function save() {
    const body = { name: name.trim(), kind, description: description.trim() || null };
    run(async () => {
      if (folder) await callApi("PATCH", `/api/legal/folders/${folder.id}`, body);
      else {
        const r = await callApi<{ folder: { id: string } }>("POST", "/api/legal/folders", body);
        onCreated(r.folder.id);
      }
    });
  }

  return (
    <>
      {folder && (
        <div className="border-b border-ink bg-bone px-5 py-5 sm:px-6">
          <div className="mono-label mb-2">
            Folder · {FOLDER_KIND_LABEL[folder.kind]}
            {folder.archived_at ? " · archived" : ""}
          </div>
          <h2 className="font-display text-[28px] font-black uppercase leading-[0.95]">{folder.name}</h2>
          <p className="mt-2 font-mono text-[11px] tracking-[0.06em] text-[color:var(--text-secondary)]">
            {folderDocs.length} {folderDocs.length === 1 ? "document" : "documents"} · {unmatched.length} unmatched{" "}
            {unmatched.length === 1 ? "scan" : "scans"}
          </p>
        </div>
      )}

      {folder && (
        <DrawerSection title="Scans to match" meta={unmatched.length ? `${unmatched.length}` : undefined}>
          <p className="mb-3 text-[13px] text-[color:var(--text-secondary)]">
            Scan papers into the folder, then review each one: check what was read and file it under its document.
          </p>
          <FileList files={unmatched} matchTo={folderDocs} onChanged={() => router.refresh()} onReview={onReviewFile} />
          <div className="mt-3">
            <Uploader folderId={folder.id} />
          </div>
        </DrawerSection>
      )}

      <DrawerSection title={folder ? "Details" : "New folder"}>
        <div className="grid grid-cols-1 gap-4">
          <Field label="Name">
            <TextInput value={name} onChange={setName} maxLength={120} required />
          </Field>
          <Field label="Kind" hint="Organisation and personal folders are standing areas; a project folder is for one piece of work.">
            <Select value={kind} onChange={setKind}>
              {Object.entries(FOLDER_KIND_LABEL).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Description">
            <TextArea value={description} onChange={setDescription} rows={2} />
          </Field>
        </div>
        <div className="mt-4 space-y-3">
          <ErrorLine message={error} />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={save} disabled={saving || !name.trim()}>
              {folder ? "Save changes" : "Add folder"}
            </Button>
            {folder && (
              <Button
                tone="outline"
                disabled={saving}
                onClick={() => run(() => callApi("PATCH", `/api/legal/folders/${folder.id}`, { archived: !folder.archived_at }))}
              >
                {folder.archived_at ? "Bring back" : "Archive"}
              </Button>
            )}
          </div>
        </div>
      </DrawerSection>

      {folder && (
        <DrawerSection title="History">
          <History table="legal_folders" id={folder.id} version={version} />
        </DrawerSection>
      )}
    </>
  );
}
