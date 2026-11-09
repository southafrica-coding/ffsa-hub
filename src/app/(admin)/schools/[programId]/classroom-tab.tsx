"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/ffsa";
import { ArrowDown, ArrowUp, Check, ChevronLeft, ExternalLink, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  lessonDraftReady,
  lessonEditPayload,
  moveId,
  type LmsContentType,
  type LmsCourse,
  type LmsCourseTree,
  type LmsLesson,
} from "@/lib/schools/lms-content";
import { AssignmentsSection } from "@/components/schools/lms/assignments-section";

// Classroom (LMS slice 1): courses → modules → lessons for this school.
// Leaders and managers only — ProgramDetail hides the tab for everyone else,
// and staff-scoped viewers never reach ProgramDetail. Not the Courses tab
// (billing phases, billing_courses).

type Kind = "course" | "module" | "lesson";

async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

function PublishToggle({
  published,
  busy,
  onToggle,
  label,
}: {
  published: boolean;
  busy: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      aria-pressed={published}
      aria-label={`${published ? "Unpublish" : "Publish"} ${label}`}
      className="shrink-0 disabled:opacity-50"
    >
      <StatusPill tone={published ? "good" : "quiet"}>{published ? "Published" : "Draft"}</StatusPill>
    </button>
  );
}

function RowControls({
  index,
  count,
  busy,
  label,
  onMove,
  onDelete,
}: {
  index: number;
  count: number;
  busy: boolean;
  label: string;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center">
      <Button type="button" variant="ghost" size="sm" disabled={busy || index === 0} onClick={() => onMove(-1)}>
        <ArrowUp className="h-4 w-4" />
        <span className="sr-only">Move {label} up</span>
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={busy || index === count - 1} onClick={() => onMove(1)}>
        <ArrowDown className="h-4 w-4" />
        <span className="sr-only">Move {label} down</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        disabled={busy}
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4" />
        <span className="sr-only">Delete {label}</span>
      </Button>
    </div>
  );
}

/** Pencil → inline title input → save / cancel. Used for course and module names. */
function RenameButton({
  title,
  busy,
  label,
  onSave,
}: {
  title: string;
  busy: boolean;
  label: string;
  onSave: (title: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);

  if (!editing) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => {
          setValue(title);
          setEditing(true);
        }}
      >
        <Pencil className="h-4 w-4" />
        <span className="sr-only">Rename {label}</span>
      </Button>
    );
  }
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSave(value)) setEditing(false);
      }}
    >
      <Input value={value} onChange={(e) => setValue(e.target.value)} aria-label={`New name for ${label}`} className="h-8 w-48" autoFocus />
      <Button type="submit" variant="ghost" size="sm" disabled={busy || !value.trim()}>
        <Check className="h-4 w-4" />
        <span className="sr-only">Save name</span>
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
        <X className="h-4 w-4" />
        <span className="sr-only">Cancel rename</span>
      </Button>
    </form>
  );
}

/** Inline editor for one lesson: title plus its text or link. Type stays the same. */
function LessonEditForm({
  lesson,
  busy,
  onSave,
  onCancel,
}: {
  lesson: LmsLesson;
  busy: boolean;
  onSave: (payload: Record<string, string>) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(lesson.title);
  const [body, setBody] = useState(lesson.body ?? "");
  const [url, setUrl] = useState(lesson.link_url ?? "");

  return (
    <form
      className="w-full space-y-2 py-1"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSave(lessonEditPayload(lesson, { title, body, link_url: url }))) onCancel();
      }}
    >
      <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Lesson title" />
      {lesson.content_type === "link" ? (
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="Lesson link" />
      ) : (
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} aria-label="Lesson text" />
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !title.trim()}>
          Save lesson
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AddLessonForm({ onAdd, busy }: { onAdd: (input: Record<string, unknown>) => Promise<boolean>; busy: boolean }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<LmsContentType>("rich_text");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await onAdd(
      type === "rich_text"
        ? { title, content_type: type, body }
        : { title, content_type: type, link_url: url }
    );
    if (ok) {
      setTitle("");
      setBody("");
      setUrl("");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-dashed pt-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lesson title" aria-label="Lesson title" />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as LmsContentType)}
          aria-label="Lesson type"
          className="h-9 border border-input bg-white px-2 text-sm"
        >
          <option value="rich_text">Text</option>
          <option value="link">Link</option>
        </select>
      </div>
      {type === "rich_text" ? (
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Lesson text" aria-label="Lesson text" />
      ) : (
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="Lesson link" />
      )}
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={busy || !lessonDraftReady({ title, content_type: type, body, link_url: url })}
      >
        <Plus className="mr-1 h-4 w-4" /> Add lesson
      </Button>
    </form>
  );
}

