"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill } from "@/components/ffsa";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils/cn";
import {
  Button,
  DrawerSection,
  ErrorLine,
  Field,
  History,
  Select,
  TEXT_RESET,
  TextArea,
  TextInput,
  callApi,
  formatDate,
  inputClass,
  type AppRow,
  type DocRow,
  type FolderRow,
} from "./legal-ui";
import { openScan } from "./scan-review";

// ────────────────────────────────────────────────────────────
// SHAPES
// ────────────────────────────────────────────────────────────

export type DraftField = { label: string; value: string; source: string; missing: boolean };
export type DraftRow = {
  id: string;
  folder_id: string;
  document_id: string | null;
  application_id: string | null;
  title: string;
  kind: "letter" | "form" | "other";
  body: string;
  fields: DraftField[];
  notes_for_approver: string | null;
  status: "awaiting_approval" | "sent_back" | "approved";
  sent_back_note: string | null;
  created_via: "helper" | "person";
  final_file_id: string | null;
  approved_at: string | null;
  updated_at: string;
};

export const DRAFT_STATUS: Record<DraftRow["status"], { label: string; tone: "warn" | "bad" | "good" }> = {
  awaiting_approval: { label: "Waiting for approval", tone: "warn" },
  sent_back: { label: "Sent back", tone: "bad" },
  approved: { label: "Approved", tone: "good" },
};

// ────────────────────────────────────────────────────────────
// ONE DRAFT — read, edit, approve or send back
// ────────────────────────────────────────────────────────────

