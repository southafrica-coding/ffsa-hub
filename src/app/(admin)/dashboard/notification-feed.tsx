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
  Check,
  ShieldAlert,
  Music,
  MessageSquarePlus,
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
  feedback: MessageSquarePlus,
};

const ACCENTS: Record<string, string> = {
  booking: "var(--ink)",
  user: "hsl(200 70% 62%)",
  records: "hsl(265 60% 68%)",
  vehicle: "hsl(150 55% 58%)",
  insurance: "hsl(4 75% 62%)",
  practice: "hsl(43 100% 50%)",
  feedback: "hsl(43 100% 50%)",
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
    <div className="overflow-hidden rounded-none border border-[color:var(--rule)] bg-[color:var(--surface-1)]">
      <div className="flex items-center justify-between border-b border-[color:var(--rule)] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Bell className="h-4 w-4 text-ink" />
          <span
            className="text-lg tracking-wide text-[var(--text-primary)]"
            style={{ fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em" }}
          >
            Notifications
          </span>
          {unread.length > 0 && (
            <span className="bg-ink px-2 py-0.5 font-mono text-[10px] font-bold text-white">
              {unread.length}
            </span>
          )}
        </div>
        {unread.length > 0 && (
          <button
            type="button"
            onClick={markAll}
            className="text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--text-tertiary)] transition-colors hover:text-foreground"
          >
            Mark all read
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-none"
            style={{ background: "var(--surface-2)" }}
          >
            <Check className="h-5 w-5 text-[color:var(--green-text)]" />
          </div>
          <p className="text-sm font-medium text-foreground">You&apos;re all caught up</p>
          <p className="text-xs text-muted-foreground">Nothing needs your attention right now.</p>
        </div>
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
                  "flex items-start gap-3 px-5 py-3 transition-colors hover:bg-[color:var(--surface-2)]",
                  !n.read && "bg-[color:var(--surface-2)]"
                )}
              >
                <div
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-none"
                  style={{ background: "var(--rule)", color: ACCENTS[n.kind] ?? "var(--ink)" }}
                >
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
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                        {n.when}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{n.body}</p>
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
