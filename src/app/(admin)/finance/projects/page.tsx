import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/require-permission";
import { getFinanceHubAccess } from "@/lib/finance-access";
import {
  canEditFinanceProjects,
  listFinanceOrgs,
  listFinanceProjects,
  type FinanceOrg,
  type FinanceProject,
} from "@/lib/finance/orgs";
import { Masthead } from "@/components/ffsa";
import { ProjectsList } from "./projects-list";

// Each org's Xero "Ministries" options (migration 290). Names come from Xero
// and are read-only here; finance can set a Type. Nothing is deleted.
export default async function FinanceProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "finance");

  const [{ fullFinance }, canEdit] = await Promise.all([
    getFinanceHubAccess(supabase, user.id),
    canEditFinanceProjects(supabase, user.id),
  ]);
  if (!fullFinance && !canEdit) redirect("/finance");

  const [{ data: orgs }, { data: projects }] = await Promise.all([
    listFinanceOrgs(supabase),
    listFinanceProjects(supabase),
  ]);

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Finance · Xero Ministries tracking"
        title="Projects"
        actions={
          <Link
            href="/finance"
            className="inline-block border border-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em]"
          >
            &larr; Finance
          </Link>
        }
      />
      <ProjectsList
        orgs={(orgs ?? []) as FinanceOrg[]}
        projects={(projects ?? []) as FinanceProject[]}
        canEdit={canEdit}
      />
    </div>
  );
}
