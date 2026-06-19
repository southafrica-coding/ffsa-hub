import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProgramById } from "@/services/schools";
import {
  getEnrolledStudentsForCourse,
  getBillingPlansForCourse,
} from "@/services/school-billing";
import { CourseBillingClient } from "./course-billing-client";

export default async function CourseBillingPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;
  const supabase = await createClient();

  const { data: program, error } = await getProgramById(supabase, programId);
  if (error || !program) {
    return (
      <div className="space-y-4">
        <Link
          href="/finance/school-fees"
          className="text-sm text-muted-foreground hover:underline"
        >
          &larr; Back to School Fees
        </Link>
        <p className="text-destructive">Course not found.</p>
      </div>
    );
  }

  const [{ data: students }, { data: plans }] = await Promise.all([
    getEnrolledStudentsForCourse(supabase, programId),
    getBillingPlansForCourse(supabase, programId),
  ]);

  // Which tiers have charge items configured (to warn if none).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: items } = await (supabase as any)
    .from("fee_charge_items")
    .select("tier")
    .eq("program_id", programId)
    .eq("active", true);
  const configuredTiers = Array.from(
    new Set((items ?? []).map((i: { tier: string }) => i.tier))
  );

  return (
    <div className="space-y-6">
      <Link
        href={`/finance/school-fees/${programId}`}
        className="text-sm text-muted-foreground hover:underline"
      >
        &larr; Back to {program.name}
      </Link>

      <div>
        <p className="page-eyebrow">FINANCIAL MANAGEMENT</p>
        <h1 className="page-title">
          {program.name} — Billing Schedules
        </h1>
        <p className="text-sm text-muted-foreground">
          Build each student&apos;s payment schedule from the configured charge
          items. Preview before saving — nothing is sent to Xero at this stage.
        </p>
      </div>

      <CourseBillingClient
        programId={programId}
        hasArrivalDate={!!program.billing_arrival_date}
        configuredTiers={configuredTiers as string[]}
        students={
          (students ?? []) as Parameters<typeof CourseBillingClient>[0]["students"]
        }
        plans={(plans ?? []) as Parameters<typeof CourseBillingClient>[0]["plans"]}
      />
    </div>
  );
}
