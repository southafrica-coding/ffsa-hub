import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageFinance } from "@/lib/api-auth";
import { Masthead } from "@/components/ffsa";
import { InvoiceEmailTemplatesEditor, type EditorTemplate } from "./templates-editor";

// School invoice email templates (migration 237): word-for-word copies of
// finance's Xero templates, which the Hub sends school invoices from.
export default async function InvoiceEmailTemplatesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "finance");
  const canEdit = await canManageFinance(supabase, user.id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const [{ data: templates }, { data: programs }] = await Promise.all([
    admin
      .from("invoice_email_templates")
      .select("id, name, xero_region, subject, body, include_online_action, is_default, updated_at")
      .order("name", { ascending: true }),
    admin.from("programs").select("name, email_template_za_id, email_template_us_id"),
  ]);

  // Which schools use each template, so nobody edits one blind.
  const usedBy: Record<string, string[]> = {};
  for (const p of programs ?? []) {
    for (const id of [p.email_template_za_id, p.email_template_us_id]) {
      if (id) (usedBy[id] ??= []).push(p.name);
    }
  }

  return (
    <div className="ffsa-screen">
      <Masthead context="School fees" title="Invoice email templates" />
      <div className="px-4 py-6 md:px-8">
        <p className="mb-5 max-w-3xl text-[13px] text-[color:var(--text-secondary)]">
          Copied word for word from Xero (Settings → Email settings → Templates). The Hub sends school invoices
          from these because Xero can&apos;t choose a template when an invoice is emailed automatically. Placeholders
          work exactly as in Xero. Each school picks its template in its Fees &amp; billing settings.
        </p>
        <InvoiceEmailTemplatesEditor
          templates={(templates ?? []) as EditorTemplate[]}
          usedBy={usedBy}
          canEdit={canEdit}
        />
      </div>
    </div>
  );
}
