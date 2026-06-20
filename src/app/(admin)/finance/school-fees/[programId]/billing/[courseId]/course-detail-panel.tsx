"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pencil, Users, Loader2 } from "lucide-react";

type Course = {
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
};

type Staff = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
};

type RosterEntry = { name: string; tier: string; scheduled: number };

const staffName = (s: Staff) =>
  `${s.preferred_name || s.first_name || ""} ${s.last_name || ""}`.trim() ||
  "Unknown";

const STATUS_COLORS: Record<string, "default" | "secondary" | "outline"> = {
  upcoming: "outline",
  active: "default",
  completed: "secondary",
  archived: "secondary",
};

export function CourseDetailPanel({
  course,
  staff,
  roster,
}: {
  course: Course;
  staff: Staff[];
  roster: RosterEntry[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    status: course.status,
    scope: course.scope,
    sequence: String(course.sequence),
    start_date: course.start_date ?? "",
    end_date: course.end_date ?? "",
    arrival_date: course.arrival_date ?? "",
    lead_staff_id: course.lead_staff_id ?? "none",
    description: course.description ?? "",
  });

  const set = (patch: Partial<typeof form>) =>
    setForm((p) => ({ ...p, ...patch }));

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/finance/school-fees/billing-courses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: course.id,
          status: form.status,
          scope: form.scope,
          sequence: Number(form.sequence) || 0,
          start_date: form.start_date || null,
          end_date: form.end_date || null,
          arrival_date: form.arrival_date || null,
          lead_staff_id: form.lead_staff_id === "none" ? null : form.lead_staff_id,
          description: form.description || null,
        }),
      });
      if (res.ok) {
        toast.success("Course updated");
        setEditing(false);
        router.refresh();
      } else {
        const { error } = await res.json();
        toast.error(error || "Failed to save");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  const leader = staff.find((s) => s.id === course.lead_staff_id);
  const dateRange =
    course.start_date || course.end_date
      ? `${course.start_date ?? "?"} → ${course.end_date ?? "?"}`
      : "No dates set";

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Info */}
      <Card>
        <CardContent className="pt-4">
          {!editing ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_COLORS[course.status] ?? "secondary"}>
                    {course.status}
                  </Badge>
                  {course.scope === "full_program" && (
                    <Badge variant="outline" className="text-[10px]">
                      whole year
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground font-mono">
                    #{course.sequence}
                  </span>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(true)}>
                  <Pencil className="h-3 w-3" />
                </Button>
              </div>
              <dl className="text-sm space-y-1.5">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Dates</dt>
                  <dd className="text-right">{dateRange}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Arrival</dt>
                  <dd className="text-right">{course.arrival_date ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Leader</dt>
                  <dd className="text-right">{leader ? staffName(leader) : "—"}</dd>
                </div>
              </dl>
              {course.description && (
                <p className="text-sm text-muted-foreground border-t pt-2">
                  {course.description}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select value={form.status} onValueChange={(v) => set({ status: v })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["upcoming", "active", "completed", "archived"].map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Sequence</Label>
                  <Input type="number" className="h-9" value={form.sequence}
                    onChange={(e) => set({ sequence: e.target.value })} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Scope</Label>
                <Select value={form.scope} onValueChange={(v) => set({ scope: v as "segment" | "full_program" })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="segment">Segment (a phase)</SelectItem>
                    <SelectItem value="full_program">Whole year</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Start</Label>
                  <Input type="date" className="h-9" value={form.start_date}
                    onChange={(e) => set({ start_date: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">End</Label>
                  <Input type="date" className="h-9" value={form.end_date}
                    onChange={(e) => set({ end_date: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Arrival</Label>
                  <Input type="date" className="h-9" value={form.arrival_date}
                    onChange={(e) => set({ arrival_date: e.target.value })} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Course leader</Label>
                <Select value={form.lead_staff_id} onValueChange={(v) => set({ lead_staff_id: v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {staff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{staffName(s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Textarea rows={2} value={form.description}
                  onChange={(e) => set({ description: e.target.value })} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                  Save
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Roster */}
      <Card>
        <CardContent className="pt-4 space-y-2">
          <p className="text-sm font-medium flex items-center gap-2">
            <Users className="h-4 w-4" /> Roster ({roster.length})
          </p>
          {roster.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              No students billed for this phase yet.
            </p>
          ) : (
            <div className="space-y-1">
              {roster.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                  <span>{r.name}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-[10px]">Tier {r.tier}</Badge>
                    {r.scheduled} charges
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
