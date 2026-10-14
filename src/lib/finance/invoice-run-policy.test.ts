import { describe, expect, it, vi, beforeEach } from "vitest";
import { decideInvoiceGroup, type SchoolBillingSettings } from "./invoice-run-policy";

const hub = (over: Partial<SchoolBillingSettings> = {}): SchoolBillingSettings => ({
  billing_mode: "hub_scheduled",
  billing_emails_enabled: true,
  schedule_start_date: null,
  ...over,
});
const row = (id: string, due_date: string) => ({ id, due_date });

describe("decideInvoiceGroup", () => {
  it("skips every row for a school billed outside the Hub", () => {
    const d = decideInvoiceGroup([row("a", "2027-02-04")], hub({ billing_mode: "external" }), true);
    expect(d.invoice).toEqual([]);
    expect(d.skipped.map((s) => s.reason)).toEqual(["outside_hub"]);
    expect(d.send).toBe(false);
  });

  it("treats an unknown school as outside the Hub", () => {
    const d = decideInvoiceGroup([row("a", "2027-02-04")], undefined, true);
    expect(d.invoice).toEqual([]);
    expect(d.skipped[0].reason).toBe("outside_hub");
  });

  it("holds sending as a draft when the school's emails are off", () => {
    const d = decideInvoiceGroup([row("a", "2027-02-04")], hub({ billing_emails_enabled: false }), true);
    expect(d.invoice).toHaveLength(1);
    expect(d.send).toBe(false);
  });

  it("sends when the school allows it and the caller does", () => {
    expect(decideInvoiceGroup([row("a", "2027-02-04")], hub(), true).send).toBe(true);
  });

  it("never sends when the caller forbids it, whatever the school says", () => {
    expect(decideInvoiceGroup([row("a", "2027-02-04")], hub(), false).send).toBe(false);
  });

  it("drops rows due before the start date and keeps the rest of the group", () => {
    const d = decideInvoiceGroup(
      [row("old", "2027-02-04"), row("edge", "2027-03-01"), row("new", "2027-03-04")],
      hub({ schedule_start_date: "2027-03-01" }),
      true
    );
    expect(d.invoice.map((r) => r.id)).toEqual(["edge", "new"]);
    expect(d.skipped).toEqual([{ row: row("old", "2027-02-04"), reason: "before_start_date" }]);
  });
});

// ── The run itself, with Xero and the database faked ─────────────────

const createScheduledInvoice = vi.fn();
vi.mock("@/services/xero", () => ({
  createScheduledInvoice: (...a: unknown[]) => createScheduledInvoice(...a),
  getXeroRegionForStudent: () => "za",
}));
vi.mock("@/services/school-billing", () => ({
  getCountryTierMap: vi.fn(),
  billingBlockedReason: vi.fn(),
}));
vi.mock("@/services/billing-plan-builder", () => ({
  commitWholeProgramPlan: vi.fn(),
  commitSegmentPlans: vi.fn(),
}));

const { generateDueInvoices } = await import("@/services/billing-generation");

type Row = Record<string, unknown>;
/** Minimal stand-in for the Supabase query builder: every call chains, and
 * awaiting resolves to the table's canned rows. Updates are recorded. */
function fakeDb(tables: Record<string, Row[]>) {
  const updates: Array<{ table: string; values: Row; ids: unknown }> = [];
  const db = {
    updates,
    from(table: string) {
      let pendingUpdate: Row | null = null;
      const q = {
        select: () => q,
        eq: () => q,
        lte: () => q,
        update: (values: Row) => ((pendingUpdate = values), q),
        in: (_col: string, ids: unknown) => {
          if (pendingUpdate) updates.push({ table, values: pendingUpdate, ids });
          return q;
        },
        then: (resolve: (v: { data: Row[]; error: null }) => void) =>
          resolve({ data: tables[table] ?? [], error: null }),
      };
      return q;
    },
  };
  return db;
}

const scheduleRow = (id: string, programId: string, due: string) => ({
  id,
  plan_id: `plan-${programId}`,
  label: "Monthly tuition",
  amount_zar: 6000,
  xero_item_code: "FFX-MON-A",
  due_date: due,
  combined_group_key: null,
  student_billing_plans: {
    id: `plan-${programId}`,
    program_id: programId,
    xero_region: "za",
    users: { email: `${programId}@example.com`, first_name: "Test", last_name: programId },
  },
});

describe("generateDueInvoices honours each school", () => {
  beforeEach(() => {
    createScheduledInvoice.mockReset();
    createScheduledInvoice.mockImplementation(async (_db, p: { autoSend: boolean }) => ({
      success: true,
      invoiceId: "inv",
      invoiceNumber: "INV-1",
      emailed: p.autoSend,
    }));
  });

  const tables = {
    student_billing_schedule: [
      scheduleRow("r-ext", "ext", "2027-02-04"),
      scheduleRow("r-held", "held", "2027-02-04"),
      scheduleRow("r-live", "live", "2027-02-04"),
      scheduleRow("r-early", "late", "2027-02-04"),
      scheduleRow("r-ok", "late", "2027-04-04"),
    ],
    programs: [
      { id: "ext", billing_mode: "external", billing_emails_enabled: true, schedule_start_date: null },
      { id: "held", billing_mode: "hub_scheduled", billing_emails_enabled: false, schedule_start_date: null },
      { id: "live", billing_mode: "hub_scheduled", billing_emails_enabled: true, schedule_start_date: null },
      { id: "late", billing_mode: "hub_scheduled", billing_emails_enabled: true, schedule_start_date: "2027-03-01" },
    ],
  };

  it("creates drafts for held schools, emails live ones, skips the rest", async () => {
    const db = fakeDb(tables);
    const res = await generateDueInvoices(db, { asOf: "2027-12-31", dryRun: false, autoSend: true });

    // Only three invoices reach Xero: held (draft), live (sent), late (Apr only).
    expect(createScheduledInvoice).toHaveBeenCalledTimes(3);
    const byEmail = Object.fromEntries(
      createScheduledInvoice.mock.calls.map(([, p]) => [p.studentEmail, p.autoSend])
    );
    expect(byEmail).toEqual({
      "held@example.com": false,
      "live@example.com": true,
      "late@example.com": true,
    });

    const status = (id: string) => res.invoices.find((i) => i.rowIds.includes(id))?.status;
    expect(status("r-ext")).toBe("skipped");
    expect(status("r-held")).toBe("generated");
    expect(status("r-live")).toBe("sent");
    expect(status("r-early")).toBe("skipped");
    expect(status("r-ok")).toBe("sent");

    // Skipped rows are never written — they stay 'scheduled'.
    const touched = db.updates.flatMap((u) => u.ids as string[]);
    expect(touched).not.toContain("r-ext");
    expect(touched).not.toContain("r-early");
  });

  it("a dry run reports the same decisions without touching Xero", async () => {
    const db = fakeDb(tables);
    const res = await generateDueInvoices(db, { asOf: "2027-12-31", dryRun: true, autoSend: true });
    expect(createScheduledInvoice).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
    const line = (id: string) => res.invoices.find((i) => i.rowIds.includes(id));
    expect(line("r-held")).toMatchObject({ status: "preview", send: false });
    expect(line("r-live")).toMatchObject({ status: "preview", send: true });
    expect(line("r-ext")?.status).toBe("skipped");
  });
});
