"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Chip } from "@/components/ffsa";

// Rebuilt onto the system: this nav was still carrying the dark theme's
// hardcoded HSL values (yellow text on a dark rule) inline, which the light
// redesign has no place for. It is now the same hairline chip strip the
// Events screen uses, so the two modules read as one app.

type Tab = {
  key: string;
  label: string;
  href: string;
  badgeCount?: number | null;
};

export function ContactsTabsNav({
  followupPendingCount,
}: {
  followupPendingCount: number | null;
}) {
  const pathname = usePathname();

  const tabs: Tab[] = [
    { key: "list", label: "All contacts", href: "/contacts" },
    { key: "lists", label: "Lists", href: "/contacts/lists" },
    {
      key: "event-followup",
      label: "Event follow-up",
      href: "/contacts/event-followup",
      badgeCount: followupPendingCount,
    },
    {
      key: "duplicates",
      label: "Possible duplicates",
      href: "/contacts/duplicates",
    },
  ];

  function isActive(tab: Tab) {
    if (tab.key === "list") return pathname === "/contacts";
    return pathname.startsWith(tab.href);
  }

  return (
    <nav className="flex flex-wrap items-center gap-1.5 border-b border-rule bg-bone px-5 py-3 md:px-8">
      {tabs.map((tab) => {
        const active = isActive(tab);
        const badge =
          tab.badgeCount !== undefined &&
          tab.badgeCount !== null &&
          tab.badgeCount > 0
            ? tab.badgeCount
            : null;
        return (
          <Link key={tab.key} href={tab.href}>
            <Chip active={active}>
              {tab.label}
              {badge !== null && (
                // Square, never a pill — and it inverts with the chip so the
                // count stays readable on the active black ground.
                <span
                  className={
                    active
                      ? "bg-yellow px-1.5 py-0.5 text-ink"
                      : "bg-ink px-1.5 py-0.5 text-white"
                  }
                >
                  {badge}
                </span>
              )}
            </Chip>
          </Link>
        );
      })}
    </nav>
  );
}