export function ClassroomTab({ programId }: { programId: string }) {
  const base = `/api/schools/programs/${programId}/lms`;
  const [courses, setCourses] = useState<LmsCourse[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tree, setTree] = useState<LmsCourseTree | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCourse, setNewCourse] = useState("");
  const [newModule, setNewModule] = useState("");
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);

  const loadCourses = useCallback(async () => {
    const { ok, data } = await call(`${base}/courses`, "GET");
    if (!ok) {
      setError((data.error as string) ?? "Could not load the classroom");
      setCourses([]);
      return;
    }
    setCourses(data.courses as LmsCourse[]);
  }, [base]);

  const loadTree = useCallback(
    async (courseId: string) => {
      const { ok, data } = await call(`${base}/courses/${courseId}`, "GET");
      if (!ok) {
        setError((data.error as string) ?? "Could not load the course");
        return;
      }
      setTree(data.course as LmsCourseTree);
    },
    [base]
  );

  useEffect(() => {
    void loadCourses();
  }, [loadCourses]);

  useEffect(() => {
    if (openId) void loadTree(openId);
    else setTree(null);
  }, [openId, loadTree]);

  async function run(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    const { ok, data } = await call(url, method, body);
    if (!ok) setError((data.error as string) ?? "Something went wrong");
    if (openId) await loadTree(openId);
    await loadCourses();
    setBusy(false);
    return ok;
  }

  const pathFor = (kind: Kind, id: string) =>
    `${base}/${kind === "course" ? "courses" : kind === "module" ? "modules" : "lessons"}/${id}`;

  const togglePublish = (kind: Kind, id: string, published: boolean) =>
    run(pathFor(kind, id), "PATCH", { published: !published });

  const rename = (kind: Kind, id: string, title: string) => run(pathFor(kind, id), "PATCH", { title });

  const remove = (kind: Kind, id: string, title: string) => {
    if (!window.confirm(`Delete "${title}"? This also deletes everything inside it.`)) return;
    if (kind === "course" && id === openId) setOpenId(null);
    void run(pathFor(kind, id), "DELETE");
  };

  if (courses === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading classroom…
      </p>
    );
  }

  // ── One course open ──
  if (openId && tree) {
    const moduleIds = tree.modules.map((m) => m.id);
    return (
      <Card>
        <CardHeader className="space-y-2">
          <Button type="button" variant="ghost" size="sm" className="w-fit px-0" onClick={() => setOpenId(null)}>
            <ChevronLeft className="mr-1 h-4 w-4" /> All classroom courses
          </Button>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1">
              <CardTitle className="truncate text-base">{tree.title}</CardTitle>
              <RenameButton
                title={tree.title}
                busy={busy}
                label={tree.title}
                onSave={(title) => rename("course", tree.id, title)}
              />
            </div>
            <PublishToggle
              published={tree.published}
              busy={busy}
              label={tree.title}
              onToggle={() => void togglePublish("course", tree.id, tree.published)}
            />
          </div>
          {tree.description && <p className="text-sm text-muted-foreground">{tree.description}</p>}
          <p className="text-xs text-muted-foreground">
            Students see a lesson only when the lesson, its module, and this course are all published.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {tree.modules.length === 0 && (
            <p className="text-sm italic text-muted-foreground">No modules yet.</p>
          )}
          {tree.modules.map((m, mi) => {
            const lessonIds = m.lessons.map((l) => l.id);
            return (
              <section key={m.id} className="border border-ink bg-white">
                <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
                  <div className="flex min-w-0 items-center gap-1">
                    <p className="min-w-0 truncate text-sm font-semibold">{m.title}</p>
                    <RenameButton
                      title={m.title}
                      busy={busy}
                      label={m.title}
                      onSave={(title) => rename("module", m.id, title)}
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <PublishToggle
                      published={m.published}
                      busy={busy}
                      label={m.title}
                      onToggle={() => void togglePublish("module", m.id, m.published)}
                    />
                    <RowControls
                      index={mi}
                      count={tree.modules.length}
                      busy={busy}
                      label={m.title}
                      onMove={(dir) =>
                        void run(`${base}/courses/${tree.id}/modules/reorder`, "POST", { ids: moveId(moduleIds, m.id, dir) })
                      }
                      onDelete={() => remove("module", m.id, m.title)}
                    />
                  </div>
                </header>
                <div className="space-y-2 px-3 py-2">
                  {m.lessons.length === 0 && <p className="text-xs italic text-muted-foreground">No lessons yet.</p>}
                  <ul className="divide-y">
                    {m.lessons.map((l, li) =>
                      editingLessonId === l.id ? (
                        <li key={l.id} className="py-2">
                          <LessonEditForm
                            lesson={l}
                            busy={busy}
                            onSave={(payload) => run(pathFor("lesson", l.id), "PATCH", payload)}
                            onCancel={() => setEditingLessonId(null)}
                          />
                        </li>
                      ) : (
                      <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm">{l.title}</p>
                          {l.content_type === "link" && l.link_url ? (
                            <a
                              href={l.link_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex max-w-full items-center gap-1 truncate text-xs text-muted-foreground underline"
                            >
                              <ExternalLink className="h-3 w-3 shrink-0" />
                              <span className="truncate">{l.link_url}</span>
                            </a>
                          ) : (
                            <p className="truncate text-xs text-muted-foreground">{l.body}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => setEditingLessonId(l.id)}
                          >
                            <Pencil className="h-4 w-4" />
                            <span className="sr-only">Edit {l.title}</span>
                          </Button>
                          <PublishToggle
                            published={l.published}
                            busy={busy}
                            label={l.title}
                            onToggle={() => void togglePublish("lesson", l.id, l.published)}
                          />
                          <RowControls
                            index={li}
                            count={m.lessons.length}
                            busy={busy}
                            label={l.title}
                            onMove={(dir) =>
                              void run(`${base}/modules/${m.id}/lessons/reorder`, "POST", {
                                ids: moveId(lessonIds, l.id, dir),
                              })
                            }
                            onDelete={() => remove("lesson", l.id, l.title)}
                          />
                        </div>
                      </li>
                      )
                    )}
                  </ul>
                  <AddLessonForm busy={busy} onAdd={(input) => run(`${base}/modules/${m.id}/lessons`, "POST", input)} />
                </div>
              </section>
            );
          })}
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(`${base}/courses/${tree.id}/modules`, "POST", { title: newModule })) setNewModule("");
            }}
          >
            <Input value={newModule} onChange={(e) => setNewModule(e.target.value)} placeholder="New module title" aria-label="New module title" />
            <Button type="submit" size="sm" disabled={busy || !newModule.trim()}>
              <Plus className="mr-1 h-4 w-4" /> Add module
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  // ── Course list ──
  const courseIds = courses.map((c) => c.id);
  return (
    <div className="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Classroom</CardTitle>
        <p className="text-sm text-muted-foreground">
          Learning content for enrolled students: courses, modules, and lessons (text or a link).
          This is separate from the Courses tab, which holds the school&apos;s phases and billing.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {courses.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">No classroom courses yet.</p>
        ) : (
          <ul className="divide-y border">
            {courses.map((c, i) => (
              <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <button type="button" className="min-w-0 text-left" onClick={() => setOpenId(c.id)}>
                  <p className="truncate text-sm font-medium underline-offset-2 hover:underline">{c.title}</p>
                  {c.description && <p className="truncate text-xs text-muted-foreground">{c.description}</p>}
                </button>
                <div className="flex items-center gap-1">
                  <RenameButton
                    title={c.title}
                    busy={busy}
                    label={c.title}
                    onSave={(title) => rename("course", c.id, title)}
                  />
                  <PublishToggle
                    published={c.published}
                    busy={busy}
                    label={c.title}
                    onToggle={() => void togglePublish("course", c.id, c.published)}
                  />
                  <RowControls
                    index={i}
                    count={courses.length}
                    busy={busy}
                    label={c.title}
                    onMove={(dir) => void run(`${base}/courses/reorder`, "POST", { ids: moveId(courseIds, c.id, dir) })}
                    onDelete={() => remove("course", c.id, c.title)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(`${base}/courses`, "POST", { title: newCourse })) setNewCourse("");
          }}
        >
          <Input value={newCourse} onChange={(e) => setNewCourse(e.target.value)} placeholder="New course title" aria-label="New course title" />
          <Button type="submit" size="sm" disabled={busy || !newCourse.trim()}>
            <Plus className="mr-1 h-4 w-4" /> Add course
          </Button>
        </form>
      </CardContent>
    </Card>
    {/* LMS slice 2: assignments, submissions and grading. */}
    <AssignmentsSection programId={programId} canEdit />
    </div>
  );
}
