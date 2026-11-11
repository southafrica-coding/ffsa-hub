import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getFinanceHubAccess } from "@/lib/finance-access";
import {
  Globe,
  Wallet,
  CreditCard,
  Home,
  HeartHandshake,
  FolderKanban,
  BookOpen,
  type LucideIcon,
} from "lucide-react";
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

type FinanceModule = {
  title: string;
  description: string;
  /** Omitted until the page exists. A missing href is never rendered as a link. */
  href?: string;
  icon: LucideIcon;
  ready: boolean;
};

const FINANCE_MODULES: FinanceModule[] = [
  {
    title: "Outreach Finance",
    description: "Track budgets, expenses, receipts, cash batches, and closeouts for international outreach teams.",
    href: "/finance/outreach",
    icon: Globe,
    ready: true,
  },
  {
    title: "Staff Fees",
    description: "Monthly staff fees (R100/month), payment tracking, and status.",
    icon: CreditCard,
    ready: false,
  },
  {
    title: "Rent & Housing",
    description: "Rent payments, housing allocations, and payment history.",
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
        (m) => m.href === "/finance/outreach" || (financeOffice && m.href === "/finance/donor-statements")
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

      <div className="space-y-7 px-5 py-6 md:px-8 md:py-7">
        <div className="border border-ink">
          <SectionBar title="Modules" meta={`${liveCount} of ${modules.length} live`} />
          <div className="md:hidden">
            {modules.map((mod) => {
              const Icon = mod.icon;
              const body = (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Icon className="h-4 w-4 shrink-0 text-[color:var(--text-tertiary)]" />
                      <span className="font-display text-[20px] font-black uppercase leading-none">{mod.title}</span>
                    </span>
                    <StatusPill tone={mod.ready ? "good" : "quiet"}>
                      {mod.ready ? "Live" : "Coming soon"}
                    </StatusPill>
                  </div>
                  <p className="mt-2 text-[13px] leading-snug text-[color:var(--text-secondary)]">{mod.description}</p>
                </>
              );
              return mod.ready && mod.href ? (
                <Link key={mod.title} href={mod.href} className="block border-b border-rule px-4 py-4 last:border-b-0">
                  {body}
                </Link>
              ) : (
                <div key={mod.title} className="border-b border-rule px-4 py-4 last:border-b-0">
                  <span className="block">
                    {body}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="hidden md:block">
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
                  <TableRow key={mod.title}>
                    <TableCell className="align-top">
                      <div className="flex items-center gap-2.5">
                        <Icon className="h-4 w-4 shrink-0 text-[color:var(--text-tertiary)]" />
                        {mod.ready && mod.href ? (
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
                        {mod.ready ? "Live" : "Coming soon"}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="align-top text-right">
                      {mod.ready && mod.href ? (
                        <Link
                          href={mod.href}
                          className="inline-block border border-ink bg-ink px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-white"
                        >
                          Open
                        </Link>
                      ) : (
                        <span aria-hidden="true" className="mono-label">
                          —
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
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
