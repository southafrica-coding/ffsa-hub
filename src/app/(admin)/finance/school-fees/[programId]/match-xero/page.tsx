import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageFinance } from "@/lib/api-auth";
import { Masthead } from "@/components/ffsa";
import { MatchToXero } from "./match-to-xero";

// Match to Xero: bring a school that was invoiced by hand onto Hub billing
// without invoicing anyone twice (src/services/xero-match.ts).
export default async function MatchToXeroPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const canEdit = user ? await canManageFinance(supabase, user.id) : false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: program } = await admin
    .from("programs")
    .select("id, name, billing_mode, billing_emails_enabled")
    .eq("id", programId)
    .single();
  if (!program) {
    return (
      <div className="ffsa-screen">
        <p className="px-5 py-8 text-sm text-destructive md:px-8">School not found.</p>
      </div>
    );
  }

  return (
    <div className="ffsa-screen">
      <Masthead
        context={`School fees · ${program.name}`}
        title="Match to Xero"
        actions={
          <Link
            href={`/finance/school-fees/${programId}/students`}
            className="inline-block border border-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em]"
          >
            &larr; Student billing
          </Link>
        }
      />
      <div className="space-y-6 px-5 py-6 md:px-8 md:py-7">
        <MatchToXero
          programId={programId}
          canEdit={canEdit}
          hubBilled={program.billing_mode === "hub_scheduled"}
          emailsOn={program.billing_emails_enabled === true}
        />
      </div>
    </div>
  );
}
