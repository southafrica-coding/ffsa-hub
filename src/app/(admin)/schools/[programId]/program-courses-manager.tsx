"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Sparkles,
  CalendarDays,
  User as UserIcon,
} from "lucide-react";
import { FFX_2027_PROGRAM_TEMPLATE } from "@/lib/finance/billing";

export type PhaseCourse = {
  id: string;
  code: string;
  name: string;
  scope: "full_program" | "segment";
  sequence: number;
  status: string;
  start_date: string | null;
  end_date: string | null;
  arrival_date: string | null;
  lead_staff_id: string | null;
  description: string | null;
  /** Gets a grade (migration 259) — FFX doesn't, FFBX and FFWX do. */
  graded?: boolean;
};

type Staff = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
};

const staffName = (s: Staff) =>
  `${s.first_name || ""} ${s.last_name || ""}`.trim() ||
  "Unknown";

const STATUS_COLORS: Record<string, "default" | "secondary" | "outline"> = {
  upcoming: "outline",
  active: "default",
  completed: "secondary",
  archived: "secondary",
};

export function ProgramCoursesManager({
  programId,
  courses,
  staff,
}: {
  programId: string;
  courses: PhaseCourse[];
  staff: Staff[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<PhaseCourse | null>(null);
  const [creating, setCreating] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const sorted = [...courses].sort((a, b) => a.sequence - b.sequence);
  const staffById: Record<string, Staff> = {};
  for (const s of staff) staffById[s.id] = s;

  async function seedFFX() {
    setSeeding(true);
    try {
      for (const ct of FFX_2027_PROGRAM_TEMPLATE.courses) {
        const res = await fetch("/api/finance/school-fees/billing-courses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            program_id: programId,
            code: ct.code,
            name: ct.name,
            scope: ct.scope,
            sequence: ct.sequence,
            start_date: ct.start_date,
            end_date: ct.end_date,
          }),
        });
        if (!res.ok) {
          const e = await res.json();
          throw new Error(e.error || `Failed to create ${ct.code}`);
        }
      }
      toast.success("Loaded FFX 2027 phases (charges set up in Finance)");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load phases");
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          The courses that make up this school. Charges and billing for each stay in Finance.
          Pages, assignments, and grading are on the Classroom tab.
        </p>
        <div className="flex items-center gap-2">
          {sorted.length === 0 && (
            <Button size="sm" variant="outline" onClick={seedFFX} disabled={seeding}>
              {seeding ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-1" />
              )}
              Load FFX 2027
            </Button>
          )}
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Course
          </Button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No courses yet. Add the courses that make up this program, or load the
          FFX 2027 template.
        </p>
      ) : (
        <div className="space-y-2">
          {sorted.map((c) => {
            const leader = c.lead_staff_id ? staffById[c.lead_staff_id] : null;
            const dates =
              c.start_date || c.end_date
                ? `${c.start_date ?? "?"} → ${c.end_date ?? "?"}`
                : null;
            return (
              <div
                key={c.id}
                className="flex items-center justify-between border bg-card px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="font-medium flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground font-mono">
                      #{c.sequence}
                    </span>
                    {c.name}
                    <Badge variant="secondary" className="text-[10px]">{c.code}</Badge>
                    <Badge variant={STATUS_COLORS[c.status] ?? "secondary"} className="text-[10px]">
                      {c.status}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {c.graded === false ? "Not graded" : "Graded"}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-3 mt-0.5">
                    {dates && (
                      <span className="flex items-center gap-1">
                        <CalendarDays className="h-3 w-3" /> {dates}
                      </span>
                    )}
                    {leader && (
                      <span className="flex items-center gap-1">
                        <UserIcon className="h-3 w-3" /> {staffName(leader)}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/schools/${programId}/classroom/${c.id}`}
                    className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] underline"
                  >
                    Design
                  </Link>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDialog(c)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(creating || dialog) && (
        <CourseDialog
          programId={programId}
          course={dialog}
          staff={staff}
          onClose={() => {
            setCreating(false);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

function CourseDialog({
  programId,
  course,
  staff,
  onClose,
}: {
  programId: string;
  course: PhaseCourse | null;
  staff: Staff[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({
    code: course?.code ?? "",
    name: course?.name ?? "",
    scope: course?.scope ?? ("segment" as "segment" | "full_program"),
    sequence: course ? String(course.sequence) : "0",
    status: course?.status ?? "upcoming",
    start_date: course?.start_date ?? "",
    end_date: course?.end_date ?? "",
    arrival_date: course?.arrival_date ?? "",
    lead_staff_id: course?.lead_staff_id ?? "none",
    description: course?.description ?? "",
    graded: course?.graded ?? true,
  });
  const set = (patch: Partial<typeof form>) => setForm((p) => ({ ...p, ...patch }));

  async function save() {
    if (!form.code || !form.name) {
      toast.error("Code and name are required");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/finance/school-fees/billing-courses", {
        method: course ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: course?.id,
          program_id: programId,
          code: form.code,
          name: form.name,
          scope: form.scope,
          sequence: Number(form.sequence) || 0,
          status: form.status,
          start_date: form.start_date || null,
          end_date: form.end_date || null,
          arrival_date: form.arrival_date || null,
          lead_staff_id: form.lead_staff_id === "none" ? null : form.lead_staff_id,
          description: form.description || null,
          graded: form.graded,
        }),
      });
      if (res.ok) {
        toast.success(course ? "Course updated" : "Course created");
        onClose();
        router.refresh();
      } else {
        const { error } = await res.json();
        toast.error(error || "Failed to save");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function remove() {
    if (!course) return;
    if (!confirm(`Delete course "${course.name}"? This also removes its charges & billing.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/finance/school-fees/billing-courses?id=${course.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success("Course deleted");
        onClose();
        router.refresh();
      } else {
        toast.error("Failed to delete");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{course ? "Edit course" : "New course"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Code</Label>
              <Input value={form.code} placeholder="FFX" onChange={(e) => set({ code: e.target.value })} />
            </div>
            <div>
              <Label>Sequence (order)</Label>
              <Input type="number" value={form.sequence} onChange={(e) => set({ sequence: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Name</Label>
            <Input value={form.name} placeholder="FFX (Q1)" onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => set({ status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["upcoming", "active", "completed", "archived"].map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label>Start</Label>
              <Input type="date" value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} />
            </div>
            <div>
              <Label>End</Label>
              <Input type="date" value={form.end_date} onChange={(e) => set({ end_date: e.target.value })} />
            </div>
            <div>
              <Label>Arrival</Label>
              <Input type="date" value={form.arrival_date} onChange={(e) => set({ arrival_date: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Course leader</Label>
            <Select value={form.lead_staff_id} onValueChange={(v) => set({ lead_staff_id: v })}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{staffName(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={form.graded}
              onChange={(e) => set({ graded: e.target.checked })}
              className="h-4 w-4"
            />
            <span className="!font-sans text-[14px] !font-normal normal-case !tracking-normal !text-[color:var(--text-primary)]">
              Students get a grade for this course
            </span>
          </label>
          <div>
            <Label>Description</Label>
            <Textarea rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} />
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          {course ? (
            <Button variant="ghost" className="text-destructive" onClick={remove} disabled={deleting}>
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={loading}>{loading ? "Saving..." : "Save"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
