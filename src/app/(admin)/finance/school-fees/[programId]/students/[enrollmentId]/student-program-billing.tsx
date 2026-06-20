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
import { Loader2, Eye, Save, AlertTriangle } from "lucide-react";
import {
  PAYMENT_PREFERENCE_LABELS,
  CHARGE_TYPE_META,
  formatZAR,
} from "@/lib/finance/billing";
import type { Tier } from "@/services/school-billing";

type Course = {
  id: string;
  code: string;
  name: string;
  scope: "full_program" | "segment";
  sequence: number;
  arrival_date: string | null;
  fee_charge_items: { id: string }[] | null;
};

type Plan = {
  course_id: string | null;
  tier: Tier;
  payment_preference: "standard" | "quarter_prepay" | "full_prepay";
  student_billing_schedule: unknown[] | null;
};

type Preference = "standard" | "quarter_prepay" | "full_prepay";

type PreviewRow = {
  charge_type: string;
  label: string;
  amount_zar: number;
  xero_item_code: string | null;
  scheduled_generation_date: string;
  due_date: string;
  combined_group_key: string | null;
  phase: string;
};

const fmtDate = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export function StudentProgramBilling({
  enrollmentId,
  nationality,
  hasWholeProgram,
  courses,
  plans,
}: {
  enrollmentId: string;
  nationality: string | null;
  hasWholeProgram: boolean;
  courses: Course[];
  plans: Plan[];
}) {
  const router = useRouter();
  const segments = [...courses].sort((a, b) => a.sequence - b.sequence);

  const hasWholeProgramPlan = plans.some((p) => p.course_id == null);
  const existingSegmentIds = plans
    .map((p) => p.course_id)
    .filter((id): id is string => !!id);

  // Default mode: existing whole-program plan → whole; existing course plans
  // → individual; nothing yet → whole if available, else individual.
  const [mode, setMode] = useState<"whole_program" | "individual">(
    hasWholeProgramPlan
      ? "whole_program"
      : existingSegmentIds.length > 0
        ? "individual"
        : hasWholeProgram
          ? "whole_program"
          : "individual"
  );

  const [selectedSegments, setSelectedSegments] = useState<Set<string>>(
    new Set(existingSegmentIds)
  );

  const [tier, setTier] = useState<Tier | "auto">(plans[0]?.tier ?? "auto");
  const [preference, setPreference] = useState<Preference>(
    plans[0]?.payment_preference ?? "standard"
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{
    rows: PreviewRow[];
    perPhase: { course: { code: string; name: string }; total: number; count: number }[];
    grandTotal: number;
    tier: Tier;
    warnings: string[];
  } | null>(null);

  function toggleSegment(id: string) {
    setSelectedSegments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setPreview(null);
  }

  async function call(action: "preview" | "commit") {
    return fetch("/api/finance/school-fees/student-program-billing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enrollment_id: enrollmentId,
        whole_program: mode === "whole_program",
        course_ids: mode === "individual" ? [...selectedSegments] : [],
        tier: tier === "auto" ? undefined : tier,
        payment_preference: preference,
        action,
      }),
    });
  }

  async function runPreview() {
    setLoading(true);
    try {
      const res = await call("preview");
      const json = await res.json();
      if (res.ok) {
        setPreview({
          rows: json.rows,
          perPhase: json.perPhase,
          grandTotal: json.grandTotal,
          tier: json.tier,
          warnings: json.warnings ?? [],
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
      const res = await call("commit");
      const json = await res.json();
      if (res.ok) {
        toast.success(
          `Saved — ${json.phasesBilled} billed${json.phasesTrimmed ? `, ${json.phasesTrimmed} trimmed` : ""}`
        );
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

  const groups = new Map<string, PreviewRow[]>();
  (preview?.rows ?? []).forEach((r, i) => {
    const key = r.combined_group_key ? `${r.phase}:${r.combined_group_key}` : `solo-${i}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  });

  const canPreview =
    mode === "whole_program" ? hasWholeProgram : selectedSegments.size > 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 space-y-4">
          {/* Mode toggle */}
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground mb-1.5">
              Enrollment type
            </p>
            <div className="inline-flex rounded-md border p-0.5">
              <button
                className={`px-3 py-1.5 text-sm rounded ${mode === "whole_program" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                onClick={() => { setMode("whole_program"); setPreview(null); }}
                disabled={!hasWholeProgram}
              >
                Whole program
              </button>
              <button
                className={`px-3 py-1.5 text-sm rounded ${mode === "individual" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                onClick={() => { setMode("individual"); setPreview(null); }}
              >
                Individual course(s)
              </button>
            </div>
            {!hasWholeProgram && (
              <p className="text-[11px] text-yellow-700 mt-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> No whole-program pricing set up yet (Finance → this program).
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Tier</p>
              <Select value={tier} onValueChange={(v) => { setTier(v as Tier | "auto"); setPreview(null); }}>
                <SelectTrigger className="w-[150px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto{nationality ? ` (${nationality})` : " (country)"}</SelectItem>
                  <SelectItem value="A">Tier A</SelectItem>
                  <SelectItem value="B">Tier B</SelectItem>
                  <SelectItem value="C">Tier C</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Payment preference</p>
              <Select value={preference} onValueChange={(v) => { setPreference(v as Preference); setPreview(null); }}>
                <SelectTrigger className="w-[180px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PAYMENT_PREFERENCE_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Whole-program: uses program-level pricing; Individual: pick courses */}
          {mode === "whole_program" ? (
            <div className="rounded-md border bg-muted/20 p-3 text-sm flex items-center gap-2">
              <Badge variant="default" className="text-[10px]">whole program</Badge>
              <span className="text-muted-foreground">
                Billed from the program&apos;s whole-program pricing.
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Courses this student is doing
              </p>
              {segments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No individual courses set up.</p>
              ) : (
                segments.map((c) => {
                  const noCharges = (c.fee_charge_items?.length ?? 0) === 0;
                  return (
                    <label key={c.id} className="flex items-center gap-3 rounded-md border bg-card px-3 py-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedSegments.has(c.id)}
                        onChange={() => toggleSegment(c.id)}
                        className="h-4 w-4"
                      />
                      <span className="text-xs text-muted-foreground font-mono">#{c.sequence}</span>
                      <span className="font-medium text-sm">{c.name}</span>
                      <Badge variant="secondary" className="text-[10px]">{c.code}</Badge>
                      {noCharges && (
                        <span className="text-[10px] text-yellow-700 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> no charges configured
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={runPreview} disabled={loading || !canPreview}>
              {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Eye className="h-4 w-4 mr-1" />}
              Preview schedule
            </Button>
            <Button onClick={commit} disabled={saving || !canPreview}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Save billing
            </Button>
          </div>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            {preview.warnings.map((w, i) => (
              <p key={i} className="text-xs text-yellow-700 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> {w}
              </p>
            ))}
            <div className="flex flex-wrap gap-2">
              {preview.perPhase.map((p) => (
                <Badge key={p.course.code} variant="outline" className="text-xs">
                  {p.course.code}: {formatZAR(p.total)} ({p.count})
                </Badge>
              ))}
            </div>
            {preview.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No charges for this configuration.</p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Charge</TableHead>
                      <TableHead>Item code</TableHead>
                      <TableHead>Generate</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...groups.values()].flatMap((rows, gi) =>
                      rows.map((r, ri) => (
                        <TableRow key={`${gi}-${ri}`}>
                          <TableCell className="text-sm">
                            {r.label}
                            {rows.length > 1 && ri === 0 && (
                              <Badge variant="outline" className="ml-2 text-[10px]">combined</Badge>
                            )}
                            <span className="block text-[10px] text-muted-foreground">
                              {CHARGE_TYPE_META[r.charge_type as keyof typeof CHARGE_TYPE_META]?.label ?? r.charge_type}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">{r.xero_item_code ?? "—"}</TableCell>
                          <TableCell className="text-sm">{fmtDate(r.scheduled_generation_date)}</TableCell>
                          <TableCell className="text-sm">{fmtDate(r.due_date)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{formatZAR(Number(r.amount_zar))}</TableCell>
                        </TableRow>
                      ))
                    )}
                    <TableRow className="font-bold border-t-2">
                      <TableCell colSpan={4}>
                        Total · Tier {preview.tier} · {mode === "whole_program" ? "whole program" : "individual"}
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatZAR(preview.grandTotal)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
