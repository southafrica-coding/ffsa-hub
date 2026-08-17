import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageFinance } from "@/lib/api-auth";
import { listXeroInvoices, type XeroRegion } from "@/services/xero";

/**
 * Xero invoices in a date window, matched to Hub students and their schools.
 *
 * Xero has no idea what a "school" is — it has contacts and invoices. The only
 * honest way to answer "what is owed for schools" is to match invoice contacts
 * against enrolled students, and to say plainly how much did NOT match rather
 * than quietly presenting a subset as the whole.
 *
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD   window on DUE DATE (what falls due)
 */

function normalise(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "van Wyk, Ellie" and "Ellie van Wyk" should match. */
function nameKeys(first: string | null, last: string | null, preferred: string | null): string[] {
  const keys = new Set<string>();
  const f = (preferred || first || "").trim();
  const l = (last || "").trim();
  if (f && l) {
    keys.add(normalise(`${f} ${l}`));
    keys.add(normalise(`${l} ${f}`));
  }
  if (first && last && first !== f) {
    keys.add(normalise(`${first} ${last}`));
    keys.add(normalise(`${last} ${first}`));
  }
  return [...keys].filter(Boolean);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!(await canManageFinance(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? new Date().toISOString().slice(0, 10);
  const to = url.searchParams.get("to") ?? `${from.slice(0, 4)}-12-31`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Enrolled students, with the school they are on.
  const { data: enrolments } = await db
    .from("enrollments")
    .select(
      "id, status, program_id, users!enrollments_user_id_fkey(id, first_name, last_name, preferred_name, email), programs(id, name, code, billing_mode)"
    )
    .is("removed_at", null);

  type Enrol = {
    id: string;
    status: string;
    users: { first_name: string | null; last_name: string | null; preferred_name: string | null; email: string | null } | null;
    programs: { name: string | null; code: string | null; billing_mode?: string | null } | null;
  };

  // name → school. Last writer wins on a duplicate name; flagged below.
  const byName = new Map<string, { school: string; code: string | null; status: string; billingMode: string | null }>();
  for (const e of (enrolments ?? []) as Enrol[]) {
    if (!e.users || !e.programs) continue;
    for (const k of nameKeys(e.users.first_name, e.users.last_name, e.users.preferred_name)) {
      byName.set(k, {
        school: e.programs.name ?? "Unknown school",
        code: e.programs.code,
        status: e.status,
        billingMode: e.programs.billing_mode ?? null,
      });
    }
  }

  const regions: XeroRegion[] = ["za", "us"];
  const perRegion = await Promise.all(
    regions.map(async (region) => {
      const { data, error } = await listXeroInvoices(supabase, region);
      if (error || !data) return { region, error, tenantName: null, matched: [], unmatched: [] };

      const inWindow = data.invoices.filter(
        (i) => i.dueDate && i.dueDate >= from && i.dueDate <= to
      );

      const matched: (typeof inWindow[number] & { school: string; code: string | null })[] = [];
      const unmatched: typeof inWindow = [];

      for (const inv of inWindow) {
        const hit = inv.contactName ? byName.get(normalise(inv.contactName)) : undefined;
        if (hit) matched.push({ ...inv, school: hit.school, code: hit.code });
        else unmatched.push(inv);
      }

      return { region, error: null, tenantName: data.tenantName, matched, unmatched };
    })
  );

  // Group the matched invoices by school.
  type Bucket = {
    school: string;
    code: string | null;
    invoices: number;
    billed: number;
    outstanding: number;
    students: Set<string>;
    byStatus: Record<string, number>;
  };
  const schools = new Map<string, Bucket>();

  for (const r of perRegion) {
    for (const inv of r.matched) {
      const b =
        schools.get(inv.school) ??
        ({
          school: inv.school,
          code: inv.code,
          invoices: 0,
          billed: 0,
          outstanding: 0,
          students: new Set<string>(),
          byStatus: {},
        } as Bucket);
      b.invoices++;
      b.billed += inv.total;
      b.outstanding += inv.amountDue;
      if (inv.contactName) b.students.add(inv.contactName);
      b.byStatus[inv.status ?? "?"] = (b.byStatus[inv.status ?? "?"] ?? 0) + 1;
      schools.set(inv.school, b);
    }
  }

  return NextResponse.json({
    window: { from, to },
    enrolmentsConsidered: (enrolments ?? []).length,
    regions: perRegion.map((r) => ({
      region: r.region,
      tenantName: r.tenantName,
      error: r.error,
      inWindow: r.matched.length + r.unmatched.length,
      matchedToStudents: r.matched.length,
      // Said out loud: an unmatched invoice is not proof it is unrelated to a
      // school, only that no enrolled student's name matched it.
      unmatched: r.unmatched.length,
      unmatchedOutstanding: r.unmatched.reduce((s, i) => s + i.amountDue, 0),
      unmatchedSample: r.unmatched
        .slice(0, 10)
        .map((i) => ({ num: i.invoiceNumber, contact: i.contactName, due: i.dueDate, owed: i.amountDue })),
    })),
    schools: [...schools.values()]
      .map((b) => ({
        school: b.school,
        code: b.code,
        invoices: b.invoices,
        students: b.students.size,
        billed: Math.round(b.billed * 100) / 100,
        outstanding: Math.round(b.outstanding * 100) / 100,
        byStatus: b.byStatus,
      }))
      .sort((a, b) => b.outstanding - a.outstanding),
  });
}
