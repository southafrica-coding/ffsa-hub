// ────────────────────────────────────────────────────────────
// FFSA Hub — Scheduled invoice generation
// ────────────────────────────────────────────────────────────
// Finds billing-schedule rows whose generation date has arrived and
// pushes them to Xero. Rows sharing a (plan, combined_group_key | due_date)
// become ONE invoice with multiple line items (e.g. Mar 4 outreach +
// monthly = one R51k invoice). Idempotent: only acts on 'scheduled' rows
// and flips them to 'generated'/'sent' so the cron never double-creates.
// ────────────────────────────────────────────────────────────

import { createScheduledInvoice, getXeroRegionForStudent } from "@/services/xero";
import {
  setWholeProgramPlan,
  replaceScheduledRows,
  getCountryTierMap,
  type Tier,
} from "@/services/school-billing";
import {
  buildSchedule,
  type BuilderChargeItem,
} from "@/lib/finance/schedule-builder";

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
    status: "preview" | "generated" | "sent" | "failed";
    invoiceNumber?: string;
    error?: string;
  }>;
}

export async function generateDueInvoices(
  supabase: Client,
  opts: { asOf: string; dryRun: boolean; autoSend: boolean; planIds?: string[] }
): Promise<GenerationResult> {
  const { asOf, dryRun, autoSend, planIds } = opts;

  let query = supabase
    .from("student_billing_schedule")
    .select(
      "id, plan_id, charge_type, label, amount_zar, xero_item_code, due_date, combined_group_key, scheduled_generation_date, student_billing_plans!inner(id, user_id, xero_region, users(email, first_name, last_name, preferred_name, nationality))"
    )
    .eq("status", "scheduled")
    .lte("scheduled_generation_date", asOf);
  if (planIds && planIds.length > 0) query = query.in("plan_id", planIds);
  const { data: rows } = await query;

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

  for (const grp of groups.values()) {
    const plan = grp[0].student_billing_plans;
    const user = plan.users ?? {};
    const name = studentName(user);
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

    const inv = await createScheduledInvoice(supabase, {
      region,
      studentEmail: user.email,
      studentName: name,
      dueDate,
      reference,
      lineItems,
      autoSend,
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

    const tierMap = await getCountryTierMap(supabase);
    const nat = (enrollment.users?.nationality ?? "").toLowerCase().trim();
    const tier: Tier = tierMap[nat] ?? "A";
    const region = getXeroRegionForStudent(enrollment.users?.nationality ?? null);
    const acceptanceDate = (
      enrollment.enrolled_at ?? new Date().toISOString()
    ).split("T")[0];

    // Default a new student to the WHOLE PROGRAM pricing (program-level).
    const { data: items } = await supabase
      .from("program_charge_items")
      .select("*")
      .eq("program_id", enrollment.program_id)
      .eq("tier", tier)
      .eq("active", true);
    if (!items || items.length === 0) {
      return { ok: true, plansCreated: 0, generated: 0, note: "no whole-program pricing configured" };
    }

    const { rows } = buildSchedule(items as BuilderChargeItem[], {
      acceptanceDate,
      arrivalDate: null,
      groupYear: null,
      paymentPreference: "standard",
    });

    const { data: plan } = await setWholeProgramPlan(supabase, {
      enrollment_id: enrollmentId,
      user_id: enrollment.user_id,
      program_id: enrollment.program_id,
      tier,
      payment_preference: "standard",
      xero_region: region,
      created_by: createdBy,
    });
    if (!plan) {
      return { ok: false, plansCreated: 0, generated: 0, note: "failed to create plan" };
    }
    await replaceScheduledRows(
      supabase,
      plan.id,
      rows.map((r) => ({
        charge_item_id: r.charge_item_id ?? null,
        charge_type: r.charge_type,
        label: r.label,
        sequence: r.sequence,
        amount_zar: r.amount_zar,
        xero_item_code: r.xero_item_code,
        scheduled_generation_date: r.scheduled_generation_date,
        due_date: r.due_date,
        combined_group_key: r.combined_group_key,
        status: "scheduled",
      }))
    );
    const planIds: string[] = [plan.id];

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
