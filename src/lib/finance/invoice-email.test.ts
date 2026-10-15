import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fillPlaceholders, placeholderValues, renderInvoiceEmail, type InvoiceEmailData } from "./invoice-email";

const data: InvoiceEmailData = {
  contactFirstName: "Thandi",
  contactName: "Thandi Nkosi",
  tradingName: "Fire & Fragrance SA NPC",
  invoiceNumber: "INV-12345",
  currencyCode: "ZAR",
  invoiceTotal: 51000,
  amountDue: 45000,
  dueDate: "2027-03-04",
  onlineInvoiceUrl: "https://in.xero.com/abc123",
};

// The seeded templates, straight out of migration 237 — so these tests run
// against the exact text finance copied from Xero.
function seededTemplates(): Array<{ region: string; name: string; subject: string; body: string }> {
  const sql = readFileSync(
    path.resolve(__dirname, "../../../supabase/migrations/237_hub_invoice_emails.sql"),
    "utf8"
  );
  const rows = [...sql.matchAll(/\('(za|us)', \$tpl\$([\s\S]*?)\$tpl\$, \$tpl\$([\s\S]*?)\$tpl\$, \$tpl\$([\s\S]*?)\$tpl\$/g)];
  return rows.map((m) => ({ region: m[1], name: m[2], subject: m[3], body: m[4] }));
}

describe("fillPlaceholders", () => {
  it("fills Xero's placeholders and reports anything it doesn't know", () => {
    const r = fillPlaceholders("Hi [Contact First Name], [Unknown Thing] [Invoice Number]", placeholderValues(data));
    expect(r.text).toBe("Hi Thandi, [Unknown Thing] INV-12345");
    expect(r.unknown).toEqual(["Unknown Thing"]);
  });

  it("leaves non-placeholder brackets like [ex. A] alone", () => {
    expect(fillPlaceholders("(ex. A. Smith EFL)", placeholderValues(data)).text).toBe("(ex. A. Smith EFL)");
  });
});

describe("renderInvoiceEmail", () => {
  const gap = { subject: "Invoice [Invoice Number] from [Trading Name] for [Contact Name]", body: "Here's invoice [Invoice Number] for [Currency Code] [Invoice Total Without Currency].\nThe amount outstanding of [Currency Code] [Amount Due Without Currency] is due on [Due Date].\n\nView your bill online: [Online Invoice Link]\n\nhttps://pos.snapscan.io/qr/kEJeE7Ci", include_online_action: true };

  it("renders subject and body with Xero's formats", () => {
    const r = renderInvoiceEmail(gap, data);
    expect(r.subject).toBe("Invoice INV-12345 from Fire & Fragrance SA NPC for Thandi Nkosi");
    expect(r.text).toContain("Here's invoice INV-12345 for ZAR 51,000.00.");
    expect(r.text).toContain("The amount outstanding of ZAR 45,000.00 is due on 4 Mar 2027.");
    expect(r.text).toContain("View your bill online: https://in.xero.com/abc123");
  });

  it("makes links clickable, escapes HTML and adds the View invoice action", () => {
    const r = renderInvoiceEmail({ ...gap, body: gap.body + "\nA & B <b>" }, data);
    expect(r.html).toContain('<a href="https://pos.snapscan.io/qr/kEJeE7Ci"');
    expect(r.html).toContain("A &amp; B &lt;b&gt;");
    expect(r.html).toContain(">View invoice</a>");
    expect(r.html).toContain("ZAR 45,000.00");
  });

  it("omits the action when the template has it switched off or there's no link", () => {
    expect(renderInvoiceEmail({ ...gap, include_online_action: false }, data).html).not.toContain("View invoice</a>");
    expect(renderInvoiceEmail(gap, { ...data, onlineInvoiceUrl: null }).html).not.toContain("View invoice</a>");
  });

  it("every copied Xero template renders with no unknown placeholders", () => {
    const all = seededTemplates();
    expect(all).toHaveLength(18);
    for (const t of all) {
      const r = renderInvoiceEmail({ subject: t.subject, body: t.body, include_online_action: true }, data);
      expect(r.unknownPlaceholders, `${t.region} ${t.name}`).toEqual([]);
      expect(r.text, `${t.region} ${t.name}`).not.toMatch(/\[(Contact|Invoice|Amount|Due|Currency|Trading|Online)/);
    }
  });
});
