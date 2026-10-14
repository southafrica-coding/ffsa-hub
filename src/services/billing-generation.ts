// ────────────────────────────────────────────────────────────
// FFSA Hub — Scheduled invoice generation
// ────────────────────────────────────────────────────────────
// Finds billing-schedule rows whose generation date has arrived and
// pushes them to Xero, honouring each school's billing settings (mode,
// start date, email hold). Rows sharing a (plan, combined_group_key | due_date)
// become ONE invoice with multiple line items (e.g. Mar 4 outreach +
// monthly = one R51k invoice). Idempotent: only acts on 'scheduled' rows
// and flips them to 'generated'/'sent' so the cron never double-creates.
// ────────────────────────────────────────────────────────────

import { createScheduledInvoice, getXeroRegionForStudent } from "@/services/xero";
import { getCountryTierMap, billingBlockedReason, type Tier } from "@/services/school-billing";
import { commitWholeProgramPlan, commitSegmentPlans } from "@/services/billing-plan-builder";
import {
  decideInvoiceGroup,
  SKIP_REASON_TEXT,
  type SchoolBillingSettings,
  type SkipReason,
} from "@/lib/finance/invoice-run-policy";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const studentName = (u: {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}) =>
  `${u.first_name || ""} ${u.last_name || ""}`.trim() ||
  "Student";

export interface GenerationResult {
  asOf: string;
  dryRun: boolean;
  autoSend: boolean;
  invoices: Array<{
    planId: string;
    student: string;
    dueDate: string;
    total: number;
    rowIds: string[];
    status: "preview" | "generated" | "sent" | "failed" | "skipped";
    /** Whether this invoice is (or would be) authorised + emailed. False =
     * a Xero draft because the school's sending is held. */
    send?: boolean;
    invoiceNumber?: string;
    error?: string;
    /** Why a 'skipped' line was left alone (rows stay 'scheduled'). */
    reason?: string;
  }>;
}

/**
 * Generate every due invoice, school by school.
 *
 * `autoSend` is a ceiling, not a decision: each school's own settings
 * (src/lib/finance/invoice-run-policy.ts) decide whether its invoices are
 * emailed, held as Xero drafts, or skipped entirely.
 */
