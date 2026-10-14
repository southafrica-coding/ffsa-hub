// ────────────────────────────────────────────────────────────
// FFSA Hub — every student's fee balance for one school
// ────────────────────────────────────────────────────────────
// Reads a school's charges once (paged — PostgREST caps a read at 1000 rows)
// and turns them into per-student balances with computeBalance(). The
// Finance student list, the Training roster and the student page all use
// this, so they show the same numbers.
// ────────────────────────────────────────────────────────────

import {
  computeBalance,
  sumBalances,
  todayInSouthAfrica,
  type StudentBalance,
} from "@/lib/finance/student-balance";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export interface ChargeDetail {
  id: string;
  label: string;
  amount_zar: number;
  amount_paid_zar: number;
  status: string;
  due_date: string;
  scheduled_generation_date: string;
  xero_invoice_number: string | null;
  paid_at: string | null;
}

export interface SchoolBalances {
  today: string;
  byEnrollment: Map<string, { balance: StudentBalance; charges: ChargeDetail[] }>;
  totals: StudentBalance;
}

export async function getSchoolBalances(
  supabase: Client,
  programId: string,
  opts: { enrollmentId?: string } = {}
): Promise<SchoolBalances> {
  const today = todayInSouthAfrica();
  const rows: Array<ChargeDetail & { student_billing_plans: { enrollment_id: string } }> = [];

  for (let from = 0; ; from += 1000) {
    let q = supabase
      .from("student_billing_schedule")
      .select(
        "id, label, amount_zar, amount_paid_zar, status, due_date, scheduled_generation_date, xero_invoice_number, paid_at, student_billing_plans!inner(enrollment_id, program_id)"
      )
      .eq("student_billing_plans.program_id", programId)
      .order("due_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (opts.enrollmentId) q = q.eq("student_billing_plans.enrollment_id", opts.enrollmentId);
    const { data, error } = await q;
    if (error) throw new Error(`Could not read school fees: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const grouped = new Map<string, ChargeDetail[]>();
  for (const r of rows) {
    const id = r.student_billing_plans.enrollment_id;
    if (!grouped.has(id)) grouped.set(id, []);
    const { student_billing_plans: _plan, ...charge } = r;
    void _plan;
    grouped.get(id)!.push({
      ...charge,
      amount_zar: Number(charge.amount_zar),
      amount_paid_zar: Number(charge.amount_paid_zar ?? 0),
    });
  }

  const byEnrollment: SchoolBalances["byEnrollment"] = new Map();
  for (const [id, charges] of grouped) {
    byEnrollment.set(id, { balance: computeBalance(charges, today), charges });
  }
  return {
    today,
    byEnrollment,
    totals: sumBalances([...byEnrollment.values()].map((v) => v.balance)),
  };
}
