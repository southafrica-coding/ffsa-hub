"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Sparkles,
  Calendar,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  CHARGE_TYPE_META,
  DUE_ANCHOR_LABELS,
  GENERATION_RULE_LABELS,
  TIERS,
  FFX_2027_TEMPLATE,
  formatZAR,
} from "@/lib/finance/billing";
import type {
  ChargeType,
  DueAnchor,
  GenerationRule,
  Tier,
} from "@/services/school-billing";

// ────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────

type ProgramGroup = {
  id: string;
  name: string;
  code: string;
  year: number | null;
  description: string | null;
  status: string;
  programs: { id: string; name: string; code: string; status: string }[] | null;
};

type Course = {
  id: string;
  name: string;
  code: string;
  status: string;
  program_group_id: string | null;
  billing_arrival_date: string | null;
  billing_start_date: string | null;
  program_groups: { id: string; name: string; code: string; year: number | null } | null;
  fee_charge_items: { id: string }[] | null;
};

type ChargeItem = {
  id: string;
  program_id: string;
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

// ────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────

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
        off === 0 ? "on arrival" : `${Math.abs(off)} days ${off < 0 ? "before" : "after"} arrival`;
      return `${occ} · due ${when}`;
    }
    default:
      return occ;
  }
}

// ────────────────────────────────────────────────────────────
// ROOT
// ────────────────────────────────────────────────────────────

