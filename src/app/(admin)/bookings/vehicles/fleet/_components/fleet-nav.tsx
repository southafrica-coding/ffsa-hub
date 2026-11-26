"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { FLEET, FLEET_CALENDAR } from "./ui";

// The Fleet tab strip, in the Fleet app's order. Today is Fleet's landing page.
const TABS = [
  { href: FLEET, label: "Today", match: (p: string) => p === FLEET },
  { href: `${FLEET}/vehicles`, label: "Vehicles", match: (p: string) => p === `${FLEET}/vehicles` || /^\/bookings\/vehicles\/fleet\/[0-9a-f-]{36}/.test(p) || p.startsWith(`${FLEET}/inspections`) },
  { href: FLEET_CALENDAR, label: "Calendar" },
  { href: `${FLEET}/schedule`, label: "Schedule" },
  { href: `${FLEET}/workshops`, label: "Workshops" },
  { href: `${FLEET}/checklist`, label: "Checklist" },
  { href: `${FLEET}/guide`, label: "Guide" },
  { href: `${FLEET}/settings`, label: "Settings" },
];

/** `calendar`: show the Calendar tab, which opens the booking board (vehicles team only). */
export function FleetNav({ calendar = true }: { calendar?: boolean }) {
  const path = usePathname() || "";
  const tabs = calendar ? TABS : TABS.filter((t) => t.href !== FLEET_CALENDAR);
  return (
    // Phones: two rows of four, so every tab — and the one you're on — is
    // visible. A single scrolling row clipped "Workshops" to "WOR" and hid
    // Checklist, Guide and Settings off the edge. One row from md up.
    <nav aria-label="Fleet" className="grid grid-cols-4 border-b border-ink px-3 pt-3 md:flex md:flex-wrap md:items-end md:px-8">
      {tabs.map((t) => {
        const on = t.match ? t.match(path) : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex min-h-11 min-w-0 items-center justify-center whitespace-nowrap px-1 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] md:shrink-0 md:justify-start md:px-3.5 md:tracking-[0.14em]",
              on ? "bg-ink text-white" : "text-[color:var(--text-tertiary)] hover:text-ink"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
