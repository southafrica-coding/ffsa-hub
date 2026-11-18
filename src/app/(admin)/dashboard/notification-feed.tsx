"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bell,
  CalendarClock,
  UserPlus,
  Archive,
  Car,
  ShieldAlert,
  Music,
  MailWarning,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { AppNotification } from "@/services/notifications";

const ICONS: Record<string, LucideIcon> = {
  booking: CalendarClock,
  user: UserPlus,
  records: Archive,
  vehicle: Car,
  insurance: ShieldAlert,
  practice: Music,
  reference: MailWarning,
};

// Leaders get insurance-expiry notices "on behalf of" their people. The feed
// is recomputed on each load, so to make sure a leader NOTICES a new one we
// pop a toast for any unread insurance key we haven't shown before (tracked in
// localStorage so a reload doesn't re-toast the same items).
const SEEN_INSURANCE_KEY = "ffsa:seen-insurance-notifs";

export function NotificationFeed({ initial }: { initial: AppNotification[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const unread = items.filter((n) => !n.read);

  // Pop a toast for newly-arrived, unread insurance notifications.
  useEffect(() => {
    const fresh = initial.filter((n) => n.kind === "insurance" && !n.read);
    if (fresh.length === 0) return;
    let seen: string[] = [];
    try {
      seen = JSON.parse(localStorage.getItem(SEEN_INSURANCE_KEY) ?? "[]");
    } catch {
      seen = [];
    }
    const seenSet = new Set(seen);
    const newOnes = fresh.filter((n) => !seenSet.has(n.key));
    if (newOnes.length > 0) {
      toast.warning(
        newOnes.length === 1
          ? "A team member's health insurance needs attention"
          : `${newOnes.length} team members' health insurance needs attention`,
        { description: "Check your notifications to follow up on the renewal." }
      );
    }
    // Persist the union so reloads don't re-toast; keep only current keys so
    // the store doesn't grow unbounded as policies renew.
    try {
      localStorage.setItem(
        SEEN_INSURANCE_KEY,
        JSON.stringify(fresh.map((n) => n.key))
      );
    } catch {
      /* ignore quota / disabled storage */
    }
  }, [initial]);

  function post(keys: string[]) {
    if (!keys.length) return;
    fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    }).catch(() => {});
  }

  function markOne(key: string) {
    setItems((xs) => xs.map((n) => (n.key === key ? { ...n, read: true } : n)));
    post([key]);
  }

  function markAll() {
    const keys = unread.map((n) => n.key);
    setItems((xs) => xs.map((n) => ({ ...n, read: true })));
    post(keys);
    router.refresh();
  }

  return (
    <div className="min-w-0 overflow-hidden border border-ink bg-surface-1">
      <div className="section-bar">
        <span className="section-bar-title">Needs attention</span>
        {unread.length > 0 && (
          <span className="flex items-center gap-3">
            <span className="section-bar-meta">{unread.length} unread</span>
            <button type="button" onClick={markAll} className="section-bar-meta hover:text-white">
              Mark all read
            </button>
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-[color:var(--text-secondary)]">Nothing needs attention.</p>
      ) : (
        <div className="max-h-[26rem] divide-y divide-[color:var(--surface-4)] overflow-y-auto">
          {items.map((n) => {
            const Icon = ICONS[n.kind] ?? Bell;
            return (
              <Link
                key={n.key}
                href={n.href}
                onClick={() => markOne(n.key)}
                className={cn(
                  "flex min-w-0 items-start gap-3 px-6 py-3 hover:bg-[color:var(--surface-2)]",
                  !n.read && "bg-[color:var(--surface-2)]"
                )}
              >
                <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center bg-bone text-ink">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={cn(
                        "truncate text-sm",
                        n.read ? "font-medium text-[color:var(--text-secondary)]" : "font-semibold text-foreground"
                      )}
                    >
                      {n.title}
                    </p>
                    {n.when && (
                      <span className="shrink-0 font-mono text-[10px] font-bold tabular-nums tracking-[0.1em] text-[color:var(--text-tertiary)]">
                        {n.when}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[13px] text-[color:var(--text-secondary)]">{n.body}</p>
                </div>
                {!n.read && (
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-none bg-ink" />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
