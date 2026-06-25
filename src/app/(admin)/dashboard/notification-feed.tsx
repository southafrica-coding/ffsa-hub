"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  CalendarClock,
  UserPlus,
  Archive,
  Car,
  Heart,
  Check,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { AppNotification } from "@/services/notifications";

const ICONS: Record<string, LucideIcon> = {
  booking: CalendarClock,
  user: UserPlus,
  records: Archive,
  vehicle: Car,
  family: Heart,
};

const ACCENTS: Record<string, string> = {
  booking: "hsl(42 95% 60%)",
  user: "hsl(200 70% 62%)",
  records: "hsl(265 60% 68%)",
  vehicle: "hsl(150 55% 58%)",
  family: "hsl(340 70% 64%)",
};

export function NotificationFeed({ initial }: { initial: AppNotification[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const unread = items.filter((n) => !n.read);

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
    <div className="overflow-hidden rounded-2xl border border-[hsl(22_8%_14%)] bg-[hsl(22_10%_8%)] shadow-[0_2px_16px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between border-b border-[hsl(22_8%_13%)] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Bell className="h-4 w-4 text-[hsl(42_95%_58%)]" />
          <span
            className="text-lg tracking-wide text-[#F0EBE3]"
            style={{ fontFamily: "var(--font-bebas, 'Arial Black', sans-serif)", letterSpacing: "0.06em" }}
          >
            Notifications
          </span>
          {unread.length > 0 && (
            <span className="rounded-full bg-[hsl(42_95%_55%)] px-2 py-0.5 text-[10px] font-bold text-[#0D0B09]">
              {unread.length}
            </span>
          )}
        </div>
        {unread.length > 0 && (
          <button
            type="button"
            onClick={markAll}
            className="text-[10px] font-bold uppercase tracking-[0.12em] text-[hsl(30_8%_45%)] transition-colors hover:text-foreground"
          >
            Mark all read
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-full"
            style={{ background: "hsl(142 50% 20% / 0.3)" }}
          >
            <Check className="h-5 w-5 text-[hsl(142_52%_60%)]" />
          </div>
          <p className="text-sm font-medium text-foreground">You&apos;re all caught up</p>
          <p className="text-xs text-muted-foreground">Nothing needs your attention right now.</p>
        </div>
      ) : (
        <div className="max-h-[26rem] divide-y divide-[hsl(22_8%_11%)] overflow-y-auto">
          {items.map((n) => {
            const Icon = ICONS[n.kind] ?? Bell;
            return (
              <Link
                key={n.key}
                href={n.href}
                onClick={() => markOne(n.key)}
                className={cn(
                  "flex items-start gap-3 px-5 py-3 transition-colors hover:bg-[hsl(22_8%_11%)]",
                  !n.read && "bg-[hsl(42_95%_55%/0.05)]"
                )}
              >
                <div
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: "hsl(22 8% 13%)", color: ACCENTS[n.kind] ?? "hsl(42 95% 58%)" }}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={cn(
                        "truncate text-sm",
                        n.read ? "font-medium text-[hsl(38_12%_72%)]" : "font-semibold text-foreground"
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
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[hsl(42_95%_58%)]" />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
