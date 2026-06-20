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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  ChevronDown,
  ChevronRight,
  CalendarDays,
  ArrowRight,
} from "lucide-react";
import {
  CHARGE_TYPE_META,
  DUE_ANCHOR_LABELS,
  GENERATION_RULE_LABELS,
  TIERS,
  formatZAR,
} from "@/lib/finance/billing";
import type {
  ChargeType,
  DueAnchor,
  GenerationRule,
  Tier,
} from "@/services/school-billing";

// ── Types ───────────────────────────────────────────────────

type Course = {
  id: string;
  program_id: string;
  code: string;
  name: string;
  scope: "full_program" | "segment";
  sequence: number;
  start_date: string | null;
  end_date: string | null;
  arrival_date: string | null;
  enroll_lead_days: number;
  status: string;
  fee_charge_items: { id: string }[] | null;
};

type ChargeItem = {
  id: string;
  course_id: string;
  tier: Tier;
  charge_type: ChargeType;
  label: string;
  amount_zar: number;
  xero_item_code: string | null;
  cadence: "once" | "monthly";
  quantity: number;
  due_anchor: DueAnchor;
  due_day: number | null;
  first_due_month: number | null;
  first_due_year: number | null;
  fixed_due_date: string | null;
  arrival_offset_days: number | null;
  generation_rule: GenerationRule;
  generation_fixed_date: string | null;
  generation_lead_days: number | null;
  sort_order: number;
  active: boolean;
  notes: string | null;
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function dueSummary(item: ChargeItem): string {
  const occ = item.cadence === "monthly" ? `${item.quantity}×` : "once";
  switch (item.due_anchor) {
    case "acceptance":
      return `${occ} · due on acceptance`;
    case "month_day": {
      const start =
        item.first_due_month != null
          ? ` from ${MONTHS[item.first_due_month - 1] ?? "?"}`
          : "";
      return `${occ} · due on the ${item.due_day ?? "?"}${start}`;
    }
    case "fixed_date":
      return `${occ} · due ${item.fixed_due_date ?? "?"}`;
    case "relative_to_arrival": {
      const off = item.arrival_offset_days ?? 0;
      const when =
        off === 0
          ? "on arrival"
          : `${Math.abs(off)} days ${off < 0 ? "before" : "after"} arrival`;
      return `${occ} · due ${when}`;
    }
    default:
      return occ;
  }
}

// ── Root ────────────────────────────────────────────────────

export function ProgramBillingClient({
  programId,
  courses,
  itemsByCourse,
}: {
  programId: string;
  courses: Course[];
  itemsByCourse: Record<string, ChargeItem[]>;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {courses.length} course{courses.length !== 1 ? "s" : ""} · courses are
        created &amp; edited in <span className="font-medium">Training</span>. Set
        each course&apos;s charges and student billing here.
      </p>

      {courses.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No courses yet. Create the courses (phases) in{" "}
          <span className="font-medium">Training → this program → Courses</span>,
          then set their charges here.
        </p>
      ) : (
        <div className="space-y-3">
          {courses.map((course) => (
            <CourseCard
              key={course.id}
              programId={programId}
              course={course}
              items={itemsByCourse[course.id] ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Course card ─────────────────────────────────────────────

function CourseCard({
  programId,
  course,
  items,
}: {
  programId: string;
  course: Course;
  items: ChargeItem[];
}) {
  const [expanded, setExpanded] = useState(false);

  const itemCount = items.length;

  const dateRange =
    course.start_date || course.end_date
      ? `${course.start_date ?? "?"} → ${course.end_date ?? "?"}`
      : null;

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <button
            className="flex items-center gap-2 text-left min-w-0"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="font-semibold flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground font-mono">
                  #{course.sequence}
                </span>
                {course.name}
                <Badge variant="secondary" className="text-xs">
                  {course.code}
                </Badge>
                {course.scope === "full_program" && (
                  <Badge variant="outline" className="text-[10px]">
                    whole year
                  </Badge>
                )}
              </p>
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                {itemCount} charge item{itemCount !== 1 ? "s" : ""}
                {dateRange && (
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    {dateRange}
                  </span>
                )}
              </p>
            </div>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/finance/school-fees/${programId}/billing/${course.id}`}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
            >
              Student schedules <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

        {expanded && (
          <div className="pl-6">
            <ChargeItemsEditor courseId={course.id} items={items} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Course create/edit dialog ───────────────────────────────

function CourseDialog({
  programId,
  course,
  onClose,
}: {
  programId: string;
  course: Course | null;
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
    start_date: course?.start_date ?? "",
    end_date: course?.end_date ?? "",
    arrival_date: course?.arrival_date ?? "",
    enroll_lead_days: course ? String(course.enroll_lead_days) : "30",
  });

  const set = (patch: Partial<typeof form>) =>
    setForm((p) => ({ ...p, ...patch }));

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
          start_date: form.start_date || null,
          end_date: form.end_date || null,
          arrival_date: form.arrival_date || null,
          enroll_lead_days: Number(form.enroll_lead_days) || 30,
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
    if (!confirm(`Delete course "${course.name}" and all its charge items?`))
      return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/finance/school-fees/billing-courses?id=${course.id}`,
        { method: "DELETE" }
      );
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
              <Input
                value={form.code}
                placeholder="FFXYL"
                onChange={(e) => set({ code: e.target.value })}
              />
            </div>
            <div>
              <Label>Sequence (order)</Label>
              <Input
                type="number"
                value={form.sequence}
                onChange={(e) => set({ sequence: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Name</Label>
            <Input
              value={form.name}
              placeholder="FFX Year Long"
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Scope</Label>
              <Select
                value={form.scope}
                onValueChange={(v) =>
                  set({ scope: v as "segment" | "full_program" })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="segment">Segment (e.g. a quarter)</SelectItem>
                  <SelectItem value="full_program">Whole year</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Enrolment opens (days before start)</Label>
              <Input
                type="number"
                value={form.enroll_lead_days}
                onChange={(e) => set({ enroll_lead_days: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Start date</Label>
              <Input
                type="date"
                value={form.start_date}
                onChange={(e) => set({ start_date: e.target.value })}
              />
            </div>
            <div>
              <Label>End date</Label>
              <Input
                type="date"
                value={form.end_date}
                onChange={(e) => set({ end_date: e.target.value })}
              />
            </div>
            <div>
              <Label>Arrival date</Label>
              <Input
                type="date"
                value={form.arrival_date}
                onChange={(e) => set({ arrival_date: e.target.value })}
              />
            </div>
          </div>
        </div>
        <DialogFooter className="flex items-center justify-between sm:justify-between">
          {course ? (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={remove}
              disabled={deleting}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={loading}>
              {loading ? "Saving..." : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Charge items editor (tabs A/B/C) ────────────────────────

function ChargeItemsEditor({
  courseId,
  items,
}: {
  courseId: string;
  items: ChargeItem[];
}) {
  const [dialogState, setDialogState] = useState<{
    tier: Tier;
    item: ChargeItem | null;
  } | null>(null);

  const byTier: Record<Tier, ChargeItem[]> = { A: [], B: [], C: [] };
  for (const it of items) byTier[it.tier]?.push(it);

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <Tabs defaultValue="A">
        <TabsList>
          {TIERS.map((t) => (
            <TabsTrigger key={t} value={t}>
              Tier {t} ({byTier[t].length})
            </TabsTrigger>
          ))}
        </TabsList>

        {TIERS.map((tier) => {
          const tierItems = byTier[tier];
          const total = tierItems.reduce(
            (sum, it) =>
              sum +
              Number(it.amount_zar) * (it.cadence === "monthly" ? it.quantity : 1),
            0
          );
          return (
            <TabsContent key={tier} value={tier} className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Course total (Tier {tier}):{" "}
                  <span className="font-mono font-medium">{formatZAR(total)}</span>
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDialogState({ tier, item: null })}
                >
                  <Plus className="h-3 w-3 mr-1" /> Add charge
                </Button>
              </div>

              {tierItems.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No charges configured for Tier {tier}.
                </p>
              ) : (
                <div className="space-y-2">
                  {tierItems.map((it) => (
                    <ChargeItemRow
                      key={it.id}
                      item={it}
                      onEdit={() => setDialogState({ tier, item: it })}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      {dialogState && (
        <ChargeItemDialog
          courseId={courseId}
          tier={dialogState.tier}
          item={dialogState.item}
          onClose={() => setDialogState(null)}
        />
      )}
    </div>
  );
}

function ChargeItemRow({
  item,
  onEdit,
}: {
  item: ChargeItem;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    if (!confirm(`Delete "${item.label}"?`)) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/finance/school-fees/charge-items?id=${item.id}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        toast.success("Charge deleted");
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
    <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{item.label}</span>
          <Badge variant="outline" className="text-[10px]">
            {CHARGE_TYPE_META[item.charge_type]?.label ?? item.charge_type}
          </Badge>
          {item.xero_item_code && (
            <span className="text-[10px] font-mono text-muted-foreground">
              {item.xero_item_code}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{dueSummary(item)}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-mono text-sm">
          {formatZAR(Number(item.amount_zar))}
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive"
          onClick={remove}
          disabled={deleting}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ── Charge item dialog ──────────────────────────────────────

const CHARGE_TYPES: ChargeType[] = [
  "deposit",
  "monthly_tuition",
  "outreach",
  "quarter_first",
  "quarter_final",
];

const DUE_ANCHORS: DueAnchor[] = [
  "acceptance",
  "month_day",
  "fixed_date",
  "relative_to_arrival",
];

const GENERATION_RULES: GenerationRule[] = [
  "immediate",
  "preceding_month_15th",
  "fixed_date",
  "days_before_due",
];

function ChargeItemDialog({
  courseId,
  tier,
  item,
  onClose,
}: {
  courseId: string;
  tier: Tier;
  item: ChargeItem | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    charge_type: item?.charge_type ?? ("deposit" as ChargeType),
    label: item?.label ?? "",
    amount_zar: item ? String(item.amount_zar) : "0",
    xero_item_code: item?.xero_item_code ?? "",
    cadence: item?.cadence ?? ("once" as "once" | "monthly"),
    quantity: item ? String(item.quantity) : "1",
    due_anchor: item?.due_anchor ?? ("month_day" as DueAnchor),
    due_day: item?.due_day != null ? String(item.due_day) : "4",
    first_due_month:
      item?.first_due_month != null ? String(item.first_due_month) : "2",
    first_due_year:
      item?.first_due_year != null ? String(item.first_due_year) : "",
    fixed_due_date: item?.fixed_due_date ?? "",
    arrival_offset_days:
      item?.arrival_offset_days != null ? String(item.arrival_offset_days) : "0",
    generation_rule:
      item?.generation_rule ?? ("preceding_month_15th" as GenerationRule),
    generation_fixed_date: item?.generation_fixed_date ?? "",
    generation_lead_days:
      item?.generation_lead_days != null
        ? String(item.generation_lead_days)
        : "",
    notes: item?.notes ?? "",
  });

  const set = (patch: Partial<typeof form>) =>
    setForm((p) => ({ ...p, ...patch }));

  async function save() {
    if (!form.label) {
      toast.error("Label is required");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/finance/school-fees/charge-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_id: courseId,
          tier,
          charge_type: form.charge_type,
          label: form.label,
          amount_zar: Number(form.amount_zar) || 0,
          xero_item_code: form.xero_item_code || null,
          cadence: form.cadence,
          quantity: Number(form.quantity) || 1,
          due_anchor: form.due_anchor,
          due_day: form.due_day ? Number(form.due_day) : null,
          first_due_month: form.first_due_month
            ? Number(form.first_due_month)
            : null,
          first_due_year: form.first_due_year
            ? Number(form.first_due_year)
            : null,
          fixed_due_date: form.fixed_due_date || null,
          arrival_offset_days: form.arrival_offset_days
            ? Number(form.arrival_offset_days)
            : null,
          generation_rule: form.generation_rule,
          generation_fixed_date: form.generation_fixed_date || null,
          generation_lead_days: form.generation_lead_days
            ? Number(form.generation_lead_days)
            : null,
          notes: form.notes || null,
        }),
      });
      if (res.ok) {
        toast.success("Charge saved");
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

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {item ? "Edit charge" : "Add charge"} · Tier {tier}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Charge type</Label>
              <Select
                value={form.charge_type}
                onValueChange={(v) => {
                  const ct = v as ChargeType;
                  set({
                    charge_type: ct,
                    label: form.label || CHARGE_TYPE_META[ct].label,
                  });
                }}
                disabled={!!item}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHARGE_TYPES.map((ct) => (
                    <SelectItem key={ct} value={ct}>
                      {CHARGE_TYPE_META[ct].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Label</Label>
              <Input
                value={form.label}
                onChange={(e) => set({ label: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount (ZAR, per occurrence)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.amount_zar}
                onChange={(e) => set({ amount_zar: e.target.value })}
              />
            </div>
            <div>
              <Label>Xero item code</Label>
              <Input
                value={form.xero_item_code}
                placeholder="FFXYL2027-MON-A"
                onChange={(e) => set({ xero_item_code: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Cadence</Label>
              <Select
                value={form.cadence}
                onValueChange={(v) => set({ cadence: v as "once" | "monthly" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="once">Once</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.cadence === "monthly" && (
              <div>
                <Label># of occurrences</Label>
                <Input
                  type="number"
                  min="1"
                  value={form.quantity}
                  onChange={(e) => set({ quantity: e.target.value })}
                />
              </div>
            )}
          </div>

          <div className="rounded-md border p-3 space-y-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              When is it due?
            </p>
            <div>
              <Label>Due anchor</Label>
              <Select
                value={form.due_anchor}
                onValueChange={(v) => set({ due_anchor: v as DueAnchor })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DUE_ANCHORS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {DUE_ANCHOR_LABELS[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.due_anchor === "month_day" && (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Due day</Label>
                  <Input
                    type="number"
                    min="1"
                    max="31"
                    value={form.due_day}
                    onChange={(e) => set({ due_day: e.target.value })}
                  />
                </div>
                <div>
                  <Label>First month</Label>
                  <Input
                    type="number"
                    min="1"
                    max="12"
                    value={form.first_due_month}
                    onChange={(e) => set({ first_due_month: e.target.value })}
                  />
                </div>
                <div>
                  <Label>First year</Label>
                  <Input
                    type="number"
                    placeholder="2027"
                    value={form.first_due_year}
                    onChange={(e) => set({ first_due_year: e.target.value })}
                  />
                </div>
              </div>
            )}

            {form.due_anchor === "fixed_date" && (
              <div>
                <Label>Fixed due date</Label>
                <Input
                  type="date"
                  value={form.fixed_due_date}
                  onChange={(e) => set({ fixed_due_date: e.target.value })}
                />
              </div>
            )}

            {form.due_anchor === "relative_to_arrival" && (
              <div>
                <Label>Days relative to arrival (−30 = month before)</Label>
                <Input
                  type="number"
                  value={form.arrival_offset_days}
                  onChange={(e) => set({ arrival_offset_days: e.target.value })}
                />
              </div>
            )}
          </div>

          <div className="rounded-md border p-3 space-y-3">
            <p className="text-xs font-medium uppercase text-muted-foreground">
              When is the invoice generated?
            </p>
            <div>
              <Label>Generation rule</Label>
              <Select
                value={form.generation_rule}
                onValueChange={(v) =>
                  set({ generation_rule: v as GenerationRule })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GENERATION_RULES.map((g) => (
                    <SelectItem key={g} value={g}>
                      {GENERATION_RULE_LABELS[g]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.generation_rule === "fixed_date" && (
              <div>
                <Label>Generation date</Label>
                <Input
                  type="date"
                  value={form.generation_fixed_date}
                  onChange={(e) => set({ generation_fixed_date: e.target.value })}
                />
              </div>
            )}

            {form.generation_rule === "days_before_due" && (
              <div>
                <Label>Days before due</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.generation_lead_days}
                  onChange={(e) => set({ generation_lead_days: e.target.value })}
                />
              </div>
            )}
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={loading}>
            {loading ? "Saving..." : "Save charge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
