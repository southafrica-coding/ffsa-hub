// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ────────────────────────────────────────────────────────────
// COUNTRY TIERS
// ────────────────────────────────────────────────────────────

export async function getCountryTiers(
  supabase: Client,
  options?: { tier?: string; search?: string }
) {
  let query = supabase
    .from("country_tiers")
    .select("*")
    .order("country_name", { ascending: true });

  if (options?.tier) {
    query = query.eq("tier", options.tier);
  }
  if (options?.search) {
    query = query.ilike("country_name", `%${options.search}%`);
  }

  return query;
}

export async function upsertCountryTier(
  supabase: Client,
  data: { country_name: string; tier: string }
) {
  return supabase
    .from("country_tiers")
    .upsert(data, { onConflict: "country_name" })
    .select()
    .single();
}

export async function deleteCountryTier(supabase: Client, id: string) {
  return supabase.from("country_tiers").delete().eq("id", id);
}

export async function getTierForCountry(
  supabase: Client,
  countryName: string
) {
  return supabase
    .from("country_tiers")
    .select("tier")
    .ilike("country_name", countryName)
    .single();
}

// ────────────────────────────────────────────────────────────
// FEE STRUCTURES
// ────────────────────────────────────────────────────────────

export async function getFeeStructuresByProgram(
  supabase: Client,
  programId: string
) {
  return supabase
    .from("school_fee_structures")
    .select("*")
    .eq("program_id", programId)
    .order("tier", { ascending: true });
}

export async function upsertFeeStructure(
  supabase: Client,
  data: {
    program_id: string;
    tier: string;
    tuition_zar: number;
    accommodation_zar: number;
    meals_zar: number;
    materials_zar: number;
    notes?: string | null;
  }
) {
  return supabase
    .from("school_fee_structures")
    .upsert(data, { onConflict: "program_id,tier" })
    .select()
    .single();
}

export async function deleteFeeStructure(supabase: Client, id: string) {
  return supabase.from("school_fee_structures").delete().eq("id", id);
}

// ────────────────────────────────────────────────────────────
// STUDENT FEES
// ────────────────────────────────────────────────────────────

export async function getStudentFeesByProgram(
  supabase: Client,
  programId: string
) {
  return supabase
    .from("student_fees")
    .select(
      "*, users(id, first_name, last_name, preferred_name, email, nationality), enrollments(status)"
    )
    .eq("program_id", programId)
    .order("created_at", { ascending: false });
}

export async function getStudentFeeById(supabase: Client, id: string) {
  return supabase
    .from("student_fees")
    .select(
      "*, users(id, first_name, last_name, preferred_name, email, nationality), programs(id, name, code), student_payments(*)"
    )
    .eq("id", id)
    .single();
}

export async function getStudentFeeByEnrollment(
  supabase: Client,
  enrollmentId: string
) {
  return supabase
    .from("student_fees")
    .select("*")
    .eq("enrollment_id", enrollmentId)
    .single();
}

