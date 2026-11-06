"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "next/link";
import {
  Edit2,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { Masthead, KpiStrip, NeedsYou, StatusPill } from "@/components/ffsa";
import { MoneyKpi, barTone } from "../../money-kpi";
import { RecordPaymentDialog } from "./record-payment-dialog";

// ─────────────────────────────────��──────────────────────────
// TYPES
// ────────────────────────────────────��───────────────────────

type Program = {
  id: string;
  name: string;
  code: string;
};

type FeeStructure = {
  id: string;
  program_id: string;
  tier: string;
  tuition_zar: number;
  accommodation_zar: number;
  meals_zar: number;
  materials_zar: number;
  total_zar: number;
  notes: string | null;
};

type StudentFee = {
  id: string;
  enrollment_id: string;
  user_id: string;
  program_id: string;
  tier: string;
  tier_override: boolean;
  tuition_zar: number;
  accommodation_zar: number;
  meals_zar: number;
  materials_zar: number;
  total_due_zar: number;
  discount_zar: number;
  scholarship_zar: number;
  final_amount_zar: number;
  amount_paid_zar: number;
  status: string;
  notes: string | null;
  users: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    email: string | null;
    nationality: string | null;
  };
  enrollments: { status: string };
};

type EnrolledStudent = {
  id: string;
  user_id: string;
  status: string;
  users: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
    nationality: string | null;
  };
};

type Payment = {
  id: string;
  student_fee_id: string;
  payment_date: string;
  amount_zar: number;
  payment_method: string;
  reference: string | null;
  currency_paid: string | null;
  currency_amount: number | null;
  exchange_rate: number | null;
  notes: string | null;
  created_at: string;
  student_fees: {
    user_id: string;
    program_id: string;
    users: {
      id: string;
      first_name: string | null;
      last_name: string | null;
      preferred_name: string | null;
    };
  };
};

type Summary = {
  totalStudents: number;
  totalDue: number;
  totalPaid: number;
  totalOutstanding: number;
  byStatus: Record<string, number>;
};

// ───────────────────────────────��────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(amount);

// Fee status maps onto the four StatusPill tones — no filled colour chips.
const STATUS_TONES: Record<string, "good" | "warn" | "quiet" | "bad"> = {
  pending: "quiet",
  partially_paid: "warn",
  paid: "good",
  overdue: "bad",
  waived: "quiet",
};

const TIER_LABELS: Record<string, string> = {
  A: "Tier A — Full Price",
  B: "Tier B — Reduced",
  C: "Tier C — Heavily Reduced",
};

const studentName = (u: {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}) => {
  const first = u.first_name || "";
  return `${first} ${u.last_name || ""}`.trim() || "Unknown";
};

// ──────────────────────────────────��─────────────────────────
// COMPONENT
// ───────────────────────────────────────────────��────────────

