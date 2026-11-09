"use client";

import { useCallback, useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/ffsa";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import {
  formatBytes,
  formatDue,
  formatPoints,
  safeHref,
  type AttemptWithDetail,
} from "@/lib/schools/lms-assignments";

// Grade one student's work: the current attempt's text, link and files, a
// switcher for earlier attempts (read-only, with their grades), points /
// max, feedback, and Save draft / Release. Leaders and program staff alike.

type History = {
  student: { name: string };
  attempts: AttemptWithDetail[];
  current_submission_id: string | null;
};

async function call(url: string, method = "GET", body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data, message: (data.message as string) || (data.error as string) || "Request failed" };
}

export function AttemptBody({
  attempt,
  onDownload,
}: {
  attempt: AttemptWithDetail;
  onDownload: (fileId: string) => void;
}) {
  const href = safeHref(attempt.link_url);
  return (
    <div className="space-y-3">
      {attempt.body_text && (
        <div className="whitespace-pre-wrap break-words border bg-white p-3 text-sm">{attempt.body_text}</div>
      )}
      {attempt.link_url &&
        (href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 break-all text-sm font-medium underline underline-offset-2"
          >
            {href}
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">Link not shown (not http or https).</p>
        ))}
      {attempt.files.length > 0 && (
        <ul className="space-y-1">
          {attempt.files.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onDownload(f.id)}
                className="flex min-h-11 w-full items-center gap-2 border px-3 text-left text-sm"
              >
                <Download className="h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{f.file_name}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(Number(f.size_bytes))}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!attempt.body_text && !attempt.link_url && attempt.files.length === 0 && (
        <p className="text-sm italic text-muted-foreground">Empty attempt.</p>
      )}
    </div>
  );
}

export function GradeDrawer({
  programId,
  assignmentId,
  maxPoints,
  enrollmentId,
  onClose,
  onChanged,
}: {
  programId: string;
  assignmentId: string;
  maxPoints: number;
  enrollmentId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [history, setHistory] = useState<History | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [points, setPoints] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/schools/programs/${programId}/lms`;

  const load = useCallback(async () => {
    if (!enrollmentId) return;
    const r = await call(`${base}/assignments/${assignmentId}/students/${enrollmentId}`);
    if (!r.ok) return setError(r.message);
    const h = r.data as unknown as History;
    setHistory(h);
    setSelectedId((prev) => prev ?? h.current_submission_id);
  }, [base, assignmentId, enrollmentId]);

  useEffect(() => {
    setHistory(null);
    setSelectedId(null);
    setError(null);
    void load();
  }, [load]);

  const selected = history?.attempts.find((a) => a.id === selectedId) ?? null;
  const isCurrent = !!selected && selected.id === history?.current_submission_id;

  useEffect(() => {
    setPoints(selected?.grade ? String(selected.grade.points) : "");
    setFeedback(selected?.grade?.feedback ?? "");
  }, [selected?.id, selected?.grade]);

  async function download(fileId: string) {
    const r = await call(`${base}/files/${fileId}`);
    if (!r.ok) return setError(r.message);
    window.open(r.data.url as string, "_blank", "noopener,noreferrer");
  }

  async function save(release: boolean) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const r = isCurrent
      ? await call(`${base}/submissions/${selected.id}/grade`, "PUT", { points, feedback, release })
      : await call(`${base}/assignments/${assignmentId}/release`, "POST", { submission_id: selected.id });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    await load();
    onChanged();
  }

  const grade = selected?.grade ?? null;

  return (
    <Sheet open={!!enrollmentId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="pr-12">
          <SheetTitle>{history?.student.name ?? "Loading…"}</SheetTitle>
          <SheetDescription>Grade out of {maxPoints}. Students see a grade only after you release it.</SheetDescription>
        </SheetHeader>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        {!history ? (
          <Loader2 className="mt-6 h-5 w-5 animate-spin" aria-label="Loading" />
        ) : (
          <div className="mt-4 space-y-4">
            {history.attempts.length > 1 && (
              <div role="tablist" aria-label="Attempts" className="flex flex-wrap gap-2">
                {history.attempts.map((a) => (
                  <button
                    key={a.id}
                    role="tab"
                    aria-selected={a.id === selectedId}
                    onClick={() => setSelectedId(a.id)}
                    className={`min-h-11 border px-3 text-sm ${a.id === selectedId ? "border-ink bg-ink text-white" : ""}`}
                  >
                    Attempt {a.attempt_no}
                    {a.id === history.current_submission_id ? " (current)" : ""}
                    {a.grade ? ` · ${formatPoints(a.grade.points, maxPoints)}` : ""}
                  </button>
                ))}
              </div>
            )}

            {selected && (
              <>
                <p className="text-xs text-[color:var(--text-secondary)]">
                  Attempt {selected.attempt_no} · handed in {formatDue(selected.submitted_at)}{" "}
                  {selected.is_late && <StatusPill tone="bad">Late</StatusPill>}
                </p>
                <AttemptBody attempt={selected} onDownload={(id) => void download(id)} />

                {isCurrent ? (
                  <form
                    className="space-y-3 border-t pt-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void save(false);
                    }}
                  >
                    <label className="block text-sm font-medium">
                      Points
                      <div className="mt-1 flex items-center gap-2">
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={maxPoints}
                          step="any"
                          value={points}
                          onChange={(e) => setPoints(e.target.value)}
                          className="h-11 w-28"
                          required
                        />
                        <span className="text-sm">/ {maxPoints}</span>
                      </div>
                    </label>
                    <label className="block text-sm font-medium">
                      Feedback
                      <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={5} className="mt-1" />
                    </label>
                    {grade?.released_at && (
                      <p className="text-xs text-[color:var(--text-secondary)]">
                        Released {formatDue(grade.released_at)}. Saving updates what the student sees.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" variant="outline" className="min-h-11" disabled={busy || points === ""}>
                        {grade?.released_at ? "Save" : "Save draft"}
                      </Button>
                      {!grade?.released_at && (
                        <Button type="button" className="min-h-11" disabled={busy || points === ""} onClick={() => void save(true)}>
                          Release to student
                        </Button>
                      )}
                    </div>
                  </form>
                ) : (
                  <div className="space-y-2 border-t pt-4 text-sm">
                    <p className="font-medium">Earlier attempt — its grade can no longer change.</p>
                    {grade ? (
                      <>
                        <p>
                          {formatPoints(grade.points, maxPoints)} ·{" "}
                          {grade.released_at ? `released ${formatDue(grade.released_at)}` : "not released"}
                        </p>
                        {grade.feedback && <p className="whitespace-pre-wrap">{grade.feedback}</p>}
                        {!grade.released_at && (
                          <Button className="min-h-11" disabled={busy} onClick={() => void save(true)}>
                            Release this grade
                          </Button>
                        )}
                      </>
                    ) : (
                      <p className="text-muted-foreground">Not graded.</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