export function DraftPanel({
  draft,
  folders,
  documents,
  applications,
  isOwner,
  onOpenDocument,
}: {
  draft: DraftRow;
  folders: FolderRow[];
  documents: DocRow[];
  applications: AppRow[];
  isOwner: boolean;
  onOpenDocument: (id: string) => void;
}) {
  const router = useRouter();
  const approved = draft.status === "approved";
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const [fields, setFields] = useState<DraftField[]>(draft.fields ?? []);
  const [folderId, setFolderId] = useState(draft.folder_id);
  const [documentId, setDocumentId] = useState(draft.document_id ?? "");
  const [sendBack, setSendBack] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [version, setVersion] = useState(0);

  const draftId = draft.id;
  useEffect(() => {
    setTitle(draft.title);
    setBody(draft.body);
    setFields(draft.fields ?? []);
    setFolderId(draft.folder_id);
    setDocumentId(draft.document_id ?? "");
    setError(null);
    setSaved(false);
    // Reset only when another draft opens: the page refreshes every 10 s.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, draft.status]);

  const dirty =
    title !== draft.title ||
    body !== draft.body ||
    JSON.stringify(fields) !== JSON.stringify(draft.fields ?? []) ||
    folderId !== draft.folder_id ||
    documentId !== (draft.document_id ?? "");
  const missing = fields.filter((f) => f.missing || !f.value.trim()).length + (body.match(/\[MISSING[^\]]*\]/g)?.length ?? 0);
  const folder = folders.find((f) => f.id === folderId);
  const doc = documents.find((d) => d.id === documentId);
  const app = applications.find((a) => a.id === draft.application_id);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      setVersion((v) => v + 1);
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run("save", async () => {
      await callApi("PATCH", `/api/legal/drafts/${draft.id}`, {
        title,
        body,
        fields,
        folder_id: folderId,
        document_id: documentId || null,
      });
      setSaved(true);
    });

  async function approve() {
    if (dirty) {
      setError("Save your changes first, then approve what you saved.");
      return;
    }
    const what = missing
      ? `${missing} ${missing === 1 ? "detail is" : "details are"} still missing. Approve anyway? The PDF will show them as missing.`
      : `Approve "${draft.title}" and save it as a PDF in ${folder?.name}${doc ? ` under ${doc.title}` : ""}? It can't be changed afterwards.`;
    if (!window.confirm(what)) return;
    await run("approve", () => callApi("POST", `/api/legal/drafts/${draft.id}/approve`));
  }

  const status = DRAFT_STATUS[draft.status];

  return (
    <>
      <div className="border-b border-ink bg-bone px-5 py-5 sm:px-6">
        <div className="mono-label mb-2">
          Draft · {draft.kind === "form" ? "form" : draft.kind === "letter" ? "letter" : "document"}
          {draft.created_via === "helper" ? " · by the legal helper" : ""}
        </div>
        <h2 className="break-words font-display text-[26px] font-black uppercase leading-[0.95]">{draft.title}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
          <span className="font-mono text-[11px] tracking-[0.06em] text-[color:var(--text-secondary)]">
            {approved ? `Approved ${formatDate(draft.approved_at?.slice(0, 10) ?? null)}` : `Saved ${formatDate(draft.updated_at.slice(0, 10))}`}
          </span>
        </div>
        <p className={cn("mt-3 text-[13px] text-[color:var(--text-secondary)]", TEXT_RESET)}>
          Files to <strong className="text-ink">{folder?.name}</strong>
          {doc ? (
            <>
              {" "}under{" "}
              <button type="button" onClick={() => onOpenDocument(doc.id)} className="!font-sans !font-semibold normal-case tracking-normal text-ink underline">
                {doc.title}
              </button>
            </>
          ) : null}
          {app ? ` · for ${app.title}` : ""}
        </p>
        {approved && draft.final_file_id && (
          <div className="mt-4">
            <Button tone="outline" onClick={() => openScan(draft.final_file_id!).catch((e) => setError(e.message))}>
              Open the approved PDF
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="px-5 pt-4 sm:px-6">
          <ErrorLine message={error} />
        </div>
      )}

      {draft.status === "sent_back" && draft.sent_back_note && (
        <DrawerSection title="Sent back">
          <p className="border-l-2 border-destructive bg-[#FBEDEC] px-4 py-3 text-[14px]">{draft.sent_back_note}</p>
          <p className="mt-2 text-[12.5px] text-[color:var(--text-secondary)]">
            Ask the legal helper to fix it, or edit it below and save.
          </p>
        </DrawerSection>
      )}

      {draft.notes_for_approver && !approved && (
        <DrawerSection title="Check before approving">
          <div className="border-l-2 border-amber-border bg-[#FBF5E3] px-4 py-3 text-[13.5px]">
            <Markdown source={draft.notes_for_approver} />
          </div>
          {missing > 0 && (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-destructive">
              {missing} {missing === 1 ? "detail" : "details"} missing
            </p>
          )}
        </DrawerSection>
      )}

      <DrawerSection title={approved ? "Approved text" : "The draft"}>
        <div className="grid grid-cols-1 gap-4">
          {!approved && (
            <Field label="Title">
              <TextInput value={title} onChange={(v) => { setTitle(v); setSaved(false); }} maxLength={200} />
            </Field>
          )}
          {(body || !approved) && (
            <Field label={draft.kind === "form" ? "Covering note" : "Text"}>
              {approved ? (
                <div className={cn("whitespace-pre-wrap border border-rule bg-white px-3 py-2 text-[14px]", TEXT_RESET)}>{body}</div>
              ) : (
                <TextArea value={body} onChange={(v) => { setBody(v); setSaved(false); }} rows={draft.kind === "form" ? 4 : 14} />
              )}
            </Field>
          )}
        </div>
      </DrawerSection>

      {fields.length > 0 && (
        <DrawerSection title="Form fields" meta={`${fields.length}`}>
          <ul className="border-t border-rule">
            {fields.map((f, i) => {
              const isMissing = f.missing || !f.value.trim();
              return (
                <li key={i} className="border-b border-rule py-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="mono-label">{f.label}</span>
                    {isMissing && <StatusPill tone="bad">Missing</StatusPill>}
                  </div>
                  {approved ? (
                    <p className="text-[14px]">{f.value || "—"}</p>
                  ) : (
                    <input
                      aria-label={f.label}
                      value={f.value}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSaved(false);
                        setFields((all) => all.map((x, j) => (j === i ? { ...x, value: v, missing: !v.trim() } : x)));
                      }}
                      className={inputClass}
                    />
                  )}
                  {f.source && f.source !== "missing" && (
                    <p className="mt-1 font-mono text-[10px] tracking-[0.06em] text-[color:var(--text-tertiary)]">From: {f.source}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </DrawerSection>
      )}

      {!approved && (
        <DrawerSection title="Where it is filed">
          <div className="grid grid-cols-1 gap-4">
            <Field label="Folder">
              <Select value={folderId} onChange={(v) => { setFolderId(v); setDocumentId(""); setSaved(false); }}>
                {folders.filter((f) => !f.archived_at || f.id === folderId).map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Under document">
              <Select value={documentId} onChange={(v) => { setDocumentId(v); setSaved(false); }}>
                <option value="">Not under a document</option>
                {documents.filter((d) => d.folder_id === folderId).map((d) => (
                  <option key={d.id} value={d.id}>{d.title}</option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button tone="outline" onClick={save} disabled={!!busy || !dirty || !title.trim()}>
              {busy === "save" ? "Saving…" : "Save changes"}
            </Button>
            {saved && <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-grass-text">Saved</span>}
          </div>
        </DrawerSection>
      )}

      {!approved && (
        <DrawerSection title="Approval">
          {isOwner ? (
            <>
              <p className="mb-3 text-[13px] text-[color:var(--text-secondary)]">
                Approving saves this as a PDF in {folder?.name}
                {doc ? ` under ${doc.title}` : ""}. It can&apos;t be changed afterwards.
              </p>
              <Button onClick={approve} disabled={!!busy}>
                {busy === "approve" ? "Approving…" : "Approve and save as PDF"}
              </Button>
              <div className="mt-5">
                <Field label="Or send it back with a note">
                  <TextArea value={sendBack} onChange={setSendBack} rows={2} />
                </Field>
                <div className="mt-2">
                  <Button
                    tone="outline"
                    disabled={!!busy || !sendBack.trim()}
                    onClick={async () => {
                      if (await run("back", () => callApi("PATCH", `/api/legal/drafts/${draft.id}`, { send_back: sendBack.trim() }))) setSendBack("");
                    }}
                  >
                    Send back
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <p className="text-[13px] text-[color:var(--text-secondary)]">
              Only the legal officer can approve or send back a draft. It is waiting in their Drafts tab.
            </p>
          )}
          <div className="mt-6 border-t border-rule pt-4">
            <Button
              tone="danger"
              disabled={!!busy}
              onClick={() => {
                if (window.confirm(`Throw away "${draft.title}"? This can't be undone.`)) {
                  run("delete", () => callApi("DELETE", `/api/legal/drafts/${draft.id}`));
                }
              }}
            >
              Throw away
            </Button>
          </div>
        </DrawerSection>
      )}

      <DrawerSection title="History">
        <History table="legal_drafts" id={draft.id} version={version} />
      </DrawerSection>
    </>
  );
}
