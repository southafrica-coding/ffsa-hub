"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Drawer,
  Kpi,
  KpiStrip,
  Masthead,
  MastheadButton,
  ModuleTabs,
  NeedsYou,
  SectionBar,
  StatusPill,
} from "@/components/ffsa";
import { cn } from "@/lib/utils/cn";
import {
  APPLICATION_STATE_LABEL,
  ATTENTION_STATES,
  DOCUMENT_STATE_LABEL,
  applicationState,
  describeDays,
  documentState,
  isApplicationOpen,
  type ApplicationState,
  type DocumentStateResult,
} from "@/lib/legal/status";
import {
  APPLICATION_STATUS_LABEL,
  APPLICATION_TONE,
  DOCUMENT_TONE,
  FOLDER_KIND_LABEL,
  formatDate,
  type AppRow,
  type DocRow,
  type FileRow,
  type FolderRow,
  type Person,
  type TypeRow,
  UrgencyKey,
  urgencyEdge,
} from "./legal-ui";
import { documentUrgency, lodgeUrgency } from "@/lib/legal/reminders";
import { daysBetween } from "@/lib/legal/status";
import { DocumentPanel } from "./document-drawer";
import { ApplicationPanel, type NewApplicationSeed } from "./application-drawer";
import { FolderPanel } from "./folder-drawer";
import { ScanInPanel, ScanReviewPanel } from "./scan-review";
import { DRAFT_STATUS, DraftPanel, type DraftRow } from "./drafts";
import { HelperPanel, TaskList, type HelperMessage } from "./helper-panel";
import { useSpeaker } from "./use-voice";
import type { TaskRow } from "@/lib/legal/helper/task-state";

type Tab = "attention" | "documents" | "applications" | "drafts" | "folders";

type Open =
  | { kind: "document"; id: string | null; folderId?: string }
  | { kind: "application"; id: string | null; seed?: NewApplicationSeed }
  | { kind: "folder"; id: string | null }
  | { kind: "scan"; id: string }
  | { kind: "scan-in" }
  | { kind: "draft"; id: string }
  | { kind: "helper" }
  | null;

type DocView = DocRow & DocumentStateResult & { folderName: string };

const PRESSING_APPLICATION: ApplicationState[] = ["late", "due_soon", "overdue"];

/** An application's colour: lodge-by while not lodged; red once past the expected date. */
function appUrgency(a: AppRow & { state: ApplicationState }, today: string) {
  if (a.state === "closed") return null;
  if (["planned", "gathering"].includes(a.status)) return a.lodge_by ? lodgeUrgency(daysBetween(today, a.lodge_by)) : null;
  return a.state === "overdue" ? "red" : null;
}

