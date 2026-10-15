import { describe, expect, it, vi, beforeEach } from "vitest";
import { decideInvoiceGroup, resolveTracking, type SchoolBillingSettings } from "./invoice-run-policy";
import { FFX_2027_PROGRAM_TEMPLATE, ffx2027TrackingOption } from "./billing";

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
const getXeroTrackingOptions = vi.fn();
vi.mock("@/services/xero", () => ({
  createScheduledInvoice: (...a: unknown[]) => createScheduledInvoice(...a),
  getXeroTrackingOptions: (...a: unknown[]) => getXeroTrackingOptions(...a),
  getXeroRegionForStudent: () => "za",
}));
const sendSchoolInvoiceEmail = vi.fn();
vi.mock("@/services/invoice-email-delivery", async (orig) => {
  const actual = await orig<typeof import("@/services/invoice-email-delivery")>();
  return { ...actual, sendSchoolInvoiceEmail: (...a: unknown[]) => sendSchoolInvoiceEmail(...a) };
});
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
      status: p.autoSend ? "AUTHORISED" : "DRAFT",
      emailed: false,
    }));
    sendSchoolInvoiceEmail.mockReset();
    sendSchoolInvoiceEmail.mockResolvedValue({ ok: true, messageId: "m" });
  });

  const tables = {
    student_billing_schedule: [
      scheduleRow("r-ext", "ext", "2027-02-04"),
      scheduleRow("r-held", "held", "2027-02-04"),
      scheduleRow("r-live", "live", "2027-02-04"),
      scheduleRow("r-early", "late", "2027-02-04"),
      scheduleRow("r-ok", "late", "2027-04-04"),
    ],
    invoice_email_templates: [
      { id: "basic-za", name: "Basic", xero_region: "za", subject: "s", body: "b", include_online_action: true, is_default: true },
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

    // Xero never emails school invoices; the Hub does, only for live schools.
    expect(createScheduledInvoice.mock.calls.every(([, p]) => p.xeroEmail === false)).toBe(true);
    expect(sendSchoolInvoiceEmail.mock.calls.map(([, o]) => o.to).sort()).toEqual(["late@example.com", "live@example.com"]);
    expect(sendSchoolInvoiceEmail.mock.calls[0][1].template.name).toBe("Basic");

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

describe("resolveTracking", () => {
  const sa = { category: "Schools", options: ["FFX 27", "Gap Year 2027", "Ltrack 2026.4"] };

  it("tags with Xero's own spelling, ignoring case", () => {
    expect(resolveTracking("ltrack 2026.4", sa, "SA")).toEqual({
      tracking: { category: "Schools", option: "Ltrack 2026.4" },
      warning: null,
    });
  });

  it("leaves a line untagged, with a warning, when the organisation lacks the option", () => {
    const r = resolveTracking("RR Uni", sa, "SA");
    expect(r.tracking).toBeNull();
    expect(r.warning).toMatch(/SA Xero has no "Schools" option "RR Uni"/);
  });

  it("warns rather than guessing when Xero couldn't be read", () => {
    expect(resolveTracking("FFX 27", null, "US").warning).toMatch(/Couldn't read US Xero/);
  });

  it("does nothing for a charge with no option", () => {
    expect(resolveTracking(null, sa, "SA")).toEqual({ tracking: null, warning: null });
  });
});

describe("FFX 2027 template tracking", () => {
  it("matches FFSA's item-code sheet", () => {
    expect(ffx2027TrackingOption("FFXYL2027-MON-B")).toBe("Gap Year 2027");
    expect(ffx2027TrackingOption("FFXOR2027")).toBe("Gap Year 2027");
    expect(ffx2027TrackingOption("FFXQ2027-DEP-A")).toBe("FFX 27");
    expect(ffx2027TrackingOption("FFBXQ2027-BAL-C")).toBe("FFBX 2027");
    expect(ffx2027TrackingOption("FFWVQ2027-DEP-B")).toBe("FFWV 2027");
  });

  it("tags every charge in the template", () => {
    const all = [
      ...Object.values(FFX_2027_PROGRAM_TEMPLATE.wholeProgram).flat(),
      ...FFX_2027_PROGRAM_TEMPLATE.courses.flatMap((c) => Object.values(c.charges).flat()),
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const item of all) expect(item.xero_tracking_option, item.xero_item_code ?? "").toBeTruthy();
  });
});

describe("generateDueInvoices tags lines in the student's organisation", () => {
  beforeEach(() => {
    createScheduledInvoice.mockReset();
    createScheduledInvoice.mockResolvedValue({ success: true, invoiceId: "i", emailed: false });
    getXeroTrackingOptions.mockReset();
    getXeroTrackingOptions.mockResolvedValue({ category: "Schools", options: ["Gap Year 2027"] });
  });

  const live = { id: "live", billing_mode: "hub_scheduled", billing_emails_enabled: false, schedule_start_date: null };
  const tagged = (id: string, option: string | null, due = "2027-02-04") => ({
    ...scheduleRow(id, "live", due),
    xero_tracking_option: option,
  });

  it("tags known options, leaves unknown ones untagged and reports them", async () => {
    const db = fakeDb({
      student_billing_schedule: [tagged("a", "Gap Year 2027"), tagged("b", "RR Uni")],
      programs: [live],
    });
    const res = await generateDueInvoices(db, { asOf: "2027-12-31", dryRun: false, autoSend: true });

    const lines = createScheduledInvoice.mock.calls[0][1].lineItems;
    expect(lines.map((l: { tracking: unknown }) => l.tracking)).toEqual([
      { category: "Schools", option: "Gap Year 2027" },
      null,
    ]);
    expect(res.invoices[0].warnings).toEqual([
      'SA Xero has no "Schools" option "RR Uni" — line left untagged',
    ]);
    // One read of the organisation's options for the whole run.
    expect(getXeroTrackingOptions).toHaveBeenCalledTimes(1);
  });

  it("never reads Xero tracking when no line asks for it", async () => {
    const db = fakeDb({ student_billing_schedule: [tagged("a", null)], programs: [live] });
    await generateDueInvoices(db, { asOf: "2027-12-31", dryRun: true, autoSend: true });
    expect(getXeroTrackingOptions).not.toHaveBeenCalled();
  });
});

describe("generateDueInvoices — school email outcomes", () => {
  beforeEach(() => {
    createScheduledInvoice.mockReset();
    createScheduledInvoice.mockResolvedValue({ success: true, invoiceId: "inv", invoiceNumber: "INV-9", status: "AUTHORISED" });
    sendSchoolInvoiceEmail.mockReset();
    getXeroTrackingOptions.mockReset();
  });
  const live = { id: "live", billing_mode: "hub_scheduled", billing_emails_enabled: true, schedule_start_date: null, email_template_za_id: "gap" };
  const tpl = (id: string, name: string, isDefault = false) => ({ id, name, xero_region: "za", subject: "s", body: "b", include_online_action: true, is_default: isDefault });

  it("uses the school's own template, and leaves it 'generated' with the error if the email fails", async () => {
    sendSchoolInvoiceEmail.mockResolvedValue({ ok: false, error: "Resend down" });
    const db = fakeDb({
      student_billing_schedule: [scheduleRow("a", "live", "2027-02-04")],
      programs: [live],
      invoice_email_templates: [tpl("basic", "Basic", true), tpl("gap", "Gap Year 2027")],
    });
    const res = await generateDueInvoices(db, { asOf: "2027-12-31", dryRun: false, autoSend: true });
    expect(sendSchoolInvoiceEmail.mock.calls[0][1].template.name).toBe("Gap Year 2027");
    expect(res.invoices[0]).toMatchObject({ status: "generated", emailTemplate: "SA · Gap Year 2027" });
    expect(res.invoices[0].error).toMatch(/Approved in Xero but the email failed: Resend down/);
  });

  it("previews which template each invoice would use", async () => {
    const db = fakeDb({
      student_billing_schedule: [scheduleRow("a", "live", "2027-02-04")],
      programs: [{ ...live, email_template_za_id: null }],
      invoice_email_templates: [tpl("basic", "Basic", true)],
    });
    const res = await generateDueInvoices(db, { asOf: "2027-12-31", dryRun: true, autoSend: true });
    expect(res.invoices[0]).toMatchObject({ status: "preview", emailTemplate: "SA · Basic" });
  });
});
