"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
    { key: "list", label: "All Contacts", href: "/contacts" },
    { key: "lists", label: "Lists", href: "/contacts/lists" },
    {
      key: "event-followup",
      label: "Event Follow-up",
      href: "/contacts/event-followup",
      badgeCount: followupPendingCount,
    },
    {
      key: "duplicates",
      label: "Possible Duplicates",
      href: "/contacts/duplicates",
    },
  ];

  function isActive(tab: Tab) {
    if (tab.key === "list") {
      return pathname === "/contacts";
    }
    return pathname.startsWith(tab.href);
  }

  return (
    <nav
      className="flex items-center gap-1 border-b"
      style={{ borderColor: "hsl(22 8% 14%)" }}
    >
      {tabs.map((tab) => {
        const active = isActive(tab);
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className="relative inline-flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors"
            style={{
              color: active ? "#0A0A0A" : "#7C786C",
              borderBottom: active
                ? "2px solid #0A0A0A"
                : "2px solid transparent",
              marginBottom: "-1px",
            }}
          >
            {tab.label}
            {tab.badgeCount !== undefined &&
              tab.badgeCount !== null &&
              tab.badgeCount > 0 && (
                <span
                  style={{
                    fontSize: "10px",
                    letterSpacing: "0.05em",
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: 0,
                    background: active
                      ? "#0A0A0A"
                      : "hsl(42 80% 18%)",
                    color: active ? "#0A0A0A" : "#0A0A0A",
                    lineHeight: 1,
                  }}
                >
                  {tab.badgeCount}
                </span>
              )}
          </Link>
        );
      })}
    </nav>
  );
}