export function DocumentsView({
  folders,
  types,
  documents,
  files,
  applications,
  people,
  drafts,
  tasks,
  isOwner,
  initialDraftId,
  today,
}: {
  folders: FolderRow[];
  types: TypeRow[];
  documents: DocRow[];
  files: FileRow[];
  applications: AppRow[];
  people: Person[];
  drafts: DraftRow[];
  tasks: TaskRow[];
  isOwner: boolean;
  initialDraftId: string | null;
  today: string;
}) {
  const [tab, setTab] = useState<Tab>(initialDraftId ? "drafts" : "attention");
  const [folderFilter, setFolderFilter] = useState<string>("");
  const [showReplaced, setShowReplaced] = useState(false);
  const [open, setOpen] = useState<Open>(initialDraftId ? { kind: "draft", id: initialDraftId } : null);
  // The helper chat lives here so closing the drawer doesn't lose it.
  const [helperMessages, setHelperMessages] = useState<HelperMessage[]>([]);
  // Voice lives here too, so a finished background task can be announced
  // even with the helper closed.
  const speaker = useSpeaker();
  const [readAloud, setReadAloud] = useState(false);
  const seenDone = useRef<Set<string> | null>(null);
  useEffect(() => {
    const done = tasks.filter((t) => t.status === "done" || t.status === "failed");
    if (seenDone.current === null) {
      seenDone.current = new Set(done.map((t) => t.id)); // don't announce what was already finished
      return;
    }
    const fresh = done.filter((t) => !seenDone.current!.has(t.id));
    fresh.forEach((t) => seenDone.current!.add(t.id));
    if (fresh.length && readAloud) {
      speaker.speak(
        fresh
          .map((t) => (t.status === "done" ? `${t.title} is done. It's waiting in Drafts.` : `${t.title} didn't finish.`))
          .join(" ")
      );
    }
  }, [tasks, readAloud, speaker]);

  const folderName = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders]);
  const liveFolders = folders.filter((f) => !f.archived_at);
  const defaultFolderId = folderFilter || liveFolders[0]?.id || folders[0]?.id || "";

  // Every document's state, worked out once with the tested rules.
  const docs: DocView[] = useMemo(() => {
    const openFor = new Set(applications.filter((a) => isApplicationOpen(a.status) && a.document_id).map((a) => a.document_id));
    const lead = new Map(types.map((t) => [t.id, t.lead_days]));
    return documents.map((d) => ({
      ...d,
      ...documentState(
        { ...d, type_lead_days: d.type_id ? lead.get(d.type_id) ?? null : null, has_open_application: openFor.has(d.id) },
        today
      ),
      folderName: folderName.get(d.folder_id) ?? "",
    }));
  }, [documents, applications, types, today, folderName]);

  const apps = useMemo(
    () => applications.map((a) => ({ ...a, state: applicationState(a, today), folderName: folderName.get(a.folder_id) ?? "" })),
    [applications, today, folderName]
  );

  const inFolder = <T extends { folder_id: string }>(rows: T[]) => (folderFilter ? rows.filter((r) => r.folder_id === folderFilter) : rows);

  const attentionDocs = inFolder(docs)
    .filter((d) => ATTENTION_STATES.includes(d.state))
    .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));
  const pressingApps = inFolder(apps).filter((a) => PRESSING_APPLICATION.includes(a.state));
  // Approved drafts' PDFs are filed by the draft, not waiting to be matched.
  const finalFiles = new Set(drafts.map((d) => d.final_file_id).filter(Boolean));
  const unmatched = inFolder(files).filter((f) => !f.document_id && !finalFiles.has(f.id));
  const waitingDrafts = drafts.filter((d) => d.status === "awaiting_approval").length;

  const expired = docs.filter((d) => d.state === "expired").length;
  const renewNow = docs.filter((d) => d.state === "expiring").length;
  const openApps = apps.filter((a) => a.state !== "closed").length;
  const allUnmatched = files.filter((f) => !f.document_id && !finalFiles.has(f.id)).length;

  // The band says only what the data says (CLAUDE.md "Never invent a signal").
  const band = [
    expired ? `${expired} ${expired === 1 ? "document has" : "documents have"} expired` : null,
    renewNow ? `${renewNow} ${renewNow === 1 ? "needs" : "need"} renewing now` : null,
    isOwner && waitingDrafts
      ? `${waitingDrafts} ${waitingDrafts === 1 ? "draft is" : "drafts are"} waiting for your approval`
      : null,
  ].filter(Boolean);

  // ── drawer lookups ──
  const openDoc = open?.kind === "document" && open.id ? documents.find((d) => d.id === open.id) ?? null : null;
  const openApp = open?.kind === "application" && open.id ? applications.find((a) => a.id === open.id) ?? null : null;
  const openFolder = open?.kind === "folder" && open.id ? folders.find((f) => f.id === open.id) ?? null : null;
  const openFile = open?.kind === "scan" ? files.find((f) => f.id === open.id) ?? null : null;
  const reviewFile = (id: string) => setOpen({ kind: "scan", id });
  const openDraft = open?.kind === "draft" ? drafts.find((d) => d.id === open.id) ?? null : null;
  const showDraft = (id: string) => setOpen({ kind: "draft", id });
  const drawerLabel =
    open?.kind === "document" ? (open.id ? "DOCUMENT" : "NEW DOCUMENT")
    : open?.kind === "application" ? (open.id ? "APPLICATION" : "NEW APPLICATION")
    : open?.kind === "folder" ? (open.id ? "FOLDER" : "NEW FOLDER")
    : open?.kind === "scan" ? "SCAN"
    : open?.kind === "scan-in" ? "SCAN IN"
    : open?.kind === "draft" ? "DRAFT"
    : open?.kind === "helper" ? "LEGAL HELPER"
    : "";

  const startApplication = (doc: DocRow) =>
    setOpen({
      kind: "application",
      id: null,
      seed: { folderId: doc.folder_id, documentId: doc.id, title: `Renew: ${doc.title}` },
    });

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Legal · FFSA and personal papers"
        title="Documents"
        actions={
          <>
            <MastheadButton tone="outline" onClick={() => setOpen({ kind: "folder", id: null })}>New folder</MastheadButton>
            <MastheadButton tone="outline" onClick={() => setOpen({ kind: "application", id: null })}>New application</MastheadButton>
            <MastheadButton tone="outline" onClick={() => setOpen({ kind: "scan-in" })}>Scan in</MastheadButton>
            <MastheadButton tone="outline" onClick={() => setOpen({ kind: "document", id: null })}>Add document</MastheadButton>
            <MastheadButton onClick={() => setOpen({ kind: "helper" })}>Ask the helper</MastheadButton>
          </>
        }
      />

      {band.length > 0 && <NeedsYou>{band.join(", and ")}.</NeedsYou>}

      <KpiStrip>
        <Kpi label="Expired" value={String(expired)} valueColor={expired ? "hsl(var(--destructive))" : undefined} tick={false} />
        <Kpi label="Renew now" value={String(renewNow)} tick={false} />
        <Kpi label="Applications open" value={String(openApps)} tick={false} />
        <Kpi label="Scans to match" value={String(allUnmatched)} tick={false} />
      </KpiStrip>

      <ModuleTabs
        tabs={[
          { key: "attention", label: "Needs attention", mark: attentionDocs.length + pressingApps.length > 0 },
          { key: "documents", label: "Documents" },
          { key: "applications", label: "Applications" },
          { key: "drafts", label: "Drafts", mark: isOwner && waitingDrafts > 0 },
          { key: "folders", label: "Folders" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as Tab)}
        trailing={
          tab !== "folders" && tab !== "drafts" && (
            <select
              aria-label="Folder"
              value={folderFilter}
              onChange={(e) => setFolderFilter(e.target.value)}
              className="block min-h-11 max-w-[220px]"
            >
              <option value="">All folders</option>
              {liveFolders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )
        }
      />

      <div className="px-0 pb-10 md:px-8 md:pt-6">
        {tab === "attention" && (
          <div className="space-y-6">
            <div>
              <SectionBar title="Documents" meta={`${attentionDocs.length}`} />
              {attentionDocs.length === 0 ? (
                <Empty>Nothing has expired or needs renewing{folderFilter ? " in this folder" : ""}.</Empty>
              ) : (
                <DocList rows={attentionDocs} onOpen={(id) => setOpen({ kind: "document", id })} />
              )}
            </div>
            {pressingApps.length > 0 && (
              <div>
                <SectionBar title="Applications" meta={`${pressingApps.length}`} />
                <AppList rows={pressingApps} people={people} today={today} onOpen={(id) => setOpen({ kind: "application", id })} />
              </div>
            )}
            {unmatched.length > 0 && (
              <div>
                <SectionBar title="Scans to match" meta={`${unmatched.length}`} />
                <ul>
                  {unmatched.map((f) => (
                    <li key={f.id}>
                      <RowButton onClick={() => reviewFile(f.id)}>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold">
                            {f.extracted_fields?.document_kind || f.original_name || "Scan"}
                          </span>
                          <span className="block truncate font-mono text-[10px] tracking-[0.06em] text-[color:var(--text-tertiary)]">
                            {folderName.get(f.folder_id)}
                            {f.extracted_fields?.document_kind && f.original_name ? ` · ${f.original_name}` : ""}
                          </span>
                        </span>
                        <StatusPill tone={f.extraction_status === "failed" ? "bad" : f.extraction_status === "done" ? "warn" : "quiet"}>
                          {f.extraction_status === "done" ? "Review" : f.extraction_status === "failed" ? "Not read" : f.extraction_status === "pending" ? "Reading…" : "Not read yet"}
                        </StatusPill>
                      </RowButton>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === "attention" && (
          <p className="px-5 pt-6 text-[13px] text-[color:var(--text-secondary)] md:px-0">
            At 07:00 the owner is emailed when something hits 90, 60, 30 or 7 days and on the day; expired papers
            every Monday, Wednesday and Friday; on other days, the next five coming up. The email is switched off
            until it is activated.{" "}
            <a href="/api/legal/reminder-preview" target="_blank" rel="noreferrer" className="font-semibold text-ink underline">
              Preview today&apos;s email
            </a>
            <span className="mt-3 block">
              <UrgencyKey />
            </span>
          </p>
        )}

        {tab === "documents" && (
          <div>
            <SectionBar
              title="All documents"
              meta={
                <button type="button" className="min-h-11 uppercase underline" onClick={() => setShowReplaced((v) => !v)}>
                  {showReplaced ? "Hide replaced" : "Show replaced"}
                </button>
              }
            />
            {(() => {
              const rows = inFolder(docs)
                .filter((d) => showReplaced || d.state !== "inactive")
                .sort((a, b) => a.folderName.localeCompare(b.folderName) || a.title.localeCompare(b.title));
              return rows.length === 0 ? (
                <Empty>No documents yet. Add one, or scan papers into a folder.</Empty>
              ) : (
                <DocList rows={rows} showFolder onOpen={(id) => setOpen({ kind: "document", id })} />
              );
            })()}
          </div>
        )}

        {tab === "applications" && (
          <div>
            <SectionBar title="Applications" meta={`${inFolder(apps).filter((a) => a.state !== "closed").length} open`} />
            {inFolder(apps).length === 0 ? (
              <Empty>Nothing is being applied for.</Empty>
            ) : (
              <AppList
                rows={[...inFolder(apps)].sort(
                  (a, b) =>
                    Number(a.state === "closed") - Number(b.state === "closed") ||
                    (a.lodge_by ?? "9999").localeCompare(b.lodge_by ?? "9999")
                )}
                people={people}
                today={today}
                onOpen={(id) => setOpen({ kind: "application", id })}
              />
            )}
          </div>
        )}

        {tab === "drafts" && tasks.length > 0 && (
          <div className="mb-6">
            <SectionBar title="Helper tasks" meta={`${tasks.filter((t) => t.status === "running" || t.status === "queued").length} working`} />
            <div className="px-5 md:px-0">
              <TaskList tasks={tasks} onOpenDraft={showDraft} />
            </div>
          </div>
        )}

        {tab === "drafts" && (
          <div>
            <SectionBar title="Drafts" meta={`${waitingDrafts} waiting for approval`} />
            {drafts.length === 0 ? (
              <Empty>No drafts yet. Ask the helper to fill out a form or draft a letter.</Empty>
            ) : (
              <ul>
                {drafts.map((d) => (
                  <li key={d.id}>
                    <RowButton onClick={() => showDraft(d.id)}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{d.title}</span>
                        <span className="block truncate font-mono text-[10px] tracking-[0.06em] text-[color:var(--text-tertiary)]">
                          {folderName.get(d.folder_id)} · {d.kind} · {formatDate(d.updated_at.slice(0, 10))}
                        </span>
                      </span>
                      <StatusPill tone={DRAFT_STATUS[d.status].tone}>{DRAFT_STATUS[d.status].label}</StatusPill>
                    </RowButton>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === "folders" && (
          <div>
            <SectionBar title="Folders" meta={`${liveFolders.length}`} />
            <ul>
              {[...folders]
                .sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at))
                .map((f) => {
                  const n = docs.filter((d) => d.folder_id === f.id && d.state !== "inactive").length;
                  const flagged = docs.filter((d) => d.folder_id === f.id && ATTENTION_STATES.includes(d.state)).length;
                  return (
                    <li key={f.id}>
                      <RowButton onClick={() => setOpen({ kind: "folder", id: f.id })}>
                        <span className="min-w-0 flex-1">
                          <span className={cn("block truncate text-[15px] font-semibold", f.archived_at && "text-[color:var(--text-tertiary)]")}>
                            {f.name}
                          </span>
                          <span className="block font-mono text-[10px] uppercase tracking-[0.1em] text-[color:var(--text-tertiary)]">
                            {FOLDER_KIND_LABEL[f.kind]}
                            {f.archived_at ? " · archived" : ""} · {n} {n === 1 ? "document" : "documents"}
                          </span>
                        </span>
                        {flagged > 0 && <StatusPill tone="warn">{flagged} to act on</StatusPill>}
                      </RowButton>
                    </li>
                  );
                })}
            </ul>
          </div>
        )}
      </div>

      <Drawer open={!!open} onClose={() => setOpen(null)} label={drawerLabel}>
        {open?.kind === "document" && (
          <DocumentPanel
            key={open.id ?? "new"}
            doc={openDoc}
            defaultFolderId={open.folderId ?? defaultFolderId}
            folders={folders}
            types={types}
            documents={documents}
            files={files}
            applications={applications}
            today={today}
            onCreated={(id) => setOpen({ kind: "document", id })}
            onOpenApplication={(id) => setOpen({ kind: "application", id })}
            onStartApplication={startApplication}
            onReviewFile={reviewFile}
          />
        )}
        {open?.kind === "application" && (
          <ApplicationPanel
            key={open.id ?? "new"}
            app={openApp}
            seed={open.seed ?? { folderId: defaultFolderId }}
            folders={folders}
            documents={documents}
            people={people}
            today={today}
            onCreated={(id) => setOpen({ kind: "application", id })}
            onOpenDocument={(id) => setOpen({ kind: "document", id })}
          />
        )}
        {open?.kind === "folder" && (
          <FolderPanel
            key={open.id ?? "new"}
            folder={openFolder}
            documents={documents}
            files={files}
            onCreated={(id) => setOpen({ kind: "folder", id })}
            onReviewFile={reviewFile}
          />
        )}
        {open?.kind === "scan" && openFile && (
          <ScanReviewPanel
            key={openFile.id}
            file={openFile}
            folders={folders}
            types={types}
            documents={documents}
            onApplied={(id) => setOpen({ kind: "document", id })}
          />
        )}
        {open?.kind === "scan" && !openFile && (
          <p className="px-6 py-6 text-[14px] text-[color:var(--text-secondary)]">Loading the scan…</p>
        )}
        {open?.kind === "draft" && openDraft && (
          <DraftPanel
            key={openDraft.id}
            draft={openDraft}
            folders={folders}
            documents={documents}
            applications={applications}
            isOwner={isOwner}
            onOpenDocument={(id) => setOpen({ kind: "document", id })}
          />
        )}
        {open?.kind === "draft" && !openDraft && (
          <p className="px-6 py-6 text-[14px] text-[color:var(--text-secondary)]">That draft isn&apos;t here any more.</p>
        )}
        {open?.kind === "helper" && (
          <HelperPanel
            messages={helperMessages}
            setMessages={setHelperMessages}
            tasks={tasks}
            onOpenDraft={showDraft}
            speaker={speaker}
            readAloud={readAloud}
            setReadAloud={setReadAloud}
          />
        )}
        {open?.kind === "scan-in" && (
          <ScanInPanel folders={folders} defaultFolderId={defaultFolderId} onReview={reviewFile} />
        )}
      </Drawer>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// LISTS — two-line rows on phones, a table-like grid from md
// ────────────────────────────────────────────────────────────

function RowButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="!font-sans !font-normal normal-case tracking-normal flex min-h-[56px] w-full items-center gap-3 border-b border-rule bg-white px-5 py-3 text-left hover:bg-bone md:px-5"
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="border-b border-rule px-5 py-6 text-[14px] text-[color:var(--text-secondary)]">{children}</p>;
}

function DocList({ rows, showFolder, onOpen }: { rows: DocView[]; showFolder?: boolean; onOpen: (id: string) => void }) {
  return (
    <ul>
      <li className="hidden grid-cols-[minmax(0,1fr)_160px_150px_150px] gap-4 border-b border-ink px-5 py-2 md:grid">
        <span className="mono-label">Document</span>
        <span className="mono-label">{showFolder ? "Folder" : "Holder"}</span>
        <span className="mono-label">Expires</span>
        <span className="mono-label">State</span>
      </li>
      {rows.map((d) => (
        <li key={d.id}>
          <button
            type="button"
            onClick={() => onOpen(d.id)}
            style={urgencyEdge(d.state === "inactive" ? null : documentUrgency(d.daysLeft))}
            className="!font-sans !font-normal normal-case tracking-normal block w-full border-b border-rule bg-white px-5 py-3 text-left hover:bg-bone md:grid md:grid-cols-[minmax(0,1fr)_160px_150px_150px] md:items-center md:gap-4"
          >
            <span className="flex items-start justify-between gap-3 md:block">
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold">{d.title}</span>
                <span className="block truncate font-mono text-[10px] tracking-[0.06em] text-[color:var(--text-tertiary)] md:hidden">
                  {d.folderName} · {d.state === "inactive" ? "replaced" : d.state === "missing" ? "needed" : describeDays(d.daysLeft)}
                </span>
              </span>
              <span className="shrink-0 md:hidden">
                <StatusPill tone={DOCUMENT_TONE[d.state]}>{DOCUMENT_STATE_LABEL[d.state]}</StatusPill>
              </span>
            </span>
            <span className="hidden truncate text-[13px] text-[color:var(--text-secondary)] md:block">
              {showFolder ? d.folderName : d.holder || "—"}
            </span>
            <span className="hidden md:block">
              <span className="block font-mono text-[12px] tabular-nums">{formatDate(d.expires_on)}</span>
              {d.expires_on && d.state !== "inactive" && (
                <span className="block font-mono text-[10px] tracking-[0.06em] text-[color:var(--text-tertiary)]">
                  {describeDays(d.daysLeft)}
                </span>
              )}
            </span>
            <span className="hidden md:block">
              <StatusPill tone={DOCUMENT_TONE[d.state]}>{DOCUMENT_STATE_LABEL[d.state]}</StatusPill>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function AppList({
  rows,
  people,
  today,
  onOpen,
}: {
  rows: Array<AppRow & { state: ApplicationState; folderName: string }>;
  people: Person[];
  today: string;
  onOpen: (id: string) => void;
}) {
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  return (
    <ul>
      <li className="hidden grid-cols-[minmax(0,1fr)_140px_130px_120px_150px] gap-4 border-b border-ink px-5 py-2 md:grid">
        <span className="mono-label">Application</span>
        <span className="mono-label">Stage</span>
        <span className="mono-label">Lodge by</span>
        <span className="mono-label">Checklist</span>
        <span className="mono-label">State</span>
      </li>
      {rows.map((a) => {
        const done = a.steps.filter((s) => s.done_at).length;
        return (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onOpen(a.id)}
              style={urgencyEdge(appUrgency(a, today))}
              className="!font-sans !font-normal normal-case tracking-normal block w-full border-b border-rule bg-white px-5 py-3 text-left hover:bg-bone md:grid md:grid-cols-[minmax(0,1fr)_140px_130px_120px_150px] md:items-center md:gap-4"
            >
              <span className="flex items-start justify-between gap-3 md:block">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold">{a.title}</span>
                  <span className="block truncate font-mono text-[10px] tracking-[0.06em] text-[color:var(--text-tertiary)]">
                    {a.folderName}
                    {a.responsible_id && nameOf.get(a.responsible_id) ? ` · ${nameOf.get(a.responsible_id)}` : ""}
                    <span className="md:hidden">
                      {a.lodge_by && !a.submitted_on ? ` · lodge by ${formatDate(a.lodge_by)}` : ""}
                      {a.steps.length ? ` · ${done}/${a.steps.length}` : ""}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 md:hidden">
                  <StatusPill tone={APPLICATION_TONE[a.state]}>{APPLICATION_STATE_LABEL[a.state]}</StatusPill>
                </span>
              </span>
              <span className="hidden text-[13px] text-[color:var(--text-secondary)] md:block">{APPLICATION_STATUS_LABEL[a.status]}</span>
              <span className="hidden font-mono text-[12px] tabular-nums md:block">{formatDate(a.lodge_by)}</span>
              <span className="hidden font-mono text-[12px] tabular-nums md:block">
                {a.steps.length ? `${done} of ${a.steps.length}` : "—"}
              </span>
              <span className="hidden md:block">
                <StatusPill tone={APPLICATION_TONE[a.state]}>{APPLICATION_STATE_LABEL[a.state]}</StatusPill>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
