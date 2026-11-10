import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Thin local stand-ins for the department, services and home pages.
 * To move into DS-2 once the shared page templates land.
 *
 * Headings are sentence case. The current global h1–h6 rule uppercases
 * them, so these set `normal-case` until that template replaces them.
 */

export function PageHeading({ context, title }: { context: string; title: string }) {
  return (
    <header className="border-b px-5 py-5 md:px-8">
      <p className="text-sm text-muted-foreground">{context}</p>
      <h1 className="mt-1 font-sans text-2xl font-semibold normal-case tracking-normal">
        {title}
      </h1>
    </header>
  );
}

export function SectionHeading({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-6 md:px-8">
      <h2 className="font-sans text-lg font-semibold normal-case tracking-normal">{title}</h2>
      {meta ? <p className="text-sm text-muted-foreground">{meta}</p> : null}
    </div>
  );
}

export function EmptyNote({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-5 py-6 md:px-8">
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 max-w-prose text-sm text-muted-foreground">{children}</div> : null}
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
    <nav aria-label={label} className="flex flex-wrap gap-x-4 gap-y-2 border-b px-5 py-3 md:px-8">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? "page" : undefined}
          className="text-sm underline-offset-4 aria-[current=page]:underline"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function StackLink({ href, title, meta }: { href: string; title: string; meta?: string }) {
  return (
    <Link href={href} className="block border-b px-5 py-3 md:px-8">
      <span className="font-medium">{title}</span>
      {meta ? <span className="mt-0.5 block text-sm text-muted-foreground">{meta}</span> : null}
    </Link>
  );
}

export function DataTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto px-5 md:px-8">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="border-b py-2 pr-4 font-sans text-sm font-medium normal-case">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border-b py-2 pr-4 align-top">
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
  managing,
  audience,
}: {
  href: string;
  name: string;
  summary: string;
  managing: string;
  audience: string;
}) {
  return (
    <Link href={href} className="block border p-4">
      <h2 className="font-sans text-base font-semibold normal-case tracking-normal">{name}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
      <p className="mt-3 text-sm">{managing}</p>
      <p className="text-sm text-muted-foreground">{audience}</p>
    </Link>
  );
}
