import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect, notFound } from "next/navigation";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  getConsentRecordById,
  getConsentAgreementByVersion,
} from "@/services/consent";
import { Markdown } from "@/components/markdown";
import { PrintButton } from "@/app/print/records-library/persons/[id]/print-button";

export const dynamic = "force-dynamic";

// Printable / screenshot-friendly view of ONE signed agreement. A user can
// open their own signed record (RLS); the Legal console / admins can open
// anyone's (service-role read behind the module gate). Renders the exact
// version that was accepted plus a signature block, on a light scheme.
export default async function PrintableAgreement({
  params,
}: {
  params: Promise<{ recordId: string }>;
}) {
  const { recordId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 1) Try to read it as the caller's own record (RLS returns only own rows).
  let { data: record } = await getConsentRecordById(supabase, recordId);

  // 2) Not theirs → only Legal / admins may view others' records.
  if (!record) {
    await requireModuleAccess(supabase, user.id, "legal"); // redirects if not allowed
    const admin = createAdminClient();
    const res = await getConsentRecordById(admin, recordId);
    record = res.data;
  }
  if (!record) notFound();

  // Agreement text is world-readable (RLS: anyone can read agreements).
  const { data: agreement } = await getConsentAgreementByVersion(
    supabase,
    record.agreement_version
  );
  if (!agreement) notFound();

  // Signer identity — a user row, or a public applicant's email.
  let signerName = record.applicant_email ?? "—";
  if (record.user_id) {
    const admin = createAdminClient();
    const { data: u } = await admin
      .from("users")
      .select("first_name, last_name, email")
      .eq("id", record.user_id)
      .single();
    if (u) {
      signerName =
        [u.first_name, u.last_name].filter(Boolean).join(" ") ||
        u.email ||
        record.user_id;
    }
  }

  const signedAt = new Date(record.accepted_at).toLocaleString("en-ZA", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Africa/Johannesburg",
  });

  return (
    <div
      className="min-h-screen"
      style={{ background: "#ffffff", color: "#0f172a", colorScheme: "light" }}
    >
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { margin: 18mm; }
          body { background: #ffffff !important; }
        }
      `}</style>

      <div className="max-w-3xl mx-auto px-8 py-8">
        {/* Print bar — hidden when printing */}
        <div className="no-print flex items-center justify-between mb-6 pb-4 border-b border-slate-200">
          <p className="text-xs uppercase tracking-widest text-slate-500">
            FFSA Hub · Signed Agreement
          </p>
          <PrintButton />
        </div>

        {/* Signature block — the evidentiary summary */}
        <div className="mb-8 rounded-lg border border-slate-300 p-4 text-sm">
          <p className="text-xs uppercase tracking-widest text-slate-500 mb-2">
            Acceptance record
          </p>
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1">
            <dt className="text-slate-500">Signed by</dt>
            <dd className="font-medium">{signerName}</dd>
            <dt className="text-slate-500">Agreement</dt>
            <dd>{agreement.title}</dd>
            <dt className="text-slate-500">Version</dt>
            <dd className="font-mono">{record.agreement_version}</dd>
            <dt className="text-slate-500">Accepted</dt>
            <dd>{signedAt} (SAST)</dd>
            <dt className="text-slate-500">Via</dt>
            <dd className="capitalize">{record.source}</dd>
            {record.ip_address && (
              <>
                <dt className="text-slate-500">IP address</dt>
                <dd className="font-mono">{record.ip_address}</dd>
              </>
            )}
          </dl>
        </div>

        {/* The exact agreement text that was accepted */}
        <article className="prose prose-slate max-w-none">
          <Markdown source={agreement.body_markdown} />
        </article>
      </div>
    </div>
  );
}
