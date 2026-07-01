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
              color: active ? "hsl(42 95% 60%)" : "hsl(30 8% 55%)",
              borderBottom: active
                ? "2px solid hsl(42 95% 55%)"
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
                    borderRadius: "999px",
                    background: active
                      ? "hsl(42 95% 55%)"
                      : "hsl(42 80% 18%)",
                    color: active ? "#0D0B09" : "hsl(42 95% 55%)",
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
