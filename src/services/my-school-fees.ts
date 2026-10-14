// ────────────────────────────────────────────────────────────
// FFSA Hub — a student's own school fees ("My finance")
// ────────────────────────────────────────────────────────────
// Read with the STUDENT'S session: RLS (migration 095) lets them read only
// their own billing plans and schedule rows, so this can't leak anyone
// else's money.
//
// What a student sees is deliberately simpler than what staff see:
//   - an invoice still sitting as a Xero draft (sending held for the school)
//     hasn't reached them, so it reads as "not invoiced yet" with no number;
//   - a charge held for a staff decision reads as "being arranged";
//   - cancelled charges are hidden.
// The numbers use the same computeBalance() as the staff screens.
// ────────────────────────────────────────────────────────────

import { computeBalance, todayInSouthAfrica, type StudentBalance } from "@/lib/finance/student-balance";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type MyChargeState = "paid" | "part_paid" | "overdue" | "invoiced" | "upcoming" | "arranging";

export interface MyCharge {
  id: string;
  label: string;
  amount: number;
  paid: number;
  dueDate: string;
  invoiceNumber: string | null;
  state: MyChargeState;
  paidAt: string | null;
}

export interface MyFeeAccount {
  programId: string;
  programName: string;
  balance: StudentBalance;
  charges: MyCharge[];
}

interface Row {
  id: string;
  plan_id: string;
  label: string;
  amount_zar: number | string;
  amount_paid_zar: number | string | null;
  status: string;
  due_date: string;
  xero_invoice_number: string | null;
  sent_at: string | null;
  paid_at: string | null;
}

/** Map a charge to what the student should see. */
function studentView(r: Row, today: string): { status: string; charge: MyCharge } | null {
  if (r.status === "cancelled") return null;
  const amount = Number(r.amount_zar) || 0;
  const paid = Math.min(amount, Number(r.amount_paid_zar) || 0);
  // A draft that was never emailed hasn't reached the student.
  const unsentDraft = r.status === "generated" && !r.sent_at && paid === 0;
  const status = unsentDraft ? "scheduled" : r.status;

  let state: MyChargeState;
  if (status === "paid" || (amount > 0 && paid >= amount)) state = "paid";
  else if (status === "needs_decision") state = "arranging";
  else if (status === "scheduled") state = "upcoming";
  else if (r.due_date < today) state = "overdue";
  else if (paid > 0) state = "part_paid";
  else state = "invoiced";

  return {
    status,
    charge: {
      id: r.id,
      label: r.label,
      amount,
      paid,
      dueDate: r.due_date,
      invoiceNumber: unsentDraft ? null : r.xero_invoice_number,
      state,
      paidAt: r.paid_at,
    },
  };
}

export async function getMyFeeAccounts(
  supabase: Client,
  userId: string
): Promise<{ today: string; accounts: MyFeeAccount[] }> {
  const today = todayInSouthAfrica();

  const { data: plans, error: planErr } = await supabase
    .from("student_billing_plans")
    .select("id, program_id, programs(id, name)")
    .eq("user_id", userId);
  if (planErr) throw new Error(`Could not read your fees: ${planErr.message}`);
  if (!plans || plans.length === 0) return { today, accounts: [] };

  const planIds = plans.map((p: { id: string }) => p.id);
  const { data: rows, error: rowErr } = await supabase
    .from("student_billing_schedule")
    .select("id, plan_id, label, amount_zar, amount_paid_zar, status, due_date, xero_invoice_number, sent_at, paid_at")
    .in("plan_id", planIds)
    .order("due_date", { ascending: true });
  if (rowErr) throw new Error(`Could not read your fees: ${rowErr.message}`);

  // One account per school, even when a student is billed per course.
  const programOf = new Map<string, { id: string; name: string }>();
  for (const p of plans as Array<{ id: string; program_id: string; programs: { id: string; name: string } | null }>) {
    programOf.set(p.id, { id: p.program_id, name: p.programs?.name ?? "Your school" });
  }
  const byProgram = new Map<string, { name: string; rows: Array<{ status: string; charge: MyCharge }> }>();
  for (const r of (rows ?? []) as Row[]) {
    const prog = programOf.get(r.plan_id);
    if (!prog) continue;
    const v = studentView(r, today);
    if (!v) continue;
    if (!byProgram.has(prog.id)) byProgram.set(prog.id, { name: prog.name, rows: [] });
    byProgram.get(prog.id)!.rows.push(v);
  }

  const accounts: MyFeeAccount[] = [];
  for (const [programId, { name, rows: list }] of byProgram) {
    const balance = computeBalance(
      list.map((v) => ({
        amount_zar: v.charge.amount,
        amount_paid_zar: v.charge.paid,
        status: v.status,
        due_date: v.charge.dueDate,
      })),
      today
    );
    // A student's "next payment" is the next one with a date they can act on —
    // never a charge staff are still arranging.
    const nextOwing = list
      .map((v) => v.charge)
      .filter((c) => c.state !== "paid" && c.state !== "arranging" && c.amount > c.paid)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const nextDate = nextOwing[0]?.dueDate;
    balance.next = nextDate
      ? {
          dueDate: nextDate,
          amount:
            Math.round(
              nextOwing.filter((c) => c.dueDate === nextDate).reduce((s, c) => s + c.amount - c.paid, 0) * 100
            ) / 100,
        }
      : null;
    accounts.push({ programId, programName: name, balance, charges: list.map((v) => v.charge) });
  }
  return { today, accounts };
}