export async function generateDueInvoices(
  supabase: Client,
  opts: { asOf: string; dryRun: boolean; autoSend: boolean; planIds?: string[] }
): Promise<GenerationResult> {
  const { asOf, dryRun, autoSend, planIds } = opts;

  let query = supabase
    .from("student_billing_schedule")
    .select(
      "id, plan_id, charge_type, label, amount_zar, xero_item_code, due_date, combined_group_key, scheduled_generation_date, student_billing_plans!inner(id, user_id, program_id, xero_region, users(email, first_name, last_name, preferred_name, nationality))"
    )
    .eq("status", "scheduled")
    .lte("scheduled_generation_date", asOf);
  if (planIds && planIds.length > 0) query = query.in("plan_id", planIds);
  const { data: rows, error: rowsError } = await query;
  if (rowsError) throw new Error(`Could not read the billing schedule: ${rowsError.message}`);

  // Each school's billing settings, read once. A school missing from this map
  // is treated as external by the policy — never billed by default.
  const programIds = [
    ...new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rows ?? []).map((r: any) => r.student_billing_plans?.program_id).filter(Boolean)
    ),
  ];
  const schools = new Map<string, SchoolBillingSettings>();
  if (programIds.length > 0) {
    const { data: programs, error: progError } = await supabase
      .from("programs")
      .select("id, billing_mode, billing_emails_enabled, schedule_start_date")
      .in("id", programIds);
    if (progError) {
      throw new Error(`Could not read school billing settings: ${progError.message}`);
    }
    for (const p of programs ?? []) schools.set(p.id, p);
  }

  // Group rows into invoices.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groups = new Map<string, any[]>();
  for (const r of rows ?? []) {
    const key = `${r.plan_id}::${r.combined_group_key ?? r.due_date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const result: GenerationResult = { asOf, dryRun, autoSend, invoices: [] };
  const nowIso = new Date().toISOString();

  for (const allRows of groups.values()) {
    const plan = allRows[0].student_billing_plans;
    const user = plan.users ?? {};
    const name = studentName(user);
    const decision = decideInvoiceGroup(allRows, schools.get(plan.program_id), autoSend);

    // Report what was left alone, one line per reason.
    const byReason = new Map<SkipReason, typeof allRows>();
    for (const { row, reason } of decision.skipped) {
      if (!byReason.has(reason)) byReason.set(reason, []);
      byReason.get(reason)!.push(row);
    }
    for (const [reason, skippedRows] of byReason) {
      result.invoices.push({
        planId: plan.id,
        student: name,
        dueDate: skippedRows.map((r) => r.due_date).sort()[0],
        total: skippedRows.reduce((s, r) => s + Number(r.amount_zar), 0),
        rowIds: skippedRows.map((r) => r.id),
        status: "skipped",
        reason: SKIP_REASON_TEXT[reason],
      });
    }

    const grp = decision.invoice;
    if (grp.length === 0) continue;
    const send = decision.send;
    const dueDate = grp.map((r) => r.due_date).sort()[0];
    const total = grp.reduce((s, r) => s + Number(r.amount_zar), 0);
    const rowIds = grp.map((r) => r.id);
    const region = plan.xero_region ?? getXeroRegionForStudent(user.nationality ?? null);

    if (dryRun) {
      result.invoices.push({
        planId: plan.id,
        student: name,
        dueDate,
        total,
        rowIds,
        status: "preview",
        send,
      });
      continue;
    }

    if (!user.email) {
      result.invoices.push({
        planId: plan.id,
        student: name,
        dueDate,
        total,
        rowIds,
        status: "failed",
        send,
        error: "No student email on file",
      });
      continue;
    }

    const reference = `FFSA-${String(plan.id).slice(0, 8)}-${dueDate}`;
    const lineItems = grp.map((r) => ({
      itemCode: r.xero_item_code,
      description: r.label,
      amount: Number(r.amount_zar),
    }));

    // send=false → createScheduledInvoice leaves it as a Xero DRAFT and
    // never calls the email endpoint.
    const inv = await createScheduledInvoice(supabase, {
      region,
      studentEmail: user.email,
      studentName: name,
      dueDate,
      reference,
      lineItems,
      autoSend: send,
    });

    if (inv.success) {
      const newStatus = inv.emailed ? "sent" : "generated";
      await supabase
        .from("student_billing_schedule")
        .update({
          status: newStatus,
          xero_invoice_id: inv.invoiceId,
          xero_invoice_number: inv.invoiceNumber ?? null,
          generated_at: nowIso,
          sent_at: inv.emailed ? nowIso : null,
        })
        .in("id", rowIds);
      result.invoices.push({
        planId: plan.id,
        student: name,
        dueDate,
        total,
        rowIds,
        status: newStatus,
        send,
        invoiceNumber: inv.invoiceNumber,
      });
    } else {
      result.invoices.push({
        planId: plan.id,
        student: name,
        dueDate,
        total,
        rowIds,
        status: "failed",
        send,
        error: inv.error,
      });
    }
  }

  return result;
}

// ────────────────────────────────────────────────────────────
// On acceptance: set up the full-program billing schedule for a new
// enrolment (all phases), then immediately generate any due invoices
// (the deposit). Non-throwing — callers fire-and-forget so acceptance
// never fails on a billing hiccup. Returns a short summary for logs.
// ────────────────────────────────────────────────────────────
export async function setupProgramBillingOnAcceptance(
  supabase: Client,
  enrollmentId: string,
  createdBy: string | null
): Promise<{ ok: boolean; plansCreated: number; generated: number; note?: string }> {
  try {
    const { data: enrollment } = await supabase
      .from("enrollments")
      .select(
        "id, user_id, program_id, enrolled_at, users!enrollments_user_id_fkey(id, nationality)"
      )
      .eq("id", enrollmentId)
      .single();
    if (!enrollment) return { ok: false, plansCreated: 0, generated: 0, note: "no enrollment" };

    // A school billed outside the Hub must never have charges scheduled
    // against it (docs/redesign/09-going-live.md) — the database refuses
    // this too (migration 172's trigger), but checking here avoids ever
    // hitting that as a raw constraint error mid-acceptance.
    const blocked = await billingBlockedReason(supabase, enrollment.program_id);
    if (blocked) {
      return { ok: true, plansCreated: 0, generated: 0, note: blocked };
    }

    const tierMap = await getCountryTierMap(supabase);
    const nat = (enrollment.users?.nationality ?? "").toLowerCase().trim();
    const tier: Tier = tierMap[nat] ?? "A";
    const region = getXeroRegionForStudent(enrollment.users?.nationality ?? null);
    const acceptanceDate = (
      enrollment.enrolled_at ?? new Date().toISOString()
    ).split("T")[0];

    // The student's track of record (migration 221) — which segment(s) they
    // applied for, or whole-program, copied onto the enrollment at
    // acceptance. No rows means either a program with no segments configured
    // (every program before this feature) or an application that predates
    // it — both fall back to the historical default of whole-program.
    const { data: segmentRows } = await supabase
      .from("enrollment_segments")
      .select("billing_course_id")
      .eq("enrollment_id", enrollmentId);
    const courseIds = (segmentRows ?? [])
      .map((r: { billing_course_id: string | null }) => r.billing_course_id)
      .filter((id: string | null): id is string => !!id);

    const committed =
      courseIds.length > 0
        ? await commitSegmentPlans(supabase, {
            enrollmentId,
            userId: enrollment.user_id,
            programId: enrollment.program_id,
            courseIds,
            tier,
            preference: "standard",
            region,
            createdBy,
            acceptanceDate,
          })
        : await commitWholeProgramPlan(supabase, {
            enrollmentId,
            userId: enrollment.user_id,
            programId: enrollment.program_id,
            tier,
            preference: "standard",
            region,
            createdBy,
            acceptanceDate,
          });

    if (!committed.ok) {
      return { ok: false, plansCreated: 0, generated: 0, note: committed.error ?? "failed to create plan" };
    }

    const { data: plans } = await supabase
      .from("student_billing_plans")
      .select("id")
      .eq("enrollment_id", enrollmentId);
    const planIds: string[] = (plans ?? []).map((p: { id: string }) => p.id);
    if (planIds.length === 0) {
      return { ok: true, plansCreated: 0, generated: 0, note: "no pricing configured" };
    }

    // Generate any invoices already due to generate (the deposit).
    const gen = await generateDueInvoices(supabase, {
      asOf: new Date().toISOString().split("T")[0],
      dryRun: false,
      autoSend: true,
      planIds,
    });
    const generated = gen.invoices.filter(
      (i) => i.status === "sent" || i.status === "generated"
    ).length;

    return { ok: true, plansCreated: planIds.length, generated };
  } catch (err) {
    console.error("[setupProgramBillingOnAcceptance] failed", err);
    return {
      ok: false,
      plansCreated: 0,
      generated: 0,
      note: err instanceof Error ? err.message : "error",
    };
  }
}