export async function getMyStudentFees(supabase: Client, userId: string) {
  return supabase
    .from("student_fees")
    .select("*, programs(id, name, code), student_payments(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
}

export async function createStudentFee(
  supabase: Client,
  data: {
    enrollment_id: string;
    user_id: string;
    program_id: string;
    tier: string;
    tier_override?: boolean;
    tuition_zar: number;
    accommodation_zar: number;
    meals_zar: number;
    materials_zar: number;
    total_due_zar: number;
    discount_zar?: number;
    scholarship_zar?: number;
    notes?: string | null;
  }
) {
  return supabase.from("student_fees").insert(data).select().single();
}

export async function updateStudentFee(
  supabase: Client,
  id: string,
  data: Record<string, unknown>
) {
  return supabase
    .from("student_fees")
    .update(data)
    .eq("id", id)
    .select()
    .single();
}

// ────────────────────────────────────────────────────────────
// PAYMENTS
// ────────────────────────────────────────────────────────────

export async function getPaymentsForFee(
  supabase: Client,
  studentFeeId: string
) {
  return supabase
    .from("student_payments")
    .select("*, users:recorded_by(id, first_name, last_name)")
    .eq("student_fee_id", studentFeeId)
    .order("payment_date", { ascending: false });
}

export async function getPaymentsByProgram(
  supabase: Client,
  programId: string
) {
  return supabase
    .from("student_payments")
    .select(
      "*, student_fees!inner(user_id, program_id, users(id, first_name, last_name, preferred_name))"
    )
    .eq("student_fees.program_id", programId)
    .order("payment_date", { ascending: false });
}

export async function recordPayment(
  supabase: Client,
  data: {
    student_fee_id: string;
    payment_date: string;
    amount_zar: number;
    payment_method: string;
    reference?: string | null;
    currency_paid?: string | null;
    currency_amount?: number | null;
    exchange_rate?: number | null;
    receipt_path?: string | null;
    recorded_by: string;
    notes?: string | null;
  }
) {
  return supabase.from("student_payments").insert(data).select().single();
}

export async function updatePayment(
  supabase: Client,
  id: string,
  data: Record<string, unknown>
) {
  return supabase
    .from("student_payments")
    .update(data)
    .eq("id", id)
    .select()
    .single();
}

export async function deletePayment(supabase: Client, id: string) {
  return supabase.from("student_payments").delete().eq("id", id);
}

// ────────────────────────────────────────────────────────────
// LEDGER FEEDS — read-only rows for the finance movements ledger.
// Nothing here sums, nets or derives a figure; these are the stored
// payment rows, ordered and cut in SQL.
// ────────────────────────────────────────────────────────────

/**
 * The most recent fee payments received, newest first.
 *
 * Ordered AND limited in SQL: this table grows for the life of every school,
 * and the ledger only ever shows a handful of rows. `payment_date` is a date
 * (no time), so `created_at` breaks the ties in recording order.
 *
 * The student name is embedded but never required — `users` is readable only by
 * is_admin() (migration 002) while `student_payments` also admits
 * has_role('finance_admin') (009). A finance_admin therefore sees the payment
 * with a null user, and the caller falls back to a generic label instead of
 * losing the row.
 */
export async function getRecentStudentPayments(supabase: Client, limit: number) {
  return supabase
    .from("student_payments")
    .select(
      "id, payment_date, amount_zar, payment_method, student_fees(program_id, users(first_name, last_name, preferred_name))"
    )
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
}

/**
 * Fee payments that arrived through a bank or card but carry no reference.
 *
 * Only 'eft' and 'card' are counted: a cash payment has no bank line to match,
 * so a missing reference there is bookkeeping shorthand, not a reconciliation
 * gap. `reference` is tested for NULL alone because every write path stores an
 * empty box as null (the record-payment dialog sends `form.reference || null`,
 * and the API route passes it straight through).
 *
 * `count: "exact"` reports the whole filtered set — the limit only trims the
 * rows shown, never the count.
 */
export async function getUnreferencedBankPayments(
  supabase: Client,
  limit: number
) {
  return supabase
    .from("student_payments")
    .select(
      "id, payment_date, amount_zar, payment_method, student_fees(program_id, users(first_name, last_name, preferred_name))",
      { count: "exact" }
    )
    .in("payment_method", ["eft", "card"])
    .is("reference", null)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
}

// ────────────────────────────────────────────────────────────
// AGGREGATION
// ────────────────────────────────────────────────────────────

export async function getProgramFeeSummary(
  supabase: Client,
  programId: string
) {
  const { data: fees } = await supabase
    .from("student_fees")
    .select("final_amount_zar, amount_paid_zar, status")
    .eq("program_id", programId);

  const summary = {
    totalStudents: 0,
    totalDue: 0,
    totalPaid: 0,
    totalOutstanding: 0,
    byStatus: { pending: 0, partially_paid: 0, paid: 0, overdue: 0, waived: 0 } as Record<
      string,
      number
    >,
  };

  for (const fee of fees ?? []) {
    summary.totalStudents++;
    summary.totalDue += Number(fee.final_amount_zar);
    summary.totalPaid += Number(fee.amount_paid_zar);
    summary.byStatus[fee.status] = (summary.byStatus[fee.status] || 0) + 1;
  }

  summary.totalOutstanding = summary.totalDue - summary.totalPaid;
  return summary;
}

export async function getAllProgramsSummary(supabase: Client) {
  const { data: fees } = await supabase
    .from("student_fees")
    .select("program_id, final_amount_zar, amount_paid_zar, status");

  const byProgram: Record<
    string,
    {
      totalStudents: number;
      totalDue: number;
      totalPaid: number;
      totalOutstanding: number;
      byStatus: Record<string, number>;
    }
  > = {};

  for (const fee of fees ?? []) {
    if (!byProgram[fee.program_id]) {
      byProgram[fee.program_id] = {
        totalStudents: 0,
        totalDue: 0,
        totalPaid: 0,
        totalOutstanding: 0,
        byStatus: { pending: 0, partially_paid: 0, paid: 0, overdue: 0, waived: 0 },
      };
    }
    const p = byProgram[fee.program_id];
    p.totalStudents++;
    p.totalDue += Number(fee.final_amount_zar);
    p.totalPaid += Number(fee.amount_paid_zar);
    p.byStatus[fee.status] = (p.byStatus[fee.status] || 0) + 1;
  }

  for (const pid of Object.keys(byProgram)) {
    byProgram[pid].totalOutstanding =
      byProgram[pid].totalDue - byProgram[pid].totalPaid;
  }

  return byProgram;
}
