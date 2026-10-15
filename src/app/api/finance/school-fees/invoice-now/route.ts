import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageFinance } from "@/lib/api-auth";
import { createAuditLog } from "@/services/audit";
import { planInvoiceNow, INVOICEABLE } from "@/lib/finance/invoice-now";
import { generateDueInvoices } from "@/services/billing-generation";
import { chooseTemplate, type StoredTemplate } from "@/services/invoice-email-delivery";

// POST { enrollmentId, chargeIds: string[], together: boolean, preview?: boolean }
//
// Invoice a student's charges NOW instead of on their scheduled date — a late
// joiner, or a student paying ahead. preview: true answers "what would
// happen" (total, template, emailed or draft) without changing anything.
// Otherwise the chosen charges are re-dated to today (due dates untouched)
// and the normal invoice run creates them — respecting the school's billing
// switches exactly like the daily run does.
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageFinance(supabase, user.id))) {
    return NextResponse.json({ error: "Finance access required" }, { status: 403 });
  }

  const b = await request.json().catch(() => ({}));
  const enrollmentId: unknown = b.enrollmentId;
  const chargeIds: string[] = Array.isArray(b.chargeIds) ? b.chargeIds.filter((x: unknown) => typeof x === "string") : [];
  if (typeof enrollmentId !== "string" || chargeIds.length === 0) {
    return NextResponse.json({ error: "Pick at least one charge" }, { status: 400 });
  }
  const together = b.together === true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // Only this student's charges — a stray id from another student is ignored.
  const { data: rows, error } = await admin
    .from("student_billing_schedule")
    .select(
      "id, status, plan_id, label, amount_zar, due_date, student_billing_plans!inner(enrollment_id, program_id, xero_region)"
    )
    .in("id", chargeIds)
    .eq("student_billing_plans.enrollment_id", enrollmentId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const mine = (rows ?? []) as Array<{
    id: string;
    status: string;
    plan_id: string;
    label: string;
    amount_zar: number;
    due_date: string;
    student_billing_plans: { program_id: string; xero_region: "za" | "us" };
  }>;
  if (mine.length === 0) return NextResponse.json({ error: "Those charges weren't found for this student" }, { status: 404 });

  const today = new Date().toISOString().slice(0, 10);
  const plan = planInvoiceNow(mine, { together, today, key: Date.now().toString(36) });
  if (plan.error) return NextResponse.json({ error: plan.error }, { status: 400 });

  const programId = mine[0].student_billing_plans.program_id;
  const region = mine[0].student_billing_plans.xero_region ?? "za";
  const { data: school } = await admin
    .from("programs")
    .select("name, billing_mode, billing_emails_enabled, email_template_za_id, email_template_us_id")
    .eq("id", programId)
    .single();
  if (school?.billing_mode !== "hub_scheduled") {
    return NextResponse.json({ error: `${school?.name ?? "This school"} is billed outside the Hub, so the Hub can't invoice it.` }, { status: 400 });
  }
  const { data: templates } = await admin
    .from("invoice_email_templates")
    .select("id, name, xero_region, subject, body, include_online_action, is_default");
  const template = chooseTemplate(
    (templates ?? []) as StoredTemplate[],
    region,
    region === "us" ? school.email_template_us_id : school.email_template_za_id
  );
  const chosen = mine.filter((c) => INVOICEABLE.has(c.status));
  const total = chosen.reduce((s, c) => s + Number(c.amount_zar), 0);
  const willEmail = school.billing_emails_enabled === true;

  if (b.preview) {
    return NextResponse.json({
      invoices: together ? 1 : chosen.length,
      total,
      charges: chosen.map((c) => ({ label: c.label, amount: Number(c.amount_zar), dueDate: c.due_date })),
      skipped: plan.skipped.length,
      willEmail,
      template: template ? `${region === "us" ? "US" : "SA"} · ${template.name}` : null,
    });
  }

  for (const u of plan.updates) {
    const { error: upErr } = await admin
      .from("student_billing_schedule")
      .update({ status: u.status, scheduled_generation_date: u.scheduled_generation_date, combined_group_key: u.combined_group_key })
      .eq("id", u.id)
      .in("status", [...INVOICEABLE]); // a charge invoiced meanwhile is left alone
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // The normal run, scoped to this student's plans. Anything else of theirs
  // already due today goes too — it was due anyway.
  const result = await generateDueInvoices(admin, {
    asOf: today,
    dryRun: false,
    autoSend: true,
    planIds: [...new Set(chosen.map((c) => c.plan_id))],
  });

  await createAuditLog(supabase, {
    action: "billing.invoice_now",
    resource_type: "enrollment",
    resource_id: enrollmentId,
    changes: { chargeIds: plan.updates.map((u) => u.id), together, invoices: result.invoices.map((i) => i.invoiceNumber ?? i.status) },
  });

  return NextResponse.json({ success: true, invoices: result.invoices });
}