export function BillingSetupClient({
  groups,
  courses,
  itemsByProgram,
}: {
  groups: ProgramGroup[];
  courses: Course[];
  itemsByProgram: Record<string, ChargeItem[]>;
}) {
  return (
    <div className="space-y-8">
      <ProgramGroupsSection groups={groups} />
      <CoursesSection
        courses={courses}
        groups={groups}
        itemsByProgram={itemsByProgram}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// PROGRAM GROUPS
// ────────────────────────────────────────────────────────────

function ProgramGroupsSection({ groups }: { groups: ProgramGroup[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProgramGroup | null>(null);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Programs</h2>
          <p className="text-xs text-muted-foreground">
            The umbrella each set of courses rolls up into (e.g. FFX 2027).
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" /> New Program
        </Button>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          No programs yet. Create one to group your courses.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <Card key={g.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{g.name}</CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      setEditing(g);
                      setOpen(true);
                    }}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {g.code}
                  </Badge>
                  {g.year && (
                    <Badge variant="outline" className="text-xs">
                      {g.year}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {g.programs?.length ?? 0} course
                  {(g.programs?.length ?? 0) !== 1 ? "s" : ""} linked
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ProgramGroupDialog
        open={open}
        onOpenChange={setOpen}
        group={editing}
      />
    </section>
  );
}

function ProgramGroupDialog({
  open,
  onOpenChange,
  group,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  group: ProgramGroup | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: group?.name ?? "",
    code: group?.code ?? "",
    year: group?.year ? String(group.year) : "",
    description: group?.description ?? "",
  });

  // Reset form whenever the dialog target changes
  const [lastId, setLastId] = useState<string | null>(group?.id ?? null);
  if (open && (group?.id ?? null) !== lastId) {
    setLastId(group?.id ?? null);
    setForm({
      name: group?.name ?? "",
      code: group?.code ?? "",
      year: group?.year ? String(group.year) : "",
      description: group?.description ?? "",
    });
  }

  async function save() {
    if (!form.name || !form.code) {
      toast.error("Name and code are required");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/finance/school-fees/program-groups", {
        method: group ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: group?.id,
          name: form.name,
          code: form.code,
          year: form.year ? Number(form.year) : null,
          description: form.description || null,
        }),
      });
      if (res.ok) {
        toast.success(group ? "Program updated" : "Program created");
        onOpenChange(false);
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{group ? "Edit Program" : "New Program"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input
              value={form.name}
              placeholder="FFX Year Long"
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Code</Label>
              <Input
                value={form.code}
                placeholder="FFX2027"
                onChange={(e) =>
                  setForm((p) => ({ ...p, code: e.target.value }))
                }
              />
            </div>
            <div>
              <Label>Year</Label>
              <Input
                type="number"
                value={form.year}
                placeholder="2027"
                onChange={(e) =>
                  setForm((p) => ({ ...p, year: e.target.value }))
                }
              />
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              value={form.description}
              rows={2}
              onChange={(e) =>
                setForm((p) => ({ ...p, description: e.target.value }))
              }
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={loading}>
            {loading ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────
// COURSES + CHARGE ITEMS
// ────────────────────────────────────────────────────────────

function CoursesSection({
  courses,
  groups,
  itemsByProgram,
}: {
  courses: Course[];
  groups: ProgramGroup[];
  itemsByProgram: Record<string, ChargeItem[]>;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Courses & Charge Items</h2>
        <p className="text-xs text-muted-foreground">
          Each course (FFXYL, FFXQ, …) and its per-tier charge items. Link a
          course to a program, set arrival/start dates, and configure charges.
        </p>
      </div>

      {courses.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          No courses found. Create programs (courses) under Schools first.
        </p>
      ) : (
        <div className="space-y-3">
          {courses.map((course) => (
            <CourseCard
              key={course.id}
              course={course}
              groups={groups}
              items={itemsByProgram[course.id] ?? []}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CourseCard({
  course,
  groups,
  items,
}: {
  course: Course;
  groups: ProgramGroup[];
  items: ChargeItem[];
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [arrival, setArrival] = useState(course.billing_arrival_date ?? "");
  const [start, setStart] = useState(course.billing_start_date ?? "");

  const hasTemplate = !!FFX_2027_TEMPLATE[course.code];

  async function saveCourseBilling(patch: Record<string, unknown>) {
    setSavingMeta(true);
    try {
      const res = await fetch("/api/finance/school-fees/course-billing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program_id: course.id, ...patch }),
      });
      if (res.ok) {
        toast.success("Course billing updated");
        router.refresh();
      } else {
        const { error } = await res.json();
        toast.error(error || "Failed to update");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSavingMeta(false);
    }
  }

  async function loadTemplate() {
    const template = FFX_2027_TEMPLATE[course.code];
    if (!template) return;
    setSeeding(true);
    try {
      const all = TIERS.flatMap((tier) =>
        (template[tier] ?? []).map((item) => ({ ...item, program_id: course.id }))
      );
      for (const item of all) {
        const res = await fetch("/api/finance/school-fees/charge-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        });
        if (!res.ok) {
          const { error } = await res.json();
          throw new Error(error || "Failed");
        }
      }
      toast.success(`Loaded FFX 2027 template for ${course.code}`);
      setExpanded(true);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load template");
    } finally {
      setSeeding(false);
    }
  }

  const itemCount = items.length;

  return (
    <Card>
      <CardContent className="pt-4 space-y-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <button
            className="flex items-center gap-2 text-left"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0" />
            )}
            <div>
              <p className="font-semibold">
                {course.name}{" "}
                <Badge variant="secondary" className="text-xs ml-1">
                  {course.code}
                </Badge>
              </p>
              <p className="text-xs text-muted-foreground">
                {itemCount} charge item{itemCount !== 1 ? "s" : ""}
                {course.program_groups
                  ? ` · ${course.program_groups.name}`
                  : " · no program"}
              </p>
            </div>
          </button>

          {hasTemplate && itemCount === 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={loadTemplate}
              disabled={seeding}
            >
              {seeding ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-1" />
              )}
              Load FFX 2027
            </Button>
          )}
        </div>

        {expanded && (
          <div className="space-y-4 pl-6">
            {/* Course billing meta */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label className="text-xs">Program</Label>
                <Select
                  value={course.program_group_id ?? "none"}
                  onValueChange={(v) =>
                    saveCourseBilling({
                      program_group_id: v === "none" ? null : v,
                    })
                  }
                  disabled={savingMeta}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Arrival date
                </Label>
                <Input
                  type="date"
                  value={arrival}
                  className="h-9"
                  onChange={(e) => setArrival(e.target.value)}
                  onBlur={() => {
                    if (arrival !== (course.billing_arrival_date ?? ""))
                      saveCourseBilling({ billing_arrival_date: arrival });
                  }}
                />
              </div>
              <div>
                <Label className="text-xs flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Start date
                </Label>
                <Input
                  type="date"
                  value={start}
                  className="h-9"
                  onChange={(e) => setStart(e.target.value)}
                  onBlur={() => {
                    if (start !== (course.billing_start_date ?? ""))
                      saveCourseBilling({ billing_start_date: start });
                  }}
                />
              </div>
            </div>

            {/* Charge items per tier */}
            <ChargeItemsEditor programId={course.id} items={items} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────
// CHARGE ITEMS EDITOR (tabs A/B/C)
// ────────────────────────────────────────────────────────────

function ChargeItemsEditor({
  programId,
  items,
}: {
  programId: string;
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
              sum + Number(it.amount_zar) * (it.cadence === "monthly" ? it.quantity : 1),
            0
          );
          return (
            <TabsContent key={tier} value={tier} className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Program total (Tier {tier}):{" "}
                  <span className="font-mono font-medium">
                    {formatZAR(total)}
                  </span>
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
          programId={programId}
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
        <span className="font-mono text-sm">{formatZAR(Number(item.amount_zar))}</span>
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

// ────────────────────────────────────────────────────────────
// CHARGE ITEM DIALOG (add / edit — all fields editable)
// ────────────────────────────────────────────────────────────

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
  programId,
  tier,
  item,
  onClose,
}: {
  programId: string;
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
          program_id: programId,
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
                onValueChange={(v) =>
                  set({ cadence: v as "once" | "monthly" })
                }
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

          {/* DUE rules */}
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

          {/* GENERATION rules */}
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
                  onChange={(e) =>
                    set({ generation_fixed_date: e.target.value })
                  }
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
                  onChange={(e) =>
                    set({ generation_lead_days: e.target.value })
                  }
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
