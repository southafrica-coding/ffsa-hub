import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { EmptyNote, PageHeading, SectionHeading } from "./department-ui";
import { MoneyCell } from "./money-cell";

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 px-5 pt-4 text-ui text-[color:var(--text-secondary)] md:px-8">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex items-center gap-2">
          {index > 0 ? <span aria-hidden>/</span> : null}
          {item.href ? (
            <Link href={item.href} className="text-link hover:underline">
              {item.label}
            </Link>
          ) : (
            <span className="text-ink">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 px-5 py-3 md:px-8">{children}</div>;
}

export function PropertyList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="border border-border">
      {items.map((item) => (
        <div key={item.label} className="grid grid-cols-[8.5rem_1fr] gap-3 border-b border-border px-3 py-2 last:border-b-0">
          <dt className="text-ui text-[color:var(--text-secondary)]">{item.label}</dt>
          <dd className="text-ui text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function KpiTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="border border-border bg-bg px-4 py-3">
      <div className="text-eyebrow">{label}</div>
      <div className="mt-2 font-mono text-kpi tabular-nums text-ink">{value}</div>
      {hint ? <p className="note mt-1 text-[color:var(--text-secondary)]">{hint}</p> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-bg-subtle", className)} aria-hidden />;
}

export function SideSheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <aside className="flex h-full w-full flex-col border-l border-border bg-bg sm:w-[320px]" aria-label={title}>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-section">{title}</h2>
        {onClose ? (
          <button type="button" onClick={onClose} className="text-ui">
            Close
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </aside>
  );
}

export function ListPage({
  context,
  title,
  action,
  filters,
  empty,
  children,
}: {
  context: string;
  title: string;
  action?: ReactNode;
  filters?: ReactNode;
  empty?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeading context={context} title={title} />
        {action ? <div className="px-5 pb-4 md:px-8">{action}</div> : null}
      </div>
      {filters ? <Toolbar>{filters}</Toolbar> : null}
      {empty ?? children}
    </div>
  );
}

export function DetailPage({
  context,
  title,
  status,
  actions,
  tabs,
  main,
  properties,
}: {
  context: string;
  title: string;
  status?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  main: ReactNode;
  properties?: ReactNode;
}) {
  return (
    <div>
      <PageHeading context={context} title={title} />
      <div className="flex flex-wrap items-center gap-3 px-5 py-3 md:px-8">
        {status}
        {actions}
      </div>
      {tabs}
      <div className="grid gap-6 px-5 py-4 md:px-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div>{main}</div>
        {properties ? <div className="lg:max-w-[280px]">{properties}</div> : null}
      </div>
    </div>
  );
}

export function DashboardPage({
  greeting,
  band,
  kpis,
  columns,
}: {
  greeting: string;
  band?: ReactNode;
  kpis?: ReactNode;
  columns: ReactNode;
}) {
  return (
    <div>
      <header className="px-5 py-5 md:px-8">
        <h1 className="hero-title">{greeting}</h1>
      </header>
      {band}
      {kpis ? <div className="grid gap-3 px-5 md:grid-cols-4 md:px-8">{kpis}</div> : null}
      <div className="grid gap-6 px-5 py-6 md:grid-cols-2 md:px-8">{columns}</div>
    </div>
  );
}

export function MoneyTablePage({
  context,
  title,
  filters,
  caption,
  columns,
  rows,
  totalCents,
}: {
  context: string;
  title: string;
  filters?: ReactNode;
  caption: string;
  columns: string[];
  rows: { cells: ReactNode[]; cents?: number }[];
  totalCents?: number;
}) {
  return (
    <div>
      <PageHeading context={context} title={title} />
      {filters ? <Toolbar>{filters}</Toolbar> : null}
      <div className="overflow-x-auto px-5 md:px-8">
        <table className="w-full text-left text-ui">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-bg-subtle">
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col" className="h-9 border-b border-border pr-4 font-medium text-[color:var(--text-secondary)]">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="hover:bg-bg-subtle">
                {row.cells.map((cell, cellIndex) => (
                  <td key={cellIndex} className="h-9 border-b border-border pr-4 align-middle">
                    {cellIndex === row.cells.length - 1 && row.cents !== undefined ? (
                      <MoneyCell cents={row.cents} />
                    ) : (
                      cell
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {totalCents !== undefined ? (
            <tfoot>
              <tr>
                <td className="h-9 pr-4 font-medium" colSpan={Math.max(columns.length - 1, 1)}>
                  Total
                </td>
                <td className="h-9">
                  <MoneyCell cents={totalCents} />
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

export function ServicePage({
  title,
  purpose,
  owner,
  action,
  steps,
  contact,
}: {
  title: string;
  purpose: string;
  owner: string;
  action?: ReactNode;
  steps?: string[];
  contact?: ReactNode;
}) {
  return (
    <article className="mx-auto w-full max-w-[640px] px-4 py-8">
      <p className="text-eyebrow">Service</p>
      <h1 className="hero-title mt-2">{title}</h1>
      <p className="mt-3 text-body text-[color:var(--text-secondary)]">{purpose}</p>
      <p className="mt-2 text-ui">Run by {owner}</p>
      {action ? <div className="mt-6">{action}</div> : null}
      {steps && steps.length > 0 ? (
        <div className="mt-8">
          <SectionHeading title="What happens next" />
          <ol className="list-decimal space-y-2 px-5 text-body md:px-8">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {contact ? <div className="mt-8 text-ui">{contact}</div> : null}
    </article>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <EmptyNote title={title}>{children}</EmptyNote>;
}
