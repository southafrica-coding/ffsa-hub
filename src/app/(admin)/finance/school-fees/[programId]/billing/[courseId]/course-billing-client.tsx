"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Eye,
  Save,
  AlertTriangle,
} from "lucide-react";
import {
  PAYMENT_PREFERENCE_LABELS,
  CHARGE_TYPE_META,
  formatZAR,
} from "@/lib/finance/billing";
import type { Tier } from "@/services/school-billing";

type Student = {
  id: string; // enrollment id
  user_id: string;
  status: string;
  enrolled_at: string;
  users: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    email: string | null;
    nationality: string | null;
  };
};

type ScheduleRow = {
  id?: string;
  charge_type: string;
  label: string;
  sequence: number;
  amount_zar: number;
  xero_item_code: string | null;
  scheduled_generation_date: string;
  due_date: string;
  combined_group_key: string | null;
  status?: string;
};

type Plan = {
  id: string;
  enrollment_id: string;
  tier: Tier;
  payment_preference: "standard" | "quarter_prepay" | "full_prepay";
  status: string;
  student_billing_schedule: ScheduleRow[] | null;
};

type Preference = "standard" | "quarter_prepay" | "full_prepay";

const studentName = (u: Student["users"]) =>
  `${u.preferred_name || u.first_name || ""} ${u.last_name || ""}`.trim() ||
  "Unknown";

