import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/**
 * Shared stand-ins first used by the department and services pages
 * (previously src/app/(admin)/departments/local-ui.tsx).
 * Props match that file so those pages can switch their imports.
 *
 * Page titles use the shared page-title class (Roboto, --title-weight, uppercase).
 * Section titles stay sentence case.
 */

export function PageHeading({ context, title }: { context: string; title: string }) {
  return (
    <header className="border-b border-border px-5 py-5 md:px-8">
      <p className="text-eyebrow">{context}</p>
      <h1 className="page-title mt-2">{title}</h1>
    </header>
  );
}

export function SectionHeading({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-6 md:px-8">
      <h2 className="text-section text-ink">{title}</h2>
      {meta ? <p className="text-ui text-[color:var(--text-secondary)]">{meta}</p> : null}
    </div>
  );
}

export function EmptyNote({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-5 py-6 md:px-8">
      <p className="text-ui font-medium text-ink">{title}</p>
      {children ? (
        <div className="mt-1 max-w-prose text-body text-[color:var(--text-secondary)]">{children}</div>
      ) : null}
    </div>
  );
}

export function LocalTabs({
  label,
  tabs,
  active,
}: {
  label: string;
  tabs: { key: string; label: string; href: string }[];
  active: string;
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-x-4 gap-y-2 border-b border-border px-5 py-3 md:px-8">
      {tabs.map((tab) => {
        const on = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "text-ui text-[color:var(--text-secondary)] underline-offset-4 hover:text-ink",
              on && "font-medium text-ink underline"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function StackLink({ href, title, meta }: { href: string; title: string; meta?: string }) {
  return (
    <Link href={href} className="block border-b border-border px-5 py-3 hover:bg-bg-subtle md:px-8">
      <span className="text-ui font-medium text-ink">{title}</span>
      {meta ? <span className="mt-0.5 block text-ui text-[color:var(--text-secondary)]">{meta}</span> : null}
    </Link>
  );
}

export function DataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto px-5 md:px-8">
      <table className="w-full border-collapse text-left text-ui">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-bg-subtle">
          <tr>
            {columns.map((column, index) => (
              <th
                key={`${column}-${index}`}
                scope="col"
                className="h-9 border-b border-border py-2 pr-4 text-left text-ui font-medium text-[color:var(--text-secondary)]"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="hover:bg-bg-subtle">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="h-9 border-b border-border py-2 pr-4 align-middle text-ink">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ServiceCard({
  href,
  name,
  summary,
  owner,
}: {
  href: string;
  name: string;
  summary: string;
  owner: string;
}) {
  return (
    <Link href={href} className="block rounded-lg border border-border bg-bg p-4 hover:border-rule-strong">
      <h2 className="text-card-title text-ink">{name}</h2>
      <p className="mt-1 text-body text-[color:var(--text-secondary)]">{summary}</p>
      <p className="mt-3 text-ui text-ink">{owner}</p>
    </Link>
  );
}
