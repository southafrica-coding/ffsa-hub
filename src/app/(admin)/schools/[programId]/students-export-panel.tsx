"use client";

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  STUDENT_EXPORT_COLUMN_GROUPS,
  STUDENT_EXPORT_COLUMN_LABELS,
  STUDENT_EXPORT_COLUMN_ORDER,
  type StudentExportColumnKey,
} from "@/lib/schools/student-export-columns";

const STORAGE_KEY = "schools-students-export-columns";

type EnrollmentLike = {
  user_id: string;
  removed_at: string | null;
  users: {
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    email: string | null;
  };
};

function displayName(u: EnrollmentLike["users"]): string {
  if (u.first_name) {
    return `${u.preferred_name ?? u.first_name} ${u.last_name ?? ""}`.trim();
  }
  return u.email ?? "Unknown";
}

function triggerDownload(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function StudentsExportPanel({
  programId,
  enrollments,
}: {
  programId: string;
  enrollments: EnrollmentLike[];
}) {
  const [open, setOpen] = useState(false);

  const activeStudents = useMemo(
    () => enrollments.filter((e) => !e.removed_at),
    [enrollments]
  );
  const removedStudents = useMemo(
    () => enrollments.filter((e) => e.removed_at),
    [enrollments]
  );
  const activeIds = useMemo(
    () => activeStudents.map((e) => e.user_id),
    [activeStudents]
  );

  const [selectedColumns, setSelectedColumns] = useState<
    Set<StudentExportColumnKey>
  >(() => new Set(STUDENT_EXPORT_COLUMN_ORDER));
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(
    () => new Set(activeIds)
  );
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const [search, setSearch] = useState("");

  // Restore the saved column choice (client-only, after hydration).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const keys = (JSON.parse(raw) as string[]).filter(
        (k): k is StudentExportColumnKey =>
          (STUDENT_EXPORT_COLUMN_ORDER as string[]).includes(k)
      );
      if (keys.length) setSelectedColumns(new Set(keys));
    } catch {
      /* ignore bad storage */
    }
  }, []);

  // Keep the default student selection in sync with the roster when the dialog
  // opens (e.g. after a student was added/removed and the page refreshed).
  useEffect(() => {
    if (open) {
      setSelectedStudents(new Set(activeIds));
      setIncludeRemoved(false);
      setSearch("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function persistColumns(next: Set<StudentExportColumnKey>) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }

  function toggleColumn(key: StudentExportColumnKey) {
    setSelectedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistColumns(next);
      return next;
    });
  }

  function setAllColumns(on: boolean) {
    const next = on
      ? new Set(STUDENT_EXPORT_COLUMN_ORDER)
      : new Set<StudentExportColumnKey>();
    setSelectedColumns(next);
    persistColumns(next);
  }

  function toggleStudent(userId: string) {
    setSelectedStudents((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  const visibleStudents = useMemo(() => {
    const list = includeRemoved
      ? [...activeStudents, ...removedStudents]
      : activeStudents;
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((e) => displayName(e.users).toLowerCase().includes(q));
  }, [includeRemoved, activeStudents, removedStudents, search]);

  function setAllVisibleStudents(on: boolean) {
    setSelectedStudents((prev) => {
      const next = new Set(prev);
      for (const e of visibleStudents) {
        if (on) next.add(e.user_id);
        else next.delete(e.user_id);
      }
      return next;
    });
  }

  const href = useMemo(() => {
    const params = new URLSearchParams();
    const cols = STUDENT_EXPORT_COLUMN_ORDER.filter((k) =>
      selectedColumns.has(k)
    );
    // Only send columns for a partial set, so the default stays stable.
    if (cols.length !== STUDENT_EXPORT_COLUMN_ORDER.length) {
      params.set("columns", cols.join(","));
    }
    // Only send students when the selection differs from "all active" — the
    // common case sends nothing and the route exports every active student.
    const isAllActive =
      selectedStudents.size === activeIds.length &&
      activeIds.every((id) => selectedStudents.has(id));
    if (!isAllActive) {
      params.set("students", [...selectedStudents].join(","));
    }
    const qs = params.toString();
    return `/api/schools/programs/${programId}/students/export${qs ? `?${qs}` : ""}`;
  }, [programId, selectedColumns, selectedStudents, activeIds]);

  const canDownload = selectedColumns.size > 0 && selectedStudents.size > 0;

  function download() {
    if (!canDownload) return;
    triggerDownload(href);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          title="Download a CSV of this program's students — choose which columns and which students to include."
        >
          <Download className="mr-2 h-4 w-4" />
          Download CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Download students CSV</DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 sm:grid-cols-2">
          {/* Columns */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Columns
              </span>
              <span className="text-xs">
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setAllColumns(true)}
                >
                  All
                </button>
                <span className="text-muted-foreground"> · </span>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setAllColumns(false)}
                >
                  None
                </button>
              </span>
            </div>
            <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {STUDENT_EXPORT_COLUMN_GROUPS.map((g) => (
                <div key={g.group}>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {g.group}
                  </p>
                  <div className="space-y-1.5">
                    {g.keys.map((key) => (
                      <label
                        key={key}
                        className="flex cursor-pointer items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={selectedColumns.has(key)}
                          onCheckedChange={() => toggleColumn(key)}
                        />
                        <span>{STUDENT_EXPORT_COLUMN_LABELS[key]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Students */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Students ({selectedStudents.size})
              </span>
              <span className="text-xs">
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setAllVisibleStudents(true)}
                >
                  All
                </button>
                <span className="text-muted-foreground"> · </span>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setAllVisibleStudents(false)}
                >
                  None
                </button>
              </span>
            </div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search students…"
              className="mb-2 h-8"
            />
            <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {visibleStudents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No students to show.
                </p>
              ) : (
                visibleStudents.map((e) => (
                  <label
                    key={e.user_id}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={selectedStudents.has(e.user_id)}
                      onCheckedChange={() => toggleStudent(e.user_id)}
                    />
                    <span className="truncate">
                      {displayName(e.users)}
                      {e.removed_at && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          (removed)
                        </span>
                      )}
                    </span>
                  </label>
                ))
              )}
            </div>
            {removedStudents.length > 0 && (
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={includeRemoved}
                  onCheckedChange={(v) => setIncludeRemoved(v === true)}
                />
                <span>Include removed ({removedStudents.length})</span>
              </label>
            )}
          </div>
        </div>

        <DialogFooter>
          {!canDownload && (
            <p className="mr-auto self-center text-xs text-destructive">
              Pick at least one column and one student.
            </p>
          )}
          <Button onClick={download} disabled={!canDownload}>
            <Download className="mr-2 h-4 w-4" />
            Download CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
