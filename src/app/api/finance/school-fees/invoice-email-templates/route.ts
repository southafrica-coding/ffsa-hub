import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageFinance } from "@/lib/api-auth";
import { createAuditLog } from "@/services/audit";
import { fillPlaceholders, placeholderValues } from "@/lib/finance/invoice-email";

// School invoice email templates (migration 237) — copies of finance's Xero
// templates that the Hub sends invoices from.
//
// POST { xero_region, name, subject, body, include_online_action }  → create
// PUT  { id, name?, subject?, body?, include_online_action? }        → edit

const SAMPLE = placeholderValues({
  contactFirstName: "A",
  contactName: "A",
  tradingName: "A",
  invoiceNumber: "A",
  currencyCode: "A",
  invoiceTotal: 0,
  amountDue: 0,
  dueDate: "2027-01-01",
  onlineInvoiceUrl: "A",
});

async function gate() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!(await canManageFinance(supabase, user.id))) {
    return { error: NextResponse.json({ error: "Finance access required" }, { status: 403 }) };
  }
  return { supabase, user };
}

function validate(subject: unknown, body: unknown): string | null {
  if (typeof subject !== "string" || !subject.trim()) return "Subject is required";
  if (typeof body !== "string" || !body.trim()) return "Message is required";
  const unknown = [...fillPlaceholders(subject, SAMPLE).unknown, ...fillPlaceholders(body, SAMPLE).unknown];
  if (unknown.length) return `Unknown placeholder${unknown.length > 1 ? "s" : ""}: ${unknown.map((u) => `[${u}]`).join(", ")}`;
  return null;
}

export async function POST(request: Request) {
  const g = await gate();
  if ("error" in g) return g.error;
  const b = await request.json().catch(() => ({}));
  if (b.xero_region !== "za" && b.xero_region !== "us") return NextResponse.json({ error: "Pick SA or US" }, { status: 400 });
  if (typeof b.name !== "string" || !b.name.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  const bad = validate(b.subject, b.body);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, error } = await admin
    .from("invoice_email_templates")
    .insert({
      xero_region: b.xero_region,
      name: b.name.trim(),
      subject: b.subject,
      body: b.body,
      include_online_action: b.include_online_action !== false,
      updated_by: g.user.id,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await createAuditLog(g.supabase, { action: "invoice_email_template.create", resource_type: "invoice_email_template", resource_id: data.id, changes: { name: data.name, xero_region: data.xero_region } });
  return NextResponse.json({ success: true, template: data });
}

export async function PUT(request: Request) {
  const g = await gate();
  if ("error" in g) return g.error;
  const b = await request.json().catch(() => ({}));
  if (typeof b.id !== "string") return NextResponse.json({ error: "id is required" }, { status: 400 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: before } = await admin.from("invoice_email_templates").select("*").eq("id", b.id).maybeSingle();
  if (!before) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const next = {
    name: typeof b.name === "string" && b.name.trim() ? b.name.trim() : before.name,
    subject: b.subject ?? before.subject,
    body: b.body ?? before.body,
    include_online_action: typeof b.include_online_action === "boolean" ? b.include_online_action : before.include_online_action,
  };
  const bad = validate(next.subject, next.body);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });

  const { data, error } = await admin
    .from("invoice_email_templates")
    .update({ ...next, updated_by: g.user.id })
    .eq("id", b.id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // Keep the previous wording in the audit log — these change every intake.
  await createAuditLog(g.supabase, {
    action: "invoice_email_template.update",
    resource_type: "invoice_email_template",
    resource_id: b.id,
    changes: { before: { name: before.name, subject: before.subject, body: before.body, include_online_action: before.include_online_action } },
  });
  return NextResponse.json({ success: true, template: data });
}
