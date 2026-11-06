import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModuleAccess } from "@/lib/require-permission";
import {
  canEditFinanceProjects,
  canReadFinanceXero,
  listFinanceOrgs,
  type FinanceOrg,
} from "@/lib/finance/orgs";
import { getXeroMirrorFreshness } from "@/lib/finance/xero-mirror-sync";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Masthead, SectionBar, StatusPill } from "@/components/ffsa";
import { XeroSyncStatus } from "../xero-sync-status";

type AccountRow = {
  id: string;
  org_region: "za" | "us";
  code: string | null;
  name: string;
  friendly_name: string | null;
  type: string | null;
  class: string | null;
  status: "active" | "archived";
  missing_since: string | null;
};

// Each org's chart of accounts exactly as Xero has it (migration 275),
// kept in step automatically. Read-only: the Hub never writes to Xero, and
// nothing here asks for an account code yet (that stays on hold).
export default async function FinanceAccountsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  await requireModuleAccess(supabase, user.id, "finance");

  const [canRead, canEdit] = await Promise.all([
    canReadFinanceXero(supabase, user.id),
    canEditFinanceProjects(supabase, user.id),
  ]);
  if (!canRead) redirect("/finance");

  const [{ data: orgs }, { data: accounts }, freshness] = await Promise.all([
    listFinanceOrgs(supabase),
    supabase
      .from("xero_accounts")
      .select("id, org_region, code, name, friendly_name, type, class, status, missing_since")
      .order("code", { ascending: true, nullsFirst: false })
      .order("name"),
    getXeroMirrorFreshness(supabase),
  ]);
  const orgList = (orgs ?? []) as FinanceOrg[];
  const rows = (accounts ?? []) as AccountRow[];

  return (
    <div className="ffsa-screen">
      <Masthead
        context="Finance · From Xero"
        title="Chart of accounts"
        actions={
          <Link
            href="/finance"
            className="inline-block border border-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em]"
          >
            &larr; Finance
          </Link>
        }
      />
      <div className="space-y-7 px-5 py-6 md:px-8 md:py-7">
        <XeroSyncStatus
          orgs={orgList.map((o) => ({ region: o.xero_region, name: o.name }))}
          freshness={freshness}
          canSyncNow={canEdit}
        />

        {orgList.map((org) => {
          const list = rows.filter((a) => a.org_region === org.xero_region);
          const live = list.filter((a) => a.status === "active" && !a.missing_since).length;
          return (
            <div key={org.id} className="border border-ink">
              <SectionBar title={`${org.name} (${org.record_currency})`} meta={`${live} active of ${list.length}`} />
              <Table className="phone-stack">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[90px]">Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-[160px]">Type</TableHead>
                    <TableHead className="w-[150px]">In Xero</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((a) => (
                    <TableRow key={a.id} className={a.status === "active" && !a.missing_since ? undefined : "opacity-60"}>
                      <TableCell data-label="Code" className="font-mono text-[12px] tabular-nums">{a.code ?? "—"}</TableCell>
                      <TableCell data-label="Name" className="text-sm">
                        {a.name}
                        {a.friendly_name && (
                          <span className="ml-2 text-[12px] text-[color:var(--text-secondary)]">({a.friendly_name})</span>
                        )}
                      </TableCell>
                      <TableCell data-label="Type" className="text-[12px] text-[color:var(--text-secondary)]">
                        {[a.class, a.type].filter(Boolean).join(" · ") || "—"}
                      </TableCell>
                      <TableCell data-label="In Xero">
                        <StatusPill tone={a.missing_since ? "quiet" : a.status === "active" ? "good" : "quiet"}>
                          {a.missing_since ? "Gone from Xero" : a.status === "active" ? "Active" : "Archived"}
                        </StatusPill>
                      </TableCell>
                    </TableRow>
                  ))}
                  {list.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-sm text-[color:var(--text-secondary)]">
                        Nothing read from Xero for {org.name} yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
