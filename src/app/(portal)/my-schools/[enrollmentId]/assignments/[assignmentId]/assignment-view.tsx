"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/ffsa";
import { Loader2, Trash2 } from "lucide-react";
import { AttemptBody } from "@/components/schools/lms/grade-drawer";
import {
  FILE_ACCEPT_ATTR,
  formatBytes,
  formatDue,
  formatPoints,
  MAX_FILE_BYTES,
  type AttemptWithDetail,
  type LmsAssignment,
} from "@/lib/schools/lms-assignments";

// The student's assignment: instructions, a submit form for the allowed
// types (with upload progress), Resubmit after submission or grading, and
// the attempt history with each attempt's released points and feedback.

type Detail = {
  assignment: LmsAssignment & { course_title: string };
  draft: AttemptWithDetail | null;
  attempts: AttemptWithDetail[];
  current_submission_id: string | null;
  can_submit: boolean;
  past_due: boolean;
};

async function call(url: string, method = "GET", body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data, message: (data.message as string) || (data.error as string) || "Something went wrong" };
}

/** PUT the file to the signed upload URL, reporting progress (0..1). */
function putWithProgress(url: string, file: File, onProgress: (p: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.send(file);
  });
}

export function AssignmentView({ enrollmentId, assignmentId }: { enrollmentId: string; assignmentId: string }) {
  const base = `/api/my-schools/${enrollmentId}/lms/assignments/${assignmentId}`;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [uploads, setUploads] = useState<Array<{ name: string; progress: number; failed?: boolean }>>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await call(base);
    if (!r.ok) return setError(r.message);
    const d = r.data as unknown as Detail;
    setDetail(d);
    if (d.draft) {
      setText(d.draft.body_text ?? "");
      setLink(d.draft.link_url ?? "");
    }
    return d;
  }, [base]);

  useEffect(() => {
    void load().then((d) => {
      if (d && (d.draft || d.attempts.length === 0)) setEditing(true);
    });
  }, [load]);

  if (error && !detail) return <p className="px-5 py-6 text-sm text-destructive md:px-8">{error}</p>;
  if (!detail) return <Loader2 className="mx-5 my-6 h-5 w-5 animate-spin md:mx-8" aria-label="Loading" />;

  const { assignment } = detail;
  const types = assignment.submission_types;
  const nextAttempt = (detail.attempts[0]?.attempt_no ?? 0) + 1;
  const draftFiles = detail.draft?.files ?? [];

  async function saveDraft() {
    setBusy(true);
    setError(null);
    const r = await call(`${base}/draft`, "PUT", { body_text: text, link_url: link });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setNotice("Draft saved.");
    await load();
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const r = await call(`${base}/submit`, "POST", { body_text: text, link_url: link });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setNotice(`Attempt ${(r.data.attempt as { attempt_no: number }).attempt_no} handed in.`);
    setEditing(false);
    setText("");
    setLink("");
    await load();
  }

  async function addFiles(files: FileList | null) {
    if (!files) return;
    setError(null);
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_BYTES) {
        setError(`${file.name} is larger than 20 MB.`);
        continue;
      }
      const r = await call(`${base}/files`, "POST", { file_name: file.name, mime: file.type, size_bytes: file.size });
      if (!r.ok) {
        setError(`${file.name}: ${r.message}`);
        continue;
      }
      const signed = (r.data.upload as { signed_url: string }).signed_url;
      setUploads((u) => [...u, { name: file.name, progress: 0 }]);
      const ok = await putWithProgress(signed, file, (p) =>
        setUploads((u) => u.map((x) => (x.name === file.name ? { ...x, progress: p } : x)))
      );
      setUploads((u) => (ok ? u.filter((x) => x.name !== file.name) : u.map((x) => (x.name === file.name ? { ...x, failed: true } : x))));
      if (!ok) setError(`${file.name} did not upload. Remove it and try again.`);
    }
    if (fileInput.current) fileInput.current.value = "";
    await load();
  }

  async function removeFile(fileId: string) {
    setBusy(true);
    const r = await call(`${base}/files/${fileId}`, "DELETE");
    setBusy(false);
    if (!r.ok) return setError(r.message);
    await load();
  }

  async function download(fileId: string) {
    const r = await call(`${base}/files/${fileId}`);
    if (!r.ok) return setError(r.message);
    window.open(r.data.url as string, "_blank", "noopener,noreferrer");
  }

  const current = detail.attempts.find((a) => a.id === detail.current_submission_id) ?? null;

  return (
    <div className="space-y-6 px-5 py-6 md:px-8">
      <header className="space-y-2">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--text-secondary)]">
          {assignment.course_title}
        </p>
        <h2 className="text-xl font-semibold">{assignment.title}</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {detail.past_due ? (
            <StatusPill tone="bad">{detail.can_submit ? "Late" : "Closed"}</StatusPill>
          ) : null}
          <span>Due {formatDue(assignment.due_at)}</span>
          <span>· {Number(assignment.max_points)} points</span>
        </div>
        {assignment.instructions && (
          <div className="whitespace-pre-wrap break-words border border-rule bg-white p-4 text-[15px]">{assignment.instructions}</div>
        )}
      </header>

      {notice && <p className="text-sm text-grass-text" role="status">{notice}</p>}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      {!detail.can_submit ? (
        <p className="border border-destructive px-4 py-3 text-sm">
          This assignment is past its due date and does not accept late work.
        </p>
      ) : editing ? (
        <form
          className="space-y-4 border border-ink bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h3 className="text-base font-semibold">
            {detail.attempts.length > 0 ? `Resubmit (attempt ${nextAttempt})` : "Your work"}
          </h3>
          {detail.past_due && <p className="text-sm text-destructive">Past due — this will be marked Late.</p>}
          {types.includes("text") && (
            <label className="block text-sm font-medium">
              Answer
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} className="mt-1 text-[16px]" />
            </label>
          )}
          {types.includes("link") && (
            <label className="block text-sm font-medium">
              Link
              <Input
                type="url"
                inputMode="url"
                placeholder="https://…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                className="mt-1 h-11 text-[16px]"
              />
            </label>
          )}
          {types.includes("file") && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Files (PDF, images, Word, PowerPoint, text · up to 10, 20 MB each)</p>
              {draftFiles.length > 0 && (
                <ul className="space-y-1">
                  {draftFiles.map((f) => (
                    <li key={f.id} className="flex min-h-11 items-center gap-2 border px-3 text-sm">
                      <span className="min-w-0 flex-1 truncate">{f.file_name}</span>
                      <span className="text-xs text-muted-foreground">{formatBytes(Number(f.size_bytes))}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-11 w-11 p-0"
                        disabled={busy}
                        onClick={() => void removeFile(f.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Remove {f.file_name}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {uploads.map((u) => (
                <div key={u.name} className="space-y-1 text-sm">
                  <span className={u.failed ? "text-destructive" : ""}>
                    {u.name} {u.failed ? "— failed" : `— ${Math.round(u.progress * 100)}%`}
                  </span>
                  <progress value={u.progress} max={1} className="block h-2 w-full" aria-label={`Uploading ${u.name}`} />
                </div>
              ))}
              {draftFiles.length < 10 && (
                <label className="flex min-h-11 cursor-pointer items-center justify-center border border-dashed px-3 text-sm">
                  Add a file
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    accept={FILE_ACCEPT_ATTR}
                    className="sr-only"
                    onChange={(e) => void addFiles(e.target.files)}
                  />
                </label>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="min-h-11" disabled={busy || uploads.some((u) => !u.failed)}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {detail.attempts.length > 0 ? "Hand in again" : "Hand in"}
            </Button>
            <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void saveDraft()}>
              Save draft
            </Button>
            {detail.attempts.length > 0 && !detail.draft && (
              <Button type="button" variant="ghost" className="min-h-11" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3 border border-ink bg-white p-4">
          <p className="flex-1 text-sm">
            {current?.grade
              ? `Graded: ${formatPoints(current.grade.points, assignment.max_points)}`
              : `Attempt ${current?.attempt_no ?? ""} handed in — waiting for a grade.`}
          </p>
          <Button className="min-h-11" onClick={() => setEditing(true)}>
            Resubmit
          </Button>
        </div>
      )}

      {detail.attempts.length > 0 && (
        <section aria-labelledby="history-heading" className="space-y-3">
          <h3 id="history-heading" className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--text-secondary)]">
            Your attempts
          </h3>
          <ol className="space-y-3">
            {detail.attempts.map((a) => (
              <li key={a.id} className="space-y-3 border border-rule bg-white p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">Attempt {a.attempt_no}</span>
                  {a.id === detail.current_submission_id && <StatusPill tone="quiet">Current</StatusPill>}
                  {a.is_late && <StatusPill tone="bad">Late</StatusPill>}
                  <span className="text-[color:var(--text-secondary)]">{formatDue(a.submitted_at)}</span>
                </div>
                <AttemptBody attempt={a} onDownload={(id) => void download(id)} />
                <div className="border-t pt-3 text-sm">
                  {a.grade ? (
                    <>
                      <p className="font-semibold">{formatPoints(a.grade.points, assignment.max_points)}</p>
                      {a.grade.feedback && <p className="mt-1 whitespace-pre-wrap">{a.grade.feedback}</p>}
                    </>
                  ) : (
                    <p className="text-muted-foreground">Not graded yet.</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
