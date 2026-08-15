"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HeartHandshake, ArrowUpRight } from "lucide-react";

type Slot = { id: string; role: string; status: string };
type PrayerSet = {
  id: string;
  set_date: string; // YYYY-MM-DD
  start_time: string | null;
  end_time: string | null;
  title: string | null;
  status: string;
  slots: Slot[] | null;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hhmm(s: string | null): string {
  if (!s) return "";
  return new Date(`1970-01-01T${s}`).toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export function PrayerWeekCard() {
  const [sets, setSets] = useState<PrayerSet[] | null>(null);

  // The current week, Sunday → Saturday (matches the DB week convention).
  const { week, todayKey, range } = useMemo(() => {
    const now = new Date();
    const sunday = new Date(now);
    sunday.setDate(now.getDate() - now.getDay());
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      return d;
    });
    return {
      week: days,
      todayKey: ymd(now),
      range: { from: ymd(days[0]), to: ymd(days[6]) },
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`/api/prayer-room/sets?dateFrom=${range.from}&dateTo=${range.to}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: PrayerSet[]) => {
        if (active) setSets(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (active) setSets([]);
      });
    return () => {
      active = false;
    };
  }, [range.from, range.to]);

  const byDay = useMemo(() => {
    const map: Record<string, PrayerSet[]> = {};
    for (const s of sets ?? []) {
      (map[s.set_date] ||= []).push(s);
    }
    return map;
  }, [sets]);

  const hasAny = (sets?.length ?? 0) > 0;

  return (
    <div style={shell}>
      <div
        className="flex items-center justify-between"
        style={{ padding: "0.85rem 1.5rem", borderBottom: "1px solid var(--rule)" }}
      >
        <div className="flex items-center gap-2.5">
          <HeartHandshake className="h-4 w-4" style={{ color: "hsl(265 60% 70%)" }} />
          <span
            style={{
              fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase",
              fontSize: "1.1rem",
              letterSpacing: "0.06em",
              color: "var(--text-primary)",
            }}
          >
            Prayer Room · This Week
          </span>
        </div>
        <Link
          href="/prayer-room"
          className="flex items-center gap-1 transition-opacity hover:opacity-80"
          style={{ fontSize: 9, letterSpacing: "0.18em", fontWeight: 700, textTransform: "uppercase", color: "var(--text-tertiary)" }}
        >
          Open
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {sets === null ? (
        <div style={{ padding: "1.1rem 1.5rem" }}>
          <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Loading this week’s schedule…</p>
        </div>
      ) : !hasAny ? (
        <div className="flex flex-col items-center justify-center gap-1.5 text-center" style={{ padding: "2rem 1.5rem" }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>No prayer sets scheduled this week</p>
          <Link href="/prayer-room" style={{ fontSize: 12, color: "hsl(265 60% 72%)" }}>
            Open the Prayer Room →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7" style={{ gap: 1, background: "var(--surface-2)" }}>
          {week.map((d) => {
            const key = ymd(d);
            const isToday = key === todayKey;
            const daySets = byDay[key] ?? [];
            return (
              <div key={key} style={{ background: "var(--surface-1)", minHeight: 132, padding: "0.7rem 0.8rem" }}>
                <div className="flex items-baseline gap-1.5" style={{ marginBottom: 8 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: isToday ? "var(--ink)" : "var(--text-tertiary)",
                    }}
                  >
                    {DAY_NAMES[d.getDay()]}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: isToday ? "var(--text-primary)" : "var(--text-secondary)" }}>
                    {d.getDate()}
                  </span>
                </div>

                {daySets.length === 0 ? (
                  <p style={{ fontSize: 11, color: "var(--text-tertiary)" }}>—</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {daySets.map((s) => {
                      const total = s.slots?.length ?? 0;
                      const filled = (s.slots ?? []).filter((x) => x.status === "filled").length;
                      const tone =
                        total === 0
                          ? "var(--text-tertiary)"
                          : filled >= total
                            ? "hsl(142 52% 62%)"
                            : filled > 0
                              ? "var(--ink)"
                              : "hsl(0 65% 66%)";
                      return (
                        <Link
                          key={s.id}
                          href="/prayer-room"
                          className="block transition-colors hover:bg-[color:var(--surface-2)]"
                          style={{
                            textDecoration: "none",
                            borderRadius: 8,
                            border: "1px solid var(--rule)",
                            padding: "5px 7px",
                          }}
                        >
                          <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.2 }}>
                            {hhmm(s.start_time)}
                          </p>
                          {s.title && (
                            <p className="truncate" style={{ fontSize: 10.5, color: "var(--text-secondary)", marginTop: 1 }}>
                              {s.title}
                            </p>
                          )}
                          <p style={{ fontSize: 9.5, fontWeight: 700, color: tone, marginTop: 3 }}>
                            {total === 0 ? "No roles" : `${filled}/${total} covered`}
                          </p>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const shell: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--rule)",
  borderRadius: 14,
  overflow: "hidden",
};
