"use client";

// Documents attached to a school's onboarding emails (migration 238).
//
// <EmailDocumentsProvider> loads the school's documents once for the whole
// Emails tab; each email card drops in <EmailDocuments emailType="…"/>.
// Changes save immediately — there is no separate Save for documents, so
// they never get mixed up with an email's unsaved wording.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowDown,
  ArrowUp,
  Check,
  FileText,
  Loader2,
  Paperclip,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import {
  ALLOWED_DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  MAX_EMAIL_ATTACHMENT_BYTES,
  type ProgramEmailDocument,
} from "@/lib/email/program-email-documents";

type Ctx = {
  programId: string;
  documents: ProgramEmailDocument[] | null;
  setDocuments: (docs: ProgramEmailDocument[]) => void;
  loadError: string | null;
};

const DocumentsContext = createContext<Ctx | null>(null);

export function EmailDocumentsProvider({
  programId,
  children,
}: {
  programId: string;
  children: ReactNode;
}) {
  const [documents, setDocuments] = useState<ProgramEmailDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/schools/programs/${programId}/email-documents`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setLoadError(data.error ?? "Could not load documents");
        else setDocuments(data.documents ?? []);
      })
      .catch(() => !cancelled && setLoadError("Could not load documents"));
    return () => {
      cancelled = true;
    };
  }, [programId]);

  return (
    <DocumentsContext.Provider
      value={{ programId, documents, setDocuments, loadError }}
    >
      {children}
    </DocumentsContext.Provider>
  );
}

const ACCEPT = Object.keys(ALLOWED_DOCUMENT_TYPES).join(",");

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function EmailDocuments({
  emailType,
  disabled,
}: {
  emailType: string;
  disabled?: boolean;
}) {
  const ctx = useContext(DocumentsContext);
  if (!ctx) throw new Error("EmailDocuments needs an EmailDocumentsProvider");
  const { programId, documents, setDocuments, loadError } = ctx;

  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const mine = (documents ?? []).filter((d) => d.email_type === emailType);
  const totalBytes = mine.reduce((s, d) => s + d.size_bytes, 0);
  const endpoint = `/api/schools/programs/${programId}/email-documents`;

  const call = useCallback(
    async (label: string, init: RequestInit, query = "") => {
      setBusy(label);
      setError(null);
      try {
        const res = await fetch(endpoint + query, init);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Something went wrong");
        if (data.documents) setDocuments(data.documents);
        return data;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
        return null;
      } finally {
        setBusy(null);
      }
    },
    [endpoint, setDocuments]
  );

  async function upload(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!ALLOWED_DOCUMENT_TYPES[file.type]) {
        setError(`"${file.name}" isn't a PDF, Word, Excel, PNG or JPG file.`);
        continue;
      }
      if (file.size > MAX_DOCUMENT_BYTES) {
        setError(`"${file.name}" is over 10 MB.`);
        continue;
      }
      const json = { "Content-Type": "application/json" };
      const base = { emailType, fileName: file.name, contentType: file.type };
      const signed = await call("upload", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ ...base, action: "sign", size: file.size }),
      });
      if (!signed) return;

      setBusy("upload");
      const put = await fetch(signed.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      }).catch(() => null);
      if (!put?.ok) {
        setBusy(null);
        setError(`Upload of "${file.name}" failed — please try again.`);
        return;
      }

      const confirmed = await call("upload", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ ...base, action: "confirm", path: signed.path }),
      });
      if (!confirmed) return;
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  function move(index: number, dir: -1 | 1) {
    const order = mine.map((d) => d.id);
    const j = index + dir;
    [order[index], order[j]] = [order[j], order[index]];
    call("order", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailType, order }),
    });
  }

  async function saveRename() {
    if (!renaming) return;
    const ok = await call("rename", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: renaming.id, fileName: renaming.name }),
    });
    if (ok) setRenaming(null);
  }

  function remove(doc: ProgramEmailDocument) {
    if (!confirm(`Stop attaching "${doc.file_name}" to this email?`)) return;
    call("delete", { method: "DELETE" }, `?id=${doc.id}`);
  }

  return (
    <div className="border bg-muted/30 px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5" />
          Documents
          {mine.length > 0 && (
            <span className="font-normal text-muted-foreground">
              · {mine.length} attached, {formatSize(totalBytes)} of 25 MB
            </span>
          )}
        </label>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!!busy || documents === null || disabled}
          onClick={() => fileInput.current?.click()}
        >
          {busy === "upload" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Uploading…
            </>
          ) : (
            "Add document"
          )}
        </Button>
      </div>

      {documents === null && !loadError && (
        <p className="text-xs text-muted-foreground">Loading…</p>
      )}
      {loadError && <p className="text-xs text-destructive">{loadError}</p>}

      {mine.length > 0 && (
        <ul className="divide-y border bg-background">
          {mine.map((doc, i) => (
            <li key={doc.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              {renaming?.id === doc.id ? (
                <>
                  <Input
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: doc.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveRename();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    className="h-7 text-sm"
                    autoFocus
                  />
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-1.5" onClick={saveRename} disabled={!!busy} aria-label="Save name">
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-1.5" onClick={() => setRenaming(null)} aria-label="Cancel rename">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <a
                    href={`${endpoint}?id=${doc.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate hover:underline"
                    title="Open"
                  >
                    {doc.file_name}
                  </a>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatSize(doc.size_bytes)}
                  </span>
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-1.5" disabled={!!busy || i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-1.5" disabled={!!busy || i === mine.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-1.5" disabled={!!busy} onClick={() => setRenaming({ id: doc.id, name: doc.file_name })} aria-label="Rename">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-1.5 text-destructive" disabled={!!busy} onClick={() => remove(doc)} aria-label="Remove">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        {mine.length === 0
          ? "Attach files that should go out with this email every time — PDF, Word, Excel, PNG or JPG, up to 10 MB each."
          : "These go out as attachments every time this email is sent for this school. Changes save straight away."}
        {totalBytes > MAX_EMAIL_ATTACHMENT_BYTES * 0.8 && " You're close to the 25 MB limit for one email."}
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
