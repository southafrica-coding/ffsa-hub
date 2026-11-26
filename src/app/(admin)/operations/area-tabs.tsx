import Link from "next/link";
import { AREAS, type AreaKey } from "@/lib/operations/areas";
import { cn } from "@/lib/utils/cn";

// Areas with a page of their own; the rest are a tab of /operations.
const OWN_PAGE: Partial<Record<AreaKey, string>> = {
  teams: "/operations/visiting-teams",
};

export const areaHref = (key: AreaKey) => OWN_PAGE[key] ?? `/operations?area=${key}`;

/** The area tabs. Scrolls sideways on its own at 390px; the page never does. */
export function AreaTabs({ current }: { current: AreaKey }) {
  return (
    <nav className="flex overflow-x-auto border-b border-ink px-5 pt-4 md:px-8" aria-label="Areas">
      {AREAS.map((a) => (
        <Link
          key={a.key}
          href={areaHref(a.key)}
          aria-current={a.key === current ? "page" : undefined}
          className={cn(
            "flex min-h-11 shrink-0 items-center px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em]",
            a.key === current ? "bg-ink text-white" : "border border-b-0 border-rule text-[color:var(--text-tertiary)] hover:text-ink"
          )}
        >
          {a.label}
        </Link>
      ))}
    </nav>
  );
}
