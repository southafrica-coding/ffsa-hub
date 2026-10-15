import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageFinance } from "@/lib/api-auth";
import { FFX_2027_PROGRAM_TEMPLATE } from "@/lib/finance/billing";
import { designFromCharges, parseDesign, type ChargeLike } from "@/lib/finance/payment-schedule";
import type { Tier } from "@/services/school-billing";
import { SchoolBillingSettings } from "@/app/(admin)/finance/school-fees/[programId]/billing/school-billing-settings";
import { PaymentScheduleBuilder } from "@/components/finance/payment-schedule-builder";
import { SchoolInvoiceEmailSettings, type TemplateOption } from "@/components/finance/school-invoice-email-settings";

// A school's money settings in one place: who bills it, its payment
// schedules (whole program + each course), and links into Finance. Rendered
// on the Finance billing page and as the Training school's Fees tab, so both
// edit the same settings.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

type ChargeRow = ChargeLike & { tier: Tier; course_id?: string; schedule_payment_key?: string | null };

function byTier(rows: ChargeRow[]): Partial<Record<Tier, ChargeLike[]>> {
  const out: Partial<Record<Tier, ChargeLike[]>> = {};
  for (const r of rows) (out[r.tier] ??= []).push(r);
  return out;
}

export async function SchoolFeesPanel({
  programId,
  showFinanceLinks = true,
}: {
  programId: string;
  showFinanceLinks?: boolean;
}) {
  const supabase = await createClient();
  const admin: Admin = createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const canEdit = user ? await canManageFinance(supabase, user.id) : false;

  const [{ data: program }, { data: courses }, { data: schedules }, { data: programItems }, { data: courseItems }] =
    await Promise.all([
      admin
        .from("programs")
        .select(
          "id, name, billing_mode, billing_emails_enabled, schedule_start_date, email_template_za_id, email_template_us_id, xero_branding_theme_za, xero_branding_theme_us"
        )
        .eq("id", programId)
        .single(),
      admin
        .from("billing_courses")
        .select("id, code, name, sequence, arrival_date")
        .eq("program_id", programId)
        .order("sequence", { ascending: true }),
      admin.from("billing_schedules").select("course_id, tier_prices, payments").eq("program_id", programId),
      admin.from("program_charge_items").select("*").eq("program_id", programId),
      admin.from("fee_charge_items").select("*, billing_courses!inner(program_id)").eq("billing_courses.program_id", programId),
    ]);

  if (!program) return <p className="text-sm text-destructive">School not found.</p>;

  const { data: templateRows } = await admin
    .from("invoice_email_templates")
    .select("id, name, xero_region, is_default")
    .order("name", { ascending: true });

  const { count: pendingCharges } = await admin
    .from("student_billing_schedule")
    .select("id, student_billing_plans!inner(program_id)", { count: "exact", head: true })
    .eq("student_billing_plans.program_id", programId)
    .eq("status", "scheduled");

  const savedFor = (courseId: string | null) =>
    parseDesign(
      (schedules ?? []).find((s: { course_id: string | null }) => (s.course_id ?? null) === courseId) ?? null
    );

  // Hand-made charges become the editable starting point when a target has no
  // saved schedule, so nothing set up the old way is lost.
  const manualProgram = ((programItems ?? []) as ChargeRow[]).filter((r) => !r.schedule_payment_key);
  const manualCourse = (id: string) =>
    ((courseItems ?? []) as ChargeRow[]).filter((r) => r.course_id === id && !r.schedule_payment_key);

  const startingLabel =
    "Converted from this school's existing charges. Nothing changes until you save, and saving replaces those charges with this schedule.";

  const targets = [
    {
      courseId: null as string | null,
      name: "Whole program",
      arrivalDate: null as string | null,
      saved: savedFor(null),
      starting: manualProgram.length > 0 ? designFromCharges(byTier(manualProgram)) : null,
      template: designFromCharges(FFX_2027_PROGRAM_TEMPLATE.wholeProgram),
    },
    ...((courses ?? []) as Array<{ id: string; code: string; name: string; arrival_date: string | null }>).map((c) => {
      const tpl = FFX_2027_PROGRAM_TEMPLATE.courses.find((t) => t.code === c.code);
      const manual = manualCourse(c.id);
      return {
        courseId: c.id as string | null,
        name: `${c.name} (${c.code}) — on its own`,
        arrivalDate: c.arrival_date,
        saved: savedFor(c.id),
        starting: manual.length > 0 ? designFromCharges(byTier(manual)) : null,
        template: tpl ? designFromCharges(tpl.charges) : null,
      };
    }),
  ];

  return (
    <div className="space-y-6">
      <SchoolBillingSettings
        programId={programId}
        schoolName={program.name}
        canEdit={canEdit}
        pendingCharges={pendingCharges ?? 0}
        initial={{
          billing_mode: program.billing_mode === "hub_scheduled" ? "hub_scheduled" : "external",
          billing_emails_enabled: program.billing_emails_enabled === true,
          schedule_start_date: program.schedule_start_date ?? null,
        }}
      />

      <SchoolInvoiceEmailSettings
        programId={programId}
        canEdit={canEdit}
        templates={(templateRows ?? []) as TemplateOption[]}
        initial={{
          za: { templateId: program.email_template_za_id ?? null, theme: program.xero_branding_theme_za ?? null },
          us: { templateId: program.email_template_us_id ?? null, theme: program.xero_branding_theme_us ?? null },
        }}
      />

      <div className="space-y-2">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.14em]">Payment schedules</h2>
        <p className="max-w-3xl text-[13px] text-[color:var(--text-secondary)]">
          How many payments each student makes, how much each one is, and when it&apos;s due.
          &ldquo;Whole program&rdquo; is what students doing the full program pay; a course&apos;s
          schedule is for students doing only that course. A schedule applies to students set up
          after it&apos;s saved.
        </p>
      </div>

      {targets.map((t) => (
        <PaymentScheduleBuilder
          key={t.courseId ?? "whole"}
          programId={programId}
          target={{ courseId: t.courseId, name: t.name, arrivalDate: t.arrivalDate }}
          saved={t.saved}
          startingPoint={t.starting}
          startingPointLabel={startingLabel}
          template={t.template}
          canEdit={canEdit}
        />
      ))}

      {showFinanceLinks && (
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/finance/school-fees/${programId}/students`}
            className="inline-block border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white"
          >
            Student billing in Finance &rarr;
          </Link>
          <Link
            href="/finance/school-fees"
            className="inline-block border border-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em]"
          >
            Invoice run &rarr;
          </Link>
          <Link
            href={`/finance/school-fees/${programId}/billing`}
            className="inline-block border border-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em]"
          >
            All fee settings in Finance &rarr;
          </Link>
        </div>
      )}
    </div>
  );
}