const fmtDate = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export function CourseBillingClient({
  courseId,
  hasArrivalDate,
  configuredTiers,
  students,
  plans,
}: {
  courseId: string;
  hasArrivalDate: boolean;
  configuredTiers: string[];
  students: Student[];
  plans: Plan[];
}) {
  const planByEnrollment: Record<string, Plan> = {};
  for (const p of plans) planByEnrollment[p.enrollment_id] = p;

  if (configuredTiers.length === 0) {
    return (
      <div className="border border-amber-border bg-bone p-4 text-sm text-amber">
        No charge items are configured for this course yet. Add them on the
        course&apos;s billing page first, then come back to build student
        schedules.
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No active students enrolled in this program.
      </p>
    );
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="overflow-x-auto border border-ink">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Student</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Payment preference</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead className="w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((s) => (
                <StudentRow
                  key={s.id}
                  courseId={courseId}
                  hasArrivalDate={hasArrivalDate}
                  student={s}
                  plan={planByEnrollment[s.id] ?? null}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function StudentRow({
  courseId,
  hasArrivalDate,
  student,
  plan,
}: {
  courseId: string;
  hasArrivalDate: boolean;
  student: Student;
  plan: Plan | null;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [tier, setTier] = useState<Tier | "auto">(plan ? plan.tier : "auto");
  const [preference, setPreference] = useState<Preference>(
    plan?.payment_preference ?? "standard"
  );

  const savedRows = (plan?.student_billing_schedule ?? []).slice();
  const [preview, setPreview] = useState<{
    rows: ScheduleRow[];
    warnings: string[];
    tier: Tier;
    total: number;
  } | null>(null);

  const existingCount = savedRows.length;

  async function runPreview() {
    setLoading(true);
    setExpanded(true);
    try {
      const res = await fetch("/api/finance/school-fees/billing-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollment_id: student.id,
          course_id: courseId,
          tier: tier === "auto" ? undefined : tier,
          payment_preference: preference,
          action: "preview",
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setPreview({
          rows: json.rows,
          warnings: json.warnings ?? [],
          tier: json.tier,
          total: json.total,
        });
      } else {
        toast.error(json.error || "Preview failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function commit() {
    setSaving(true);
    try {
      const res = await fetch("/api/finance/school-fees/billing-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollment_id: student.id,
          course_id: courseId,
          tier: tier === "auto" ? undefined : tier,
          payment_preference: preference,
          action: "commit",
        }),
      });
      const json = await res.json();
      if (res.ok) {
        toast.success(
          `Schedule saved — ${json.rowCount} charge${json.rowCount !== 1 ? "s" : ""} (Tier ${json.tier})`
        );
        setPreview(null);
        router.refresh();
      } else {
        toast.error(json.error || "Save failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  const displayRows = preview?.rows ?? savedRows;

  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setExpanded((v) => !v)}>
        <TableCell>
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </TableCell>
        <TableCell className="font-medium">
          {studentName(student.users)}
          {student.users.nationality && (
            <span className="text-xs text-muted-foreground ml-2">
              {student.users.nationality}
            </span>
          )}
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Select value={tier} onValueChange={(v) => setTier(v as Tier | "auto")}>
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (country)</SelectItem>
              <SelectItem value="A">Tier A</SelectItem>
              <SelectItem value="B">Tier B</SelectItem>
              <SelectItem value="C">Tier C</SelectItem>
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Select
            value={preference}
            onValueChange={(v) => setPreference(v as Preference)}
          >
            <SelectTrigger className="w-[170px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PAYMENT_PREFERENCE_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell>
          {existingCount > 0 ? (
            <Badge variant="secondary" className="text-xs">
              {existingCount} scheduled
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">none</span>
          )}
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="outline" onClick={runPreview} disabled={loading}>
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Eye className="h-3 w-3 mr-1" />
            )}
            Preview
          </Button>
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow>
          <TableCell colSpan={6} className="bg-bone">
            <div className="p-3 space-y-3">
              {!hasArrivalDate && (
                <p className="text-xs text-amber flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  No arrival date set for this course — quarter payments
                  (relative-to-arrival) can&apos;t be scheduled until you set one.
                </p>
              )}

              {preview?.warnings?.map((w, i) => (
                <p
                  key={i}
                  className="text-xs text-amber flex items-center gap-1"
                >
                  <AlertTriangle className="h-3 w-3" /> {w}
                </p>
              ))}

              {displayRows.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  {preview
                    ? "No charges produced for this configuration."
                    : "No saved schedule yet. Click Preview to build one."}
                </p>
              ) : (
                <ScheduleTable rows={displayRows} isPreview={!!preview} />
              )}

              {preview && (
                <div className="flex items-center justify-between pt-2 border-t">
                  <p className="text-sm">
                    Total:{" "}
                    <span className="font-mono font-medium">
                      {formatZAR(preview.total)}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      · Tier {preview.tier} · {preview.rows.length} charges
                    </span>
                  </p>
                  <Button size="sm" onClick={commit} disabled={saving}>
                    {saving ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Save className="h-3 w-3 mr-1" />
                    )}
                    {existingCount > 0 ? "Replace saved schedule" : "Save schedule"}
                  </Button>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function ScheduleTable({
  rows,
  isPreview,
}: {
  rows: ScheduleRow[];
  isPreview: boolean;
}) {
  const groups = new Map<string, ScheduleRow[]>();
  rows.forEach((r, i) => {
    const key = r.combined_group_key ?? `solo-${i}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  });

  return (
    <div className="overflow-x-auto border border-ink">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Charge</TableHead>
            <TableHead>Item code</TableHead>
            <TableHead>Generate</TableHead>
            <TableHead>Due</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            {!isPreview && <TableHead>Status</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...groups.values()].flatMap((groupRows, gi) =>
            groupRows.map((r, ri) => {
              const combined = groupRows.length > 1;
              return (
                <TableRow key={`${gi}-${ri}`}>
                  <TableCell className="text-sm">
                    {r.label}
                    {combined && ri === 0 && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        combined invoice
                      </Badge>
                    )}
                    <span className="block text-[10px] text-muted-foreground">
                      {CHARGE_TYPE_META[
                        r.charge_type as keyof typeof CHARGE_TYPE_META
                      ]?.label ?? r.charge_type}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {r.xero_item_code ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {fmtDate(r.scheduled_generation_date)}
                  </TableCell>
                  <TableCell className="text-sm">{fmtDate(r.due_date)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatZAR(Number(r.amount_zar))}
                  </TableCell>
                  {!isPreview && (
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        {r.status ?? "scheduled"}
                      </Badge>
                    </TableCell>
                  )}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
