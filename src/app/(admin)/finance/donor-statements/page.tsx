import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/require-permission";
import { authorizeDonorStatements } from "@/lib/finance/donor-statements-server";
import { Masthead } from "@/components/ffsa";
import { DonorStatements } from "./donor-statements";

// Year-end giving statements for FF SA USA, INC (the US 501(c)(3)). Phase 1:
// settings, importing a tax year's donations and reviewing the donor list.
export default async function DonorStatementsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "finance");
  const auth = await authorizeDonorStatements();
  if ("error" in auth) redirect("/finance");

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Finance · FF SA USA, INC"
        title="Donor Statements"
        actions={
          <Link
            href="/finance"
            className="inline-block border border-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em]"
          >
            &larr; Finance
          </Link>
        }
      />
      <DonorStatements />
    </div>
  );
}