export function ProgramFeesDetail({
  program,
  feeStructures,
  studentFees,
  payments,
  studentsWithoutFees,
  summary,
}: {
  program: Program;
  feeStructures: FeeStructure[];
  studentFees: StudentFee[];
  countryTiers: unknown[];
  payments: Payment[];
  studentsWithoutFees: EnrolledStudent[];
  summary: Summary;
}) {
  const router = useRouter();
  const [expandedFees, setExpandedFees] = useState<Set<string>>(new Set());

  const structureByTier: Record<string, FeeStructure> = {};
  for (const fs of feeStructures) {
    structureByTier[fs.tier] = fs;
  }

  // Build lookup: enrollment_id → StudentFee
  const feeByEnrollment: Record<string, StudentFee> = {};
  for (const sf of studentFees) {
    feeByEnrollment[sf.enrollment_id] = sf;
  }

  // Group payments by student_fee_id for inline history
  const paymentsByFee: Record<string, Payment[]> = {};
  for (const p of payments) {
    if (!paymentsByFee[p.student_fee_id]) {
      paymentsByFee[p.student_fee_id] = [];
    }
    paymentsByFee[p.student_fee_id].push(p);
  }

  const toggleExpand = (id: string) => {
    setExpandedFees((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Unified student list: everyone enrolled
  const allStudents = [
    ...studentFees.map((sf) => ({
      enrollmentId: sf.enrollment_id,
      userId: sf.user_id,
      name: studentName(sf.users),
      nationality: sf.users.nationality,
      fee: sf as StudentFee | null,
    })),
    ...studentsWithoutFees
      .filter((s) => !feeByEnrollment[s.id])
      .map((s) => ({
        enrollmentId: s.id,
        userId: s.user_id,
        name: studentName(s.users),
        nationality: s.users.nationality,
        fee: null as StudentFee | null,
      })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const totalEnrolled = allStudents.length;
  const withFees = studentFees.length;
  const withoutFees = totalEnrolled - withFees;

  const collectedPct =
    summary.totalDue > 0 ? (summary.totalPaid / summary.totalDue) * 100 : 0;
  const owedPct = Math.max(0, 100 - collectedPct);

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`School fees · ${program.code}`}
        title={program.name}
        actions={
          <Link
            href={`/finance/school-fees/${program.id}/billing`}
            className="inline-block shrink-0 border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white"
          >
            Billing schedules &rarr;
          </Link>
        }
      />

      {/* The page's ONE yellow band. Never add a second. */}
      {withoutFees > 0 && (
        <NeedsYou>
          {withoutFees === 1
            ? "1 enrolled student has no fees assigned yet"
            : `${withoutFees} enrolled students have no fees assigned yet`}
        </NeedsYou>
      )}

      <div className="space-y-6 px-5 py-6 md:px-8 md:py-7">
        <p className="text-[13px] text-[color:var(--text-secondary)]">
          Fee structures and student payments.
        </p>

        {/* Summary strip */}
        <div className="border-x border-t border-ink">
          <KpiStrip>
            <MoneyKpi
              lead
              label="Students"
              value={String(summary.totalStudents)}
              pct={totalEnrolled > 0 ? (summary.totalStudents / totalEnrolled) * 100 : 0}
              foot={
                withoutFees > 0
                  ? `of ${totalEnrolled} enrolled — ${withoutFees} without fees`
                  : `of ${totalEnrolled} enrolled`
              }
            />
            <MoneyKpi label="Total due" value={formatCurrency(summary.totalDue)} />
            <MoneyKpi
              positive
              label="Collected"
              value={formatCurrency(summary.totalPaid)}
              pct={collectedPct}
              tone="var(--green)"
              foot={`${collectedPct.toFixed(0)}% of total due`}
            />
            <MoneyKpi
              label="Outstanding"
              value={formatCurrency(summary.totalOutstanding)}
              negative={summary.totalOutstanding > 0}
              pct={owedPct}
              tone={barTone(owedPct)}
              foot={`${owedPct.toFixed(0)}% still owed`}
            />
          </KpiStrip>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="structures">
        <TabsList className="w-full overflow-x-auto justify-start">
          <TabsTrigger value="structures">Fee Structures</TabsTrigger>
          <TabsTrigger value="students">
            Students ({totalEnrolled})
          </TabsTrigger>
          <TabsTrigger value="payments">
            Payments ({payments.length})
          </TabsTrigger>
        </TabsList>

        {/* Fee Structures Tab */}
        <TabsContent value="structures" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(["A", "B", "C"] as const).map((tier) => {
              const structure = structureByTier[tier];
              return (
                <TierCard
                  key={tier}
                  tier={tier}
                  structure={structure}
                  programId={program.id}
                />
              );
            })}
          </div>
        </TabsContent>

        {/* Students Tab — unified list of ALL enrolled students */}
        <TabsContent value="students" className="mt-4 space-y-4">
          {/* The count itself is the page's NeedsYou band, above; this is only
              the instruction that goes with it. */}
          {withoutFees > 0 && (
            <p className="border border-rule-strong bg-bone p-3 text-[13px] text-[color:var(--text-secondary)]">
              Select a tier from the dropdown to assign fees.
            </p>
          )}

          {allStudents.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-[color:var(--text-tertiary)]">
              No students enrolled in this program yet.
            </p>
          ) : (
            <div className="overflow-x-auto border border-ink">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Student</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead className="text-right">Total Due</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[100px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allStudents.map((row) => {
                    if (row.fee) {
                      // ── Student WITH fee record ──
                      const fee = row.fee;
                      const balance =
                        Number(fee.final_amount_zar) -
                        Number(fee.amount_paid_zar);
                      const isExpanded = expandedFees.has(fee.id);

                      return (
                        <StudentFeeRow
                          key={fee.id}
                          fee={fee}
                          balance={balance}
                          isExpanded={isExpanded}
                          onToggle={() => toggleExpand(fee.id)}
                          paymentHistory={paymentsByFee[fee.id] ?? []}
                          feeStructures={feeStructures}
                        />
                      );
                    } else {
                      // ── Student WITHOUT fee — show tier selector ──
                      return (
                        <UnassignedStudentRow
                          key={row.enrollmentId}
                          enrollmentId={row.enrollmentId}
                          userId={row.userId}
                          name={row.name}
                          programId={program.id}
                          feeStructures={feeStructures}
                        />
                      );
                    }
                  })}
                  {/* Totals */}
                  {withFees > 0 && (
                    <TableRow className="font-bold border-t-2">
                      <TableCell colSpan={3}>Total</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(summary.totalDue)}
                      </TableCell>
                      <TableCell className="text-right tabular font-mono text-[color:var(--green-text)]">
                        {formatCurrency(summary.totalPaid)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-destructive">
                        {formatCurrency(summary.totalOutstanding)}
                      </TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* Payments Tab */}
        <TabsContent value="payments" className="mt-4">
          {payments.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-[color:var(--text-tertiary)]">
              No payments recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto border border-ink">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead className="text-right">Amount (ZAR)</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => {
                    const pStudentName = p.student_fees?.users
                      ? studentName(p.student_fees.users)
                      : "Unknown";
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="text-sm">
                          {new Date(p.payment_date).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="font-medium text-sm">
                          {pStudentName}
                        </TableCell>
                        <TableCell className="text-right tabular font-mono text-sm text-[color:var(--green-text)]">
                          {formatCurrency(Number(p.amount_zar))}
                        </TableCell>
                        <TableCell>
                          <StatusPill>
                            {p.payment_method.toUpperCase()}
                          </StatusPill>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {p.reference ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {p.currency_paid && p.currency_paid !== "ZAR"
                            ? `${p.currency_paid} ${Number(p.currency_amount).toFixed(2)}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {p.notes ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {/* Totals Row */}
                  <TableRow className="font-bold border-t-2">
                    <TableCell>Total</TableCell>
                    <TableCell>{payments.length} payments</TableCell>
                    <TableCell className="text-right tabular font-mono text-[color:var(--green-text)]">
                      {formatCurrency(
                        payments.reduce(
                          (sum, p) => sum + Number(p.amount_zar),
                          0
                        )
                      )}
                    </TableCell>
                    <TableCell colSpan={4} />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ──���───────────���─────────────────────────────────────────────
// STUDENT FEE ROW — student who already has a fee assigned
// ─────��─────────────────────────��────────────────────────��───

function StudentFeeRow({
  fee,
  balance,
  isExpanded,
  onToggle,
  paymentHistory,
  feeStructures,
}: {
  fee: StudentFee;
  balance: number;
  isExpanded: boolean;
  onToggle: () => void;
  paymentHistory: Payment[];
  feeStructures: FeeStructure[];
}) {
  const router = useRouter();
  const [changingTier, setChangingTier] = useState(false);

  async function handleTierChange(newTier: string) {
    if (newTier === fee.tier) return;

    const structure = feeStructures.find((fs) => fs.tier === newTier);
    if (!structure) {
      toast.error(`Tier ${newTier} pricing not configured yet`);
      return;
    }

    setChangingTier(true);
    try {
      const res = await fetch("/api/finance/school-fees/student-fees", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: fee.id,
          tier: newTier,
          tier_override: true,
          tuition_zar: Number(structure.tuition_zar),
          accommodation_zar: Number(structure.accommodation_zar),
          meals_zar: Number(structure.meals_zar),
          materials_zar: Number(structure.materials_zar),
          total_due_zar: Number(structure.total_zar),
        }),
      });
      if (res.ok) {
        const result = await res.json();
        toast.success(`Moved ${studentName(fee.users)} to Tier ${newTier}`);
        if (result.xero?.invoiceId) {
          toast.success(`New Xero invoice sent to ${studentName(fee.users)}`);
        } else if (result.xero?.error) {
          toast.error(`Xero invoice failed: ${result.xero.error}`);
        }
        if (result.xero?.voidedOld) {
          toast.info("Previous invoice has been voided in Xero");
        }
        router.refresh();
      } else {
        const { error } = await res.json();
        toast.error(error || "Failed to update tier");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setChangingTier(false);
    }
  }

  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell>
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </TableCell>
        <TableCell className="font-medium">
          {studentName(fee.users)}
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Select
            value={fee.tier}
            onValueChange={handleTierChange}
            disabled={changingTier}
          >
            <SelectTrigger className="w-[110px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="A">Tier A</SelectItem>
              <SelectItem value="B">Tier B</SelectItem>
              <SelectItem value="C">Tier C</SelectItem>
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell className="text-right font-mono text-sm">
          {formatCurrency(Number(fee.final_amount_zar))}
        </TableCell>
        <TableCell className="text-right tabular font-mono text-sm text-[color:var(--green-text)]">
          {formatCurrency(Number(fee.amount_paid_zar))}
        </TableCell>
        <TableCell
          className={`text-right font-mono text-sm ${
            balance > 0 ? "text-destructive" : ""
          }`}
        >
          {formatCurrency(balance)}
        </TableCell>
        <TableCell>
          <StatusPill tone={STATUS_TONES[fee.status] ?? "quiet"}>
            {fee.status.replace(/_/g, " ")}
          </StatusPill>
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <RecordPaymentDialog
            studentFeeId={fee.id}
            studentName={studentName(fee.users)}
            balance={balance}
          />
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={8} className="bg-bone">
            <div className="p-3 space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Tuition:</span>{" "}
                  <span className="tabular font-mono">
                    {formatCurrency(Number(fee.tuition_zar))}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Accommodation:</span>{" "}
                  <span className="tabular font-mono">
                    {formatCurrency(Number(fee.accommodation_zar))}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Meals:</span>{" "}
                  <span className="tabular font-mono">
                    {formatCurrency(Number(fee.meals_zar))}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Materials:</span>{" "}
                  <span className="tabular font-mono">
                    {formatCurrency(Number(fee.materials_zar))}
                  </span>
                </div>
              </div>
              {(Number(fee.discount_zar) > 0 ||
                Number(fee.scholarship_zar) > 0) && (
                <div className="flex gap-4 text-sm">
                  {Number(fee.discount_zar) > 0 && (
                    <span className="text-[color:var(--green-text)]">
                      Discount: -{formatCurrency(Number(fee.discount_zar))}
                    </span>
                  )}
                  {Number(fee.scholarship_zar) > 0 && (
                    <span className="text-[color:var(--green-text)]">
                      Scholarship: -
                      {formatCurrency(Number(fee.scholarship_zar))}
                    </span>
                  )}
                </div>
              )}

              {/* Inline payment history */}
              {paymentHistory.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Payment History
                  </p>
                  <div className="space-y-1">
                    {paymentHistory.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between text-xs py-1 border-b border-muted last:border-0"
                      >
                        <div className="flex items-center gap-2">
                          <span>
                            {new Date(p.payment_date).toLocaleDateString()}
                          </span>
                          <StatusPill>
                            {p.payment_method.toUpperCase()}
                          </StatusPill>
                          {p.reference && (
                            <span className="text-muted-foreground">
                              {p.reference}
                            </span>
                          )}
                          {p.currency_paid &&
                            p.currency_paid !== "ZAR" && (
                              <span className="text-muted-foreground">
                                ({p.currency_paid}{" "}
                                {Number(p.currency_amount).toFixed(2)})
                              </span>
                            )}
                        </div>
                        <span className="tabular font-mono text-[color:var(--green-text)]">
                          {formatCurrency(Number(p.amount_zar))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────
// UNASSIGNED STUDENT ROW — pick a tier to assign fees
// ─────────���────────────────────────��─────────────────────────

function UnassignedStudentRow({
  enrollmentId,
  userId,
  name,
  programId,
  feeStructures,
}: {
  enrollmentId: string;
  userId: string;
  name: string;
  programId: string;
  feeStructures: FeeStructure[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleTierSelect(tier: string) {
    const structure = feeStructures.find((fs) => fs.tier === tier);
    if (!structure) {
      toast.error(`Tier ${tier} pricing not configured yet. Set it up in Fee Structures first.`);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/finance/school-fees/student-fees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollment_id: enrollmentId,
          user_id: userId,
          program_id: programId,
          tier,
          tier_override: true,
          tuition_zar: Number(structure.tuition_zar),
          accommodation_zar: Number(structure.accommodation_zar),
          meals_zar: Number(structure.meals_zar),
          materials_zar: Number(structure.materials_zar),
          total_due_zar: Number(structure.total_zar),
        }),
      });

      if (res.ok) {
        const result = await res.json();
        toast.success(`Fee assigned to ${name} (Tier ${tier})`);
        if (result.xero?.success) {
          toast.success(`Xero invoice sent to ${name}`);
        } else if (result.xero?.error) {
          toast.error(`Xero invoice failed: ${result.xero.error}`);
        }
        router.refresh();
      } else {
        const { error } = await res.json();
        toast.error(error || "Failed to assign fee");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <TableRow className="bg-bone">
      <TableCell />
      <TableCell className="font-medium">
        {name}
      </TableCell>
      <TableCell>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Select onValueChange={handleTierSelect}>
            <SelectTrigger className="w-[130px] h-8 text-xs border-dashed">
              <SelectValue placeholder="Assign tier..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="A">Tier A — Full</SelectItem>
              <SelectItem value="B">Tier B — Reduced</SelectItem>
              <SelectItem value="C">Tier C — Low</SelectItem>
            </SelectContent>
          </Select>
        )}
      </TableCell>
      <TableCell className="text-right text-sm text-muted-foreground">—</TableCell>
      <TableCell className="text-right text-sm text-muted-foreground">—</TableCell>
      <TableCell className="text-right text-sm text-muted-foreground">—</TableCell>
      <TableCell>
        <StatusPill tone="warn">No fee</StatusPill>
      </TableCell>
      <TableCell />
    </TableRow>
  );
}

// ��──────────────���────────────────────────────���───────────────
// TIER CARD — shows fee structure for one tier
// ────���────────────────────────────────────────────────���──────

function TierCard({
  tier,
  structure,
  programId,
}: {
  tier: string;
  structure?: FeeStructure;
  programId: string;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    tuition_zar: structure ? String(structure.tuition_zar) : "0",
    accommodation_zar: structure ? String(structure.accommodation_zar) : "0",
    meals_zar: structure ? String(structure.meals_zar) : "0",
    materials_zar: structure ? String(structure.materials_zar) : "0",
  });

  const total =
    Number(form.tuition_zar || 0) +
    Number(form.accommodation_zar || 0) +
    Number(form.meals_zar || 0) +
    Number(form.materials_zar || 0);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/finance/school-fees/fee-structures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          program_id: programId,
          tier,
          tuition_zar: Number(form.tuition_zar),
          accommodation_zar: Number(form.accommodation_zar),
          meals_zar: Number(form.meals_zar),
          materials_zar: Number(form.materials_zar),
        }),
      });
      if (res.ok) {
        toast.success(`Tier ${tier} pricing saved`);
        setEditOpen(false);
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
    <div className="border border-ink bg-white">
      <div className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-[17px] font-black uppercase leading-none">
            {TIER_LABELS[tier]}
          </h3>
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <Edit2 className="h-3 w-3" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Tier {tier} Pricing</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSave} className="space-y-4">
                {(
                  [
                    ["tuition_zar", "Tuition"],
                    ["accommodation_zar", "Accommodation"],
                    ["meals_zar", "Meals"],
                    ["materials_zar", "Materials"],
                  ] as const
                ).map(([field, label]) => (
                  <div key={field}>
                    <Label>{label} (ZAR)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form[field]}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          [field]: e.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
                <div className="pt-2 border-t">
                  <p className="text-sm font-medium">
                    Total: {formatCurrency(total)}
                  </p>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={loading}>
                    {loading ? "Saving..." : "Save"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {structure ? (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tuition</span>
              <span className="tabular font-mono">
                {formatCurrency(Number(structure.tuition_zar))}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Accommodation</span>
              <span className="tabular font-mono">
                {formatCurrency(Number(structure.accommodation_zar))}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Meals</span>
              <span className="tabular font-mono">
                {formatCurrency(Number(structure.meals_zar))}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Materials</span>
              <span className="tabular font-mono">
                {formatCurrency(Number(structure.materials_zar))}
              </span>
            </div>
            <div className="flex justify-between pt-2 border-t font-medium">
              <span>Total</span>
              <span className="tabular font-mono">
                {formatCurrency(Number(structure.total_zar))}
              </span>
            </div>
          </div>
        ) : (
          <p className="py-4 text-center text-[13px] text-[color:var(--text-tertiary)]">
            Not configured. Click edit to set pricing.
          </p>
        )}
      </div>
    </div>
  );
}
