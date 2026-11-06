import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getFinanceHubAccess } from "@/lib/finance-access";
import { Globe, Wallet, CreditCard, Home, HeartHandshake, FolderKanban, BookOpen, Sheet } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Masthead, SectionBar, StatusPill } from "@/components/ffsa";
import { XeroConnection } from "./xero-connection";
import { XeroSyncStatus } from "./xero-sync-status";
import {
  canEditFinanceProjects,
  canReadFinanceXero,
  listFinanceOrgs,
  type FinanceOrg,
} from "@/lib/finance/orgs";
import { getXeroMirrorFreshness } from "@/lib/finance/xero-mirror-sync";

const FINANCE_MODULES = [
  {
    title: "Outreach Finance",
    description: "Track budgets, expenses, receipts, cash batches, and closeouts for international outreach teams.",
    href: "/finance/outreach",
    icon: Globe,
    ready: true,
  },
  {
    title: "Budgets",
    description:
      "A team budget sheet for South Africa, in rand: overview, dashboard, variable and fixed costs, an expense tracker and notes. One owner and a real period. Separate from outreach cash.",
    href: "/finance/budgets",
    icon: Sheet,
    ready: true,
  },
  {
    title: "Staff Fees",
    description: "Monthly staff fees (R100/month), payment tracking, and status.",
    href: "/finance/staff-fees",
    icon: CreditCard,
    ready: false,
  },
  {
    title: "Rent & Housing",
    description: "Rent payments, housing allocations, and payment history.",
    href: "/finance/rent",
    icon: Home,
    ready: false,
  },
  {
    title: "School Fees",
    description: "Tiered school fee tracking, student payments, and outstanding balances.",
    href: "/finance/school-fees",
    icon: Wallet,
    ready: true,
  },
  {
    title: "Donor Statements",
    description: "Year-end giving statements for US donors to FF SA USA, INC: import from Xero, review, send.",
    href: "/finance/donor-statements",
    icon: HeartHandshake,
    ready: true,
  },
  {
    title: "Projects",
    description: "Each organisation's Xero Ministries options (FFSA NPC and FF USA Inc), kept in step with Xero, with an optional type.",
    href: "/finance/projects",
    icon: FolderKanban,
    ready: true,
  },
  {
    title: "Chart of Accounts",
    description: "Each organisation's accounts exactly as Xero has them, kept in step automatically. Read-only.",
    href: "/finance/accounts",
    icon: BookOpen,
    ready: true,
  },
];

export default async function FinancePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // Anyone can run an outreach budget, so Outreach Finance is open to all.
  // The Finance Office role (migration 248) also runs donor statements;
  // finance staff see every module and the Xero card.
  const { fullFinance, financeOffice } = await getFinanceHubAccess(supabase, user.id);
  const modules = fullFinance
    ? FINANCE_MODULES
    : FINANCE_MODULES.filter(
        (m) =>
          m.href === "/finance/outreach" ||
          (financeOffice && (m.href === "/finance/donor-statements" || m.href === "/finance/budgets"))
      );
  const liveCount = modules.filter((m) => m.ready).length;

  // How current the Hub's copy of each Xero file is. Opening this page also
  // refreshes it when it's over 5 minutes old (XeroSyncStatus).
  const xeroMirror = fullFinance && (await canReadFinanceXero(supabase, user.id))
    ? await Promise.all([
        listFinanceOrgs(supabase),
        getXeroMirrorFreshness(supabase),
        canEditFinanceProjects(supabase, user.id),
      ])
    : null;

  return (
    <div className="ffsa-screen">
      <Masthead context="Financial management" title="Finance" />

      <div className="space-y-7 px-8 py-7">
        <div className="border border-ink">
          <SectionBar title="Modules" meta={`${liveCount} of ${modules.length} live`} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Module</TableHead>
                <TableHead>What it covers</TableHead>
                <TableHead className="w-[120px]">State</TableHead>
                <TableHead className="w-[90px] text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {modules.map((mod) => {
                const Icon = mod.icon;
                return (
                  <TableRow key={mod.title} className={mod.ready ? undefined : "opacity-55"}>
                    <TableCell className="align-top">
                      <div className="flex items-center gap-2.5">
                        <Icon className="h-4 w-4 shrink-0 text-[color:var(--text-tertiary)]" />
                        {mod.ready ? (
                          <Link href={mod.href} className="font-display text-[19px] font-black uppercase leading-none hover:text-electric">
                            {mod.title}
                          </Link>
                        ) : (
                          <span className="font-display text-[19px] font-black uppercase leading-none">
                            {mod.title}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-[13px] text-[color:var(--text-secondary)]">
                      {mod.description}
                    </TableCell>
                    <TableCell className="align-top">
                      <StatusPill tone={mod.ready ? "good" : "quiet"}>
                        {mod.ready ? "Live" : "Soon"}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="align-top text-right">
                      {mod.ready ? (
                        <Link
                          href={mod.href}
                          className="inline-block border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white"
                        >
                          Open
                        </Link>
                      ) : (
                        <span className="mono-label">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Integrations */}
        {fullFinance && (
          <Suspense>
            <XeroConnection />
          </Suspense>
        )}
        {xeroMirror && (
          <XeroSyncStatus
            orgs={((xeroMirror[0].data ?? []) as FinanceOrg[]).map((o) => ({ region: o.xero_region, name: o.name }))}
            freshness={xeroMirror[1]}
            canSyncNow={xeroMirror[2]}
          />
        )}
      </div>
    </div>
  );
}
