"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, ArrowUpRight, MapPin, Repeat } from "lucide-react";
import { timeRangeLabel } from "@/lib/bookings/dates";

type Ref = { name: string; color: string | null; building?: string | null };

type Booking = {
  id: string;
  title: string;
  booking_date: string;
  start_time: string | null;
  end_time: string | null;
  status: "pending" | "approved" | "denied" | "cancelled";
  series_id: string | null;
  venue: Ref | Ref[] | null;
  ministry: Ref | Ref[] | null;
};

// A recurring booking shows up as several identical instances. Group by the
// series id when present, otherwise by an identical-content signature (same
// title / venue / time), so weekly repeats collapse either way.
function groupKey(b: Booking): string {
  if (b.series_id) return `s:${b.series_id}`;
  const venue = one(b.venue)?.name ?? "";
  return `c:${b.title}|${venue}|${b.start_time ?? ""}|${b.end_time ?? ""}`;
}

// Bookings already arrive soonest-first: keep the first occurrence of each group
// and drop the repeats, flagging a group as recurring when it had 2+ instances.
function collapseRecurring(bookings: Booking[]): Array<Booking & { recurring: boolean }> {
  const counts = new Map<string, number>();
  for (const b of bookings) counts.set(groupKey(b), (counts.get(groupKey(b)) ?? 0) + 1);

  const seen = new Set<string>();
  const out: Array<Booking & { recurring: boolean }> = [];
  for (const b of bookings) {
    const key = groupKey(b);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...b, recurring: (counts.get(key) ?? 1) > 1 });
  }
  return out;
}

// Outlined status pills — the system never fills a pill with colour.
const STATUS_STYLE: Record<string, { border: string; fg: string; label: string }> = {
  approved: { border: "var(--green)", fg: "var(--green-text)", label: "Approved" },
  pending: { border: "var(--amber-border)", fg: "var(--amber)", label: "Pending" },
  denied: { border: "hsl(var(--destructive))", fg: "hsl(var(--destructive))", label: "Denied" },
};

function one(r: Ref | Ref[] | null): Ref | null {
  return Array.isArray(r) ? r[0] ?? null : r;
}

// start_time / end_time are wall-clock strings ("09:30:00"), not instants —
// read them as written rather than routing them through a Date, which would
// shift them by the viewer's UTC offset.
function timeLabel(b: Booking): string {
  if (!b.start_time && !b.end_time) return "All day";
  return timeRangeLabel(b.start_time, b.end_time);
}

export function MyBookingsCard() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/bookings/my-upcoming", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { bookings: [] }))
      .then((d: { bookings?: Booking[] }) => {
        if (active) setBookings(d.bookings ?? []);
      })
      .catch(() => {
        if (active) setBookings([]);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div style={shell}>
      <div
        className="flex items-center justify-between"
        style={{ padding: "0.85rem 1.5rem", borderBottom: "1px solid var(--rule)" }}
      >
        <div className="flex items-center gap-2.5">
          <CalendarClock className="h-4 w-4" style={{ color: "var(--ink)" }} />
          <span
            style={{
              fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase",
              fontSize: "1.1rem",
              letterSpacing: "0.06em",
              color: "var(--text-primary)",
            }}
          >
            My Space Bookings
          </span>
        </div>
        <Link
          href="/bookings"
          className="flex items-center gap-1 transition-opacity hover:opacity-80"
          style={{ fontSize: 9, letterSpacing: "0.18em", fontWeight: 700, textTransform: "uppercase", color: "var(--text-tertiary)" }}
        >
          View all
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {bookings === null ? (
        <div style={{ padding: "1.1rem 1.5rem" }}>
          <p style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Loading your bookings…</p>
        </div>
      ) : bookings.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1.5 text-center" style={{ padding: "2rem 1.5rem" }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>No upcoming bookings</p>
          <Link href="/bookings" style={{ fontSize: 12, color: "var(--ink)" }}>
            Request a space →
          </Link>
        </div>
      ) : (
        <div style={{ maxHeight: 3 * 76, overflowY: "auto" }} className="ffsa-bk-list">
          <style>{".ffsa-bk-list{scrollbar-width:thin;scrollbar-color:var(--rule-strong) transparent}"}</style>
          {collapseRecurring(bookings).map((b) => {
            const venue = one(b.venue);
            const start = new Date(b.booking_date + "T00:00:00Z");
            const weekday = start.toLocaleDateString("en-ZA", { weekday: "short", timeZone: "UTC" });
            const st = STATUS_STYLE[b.status] ?? STATUS_STYLE.pending;
            return (
              <Link
                key={b.id}
                href="/bookings"
                className="flex items-center gap-4 transition-colors duration-150 hover:bg-[color:var(--surface-2)]"
                style={{ padding: "0.8rem 1.5rem", textDecoration: "none", borderBottom: "1px solid var(--surface-2)" }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    flexShrink: 0,
                    borderRadius: 10,
                    background: venue?.color ? `${venue.color}22` : "var(--surface-3)",
                    color: venue?.color || "var(--ink)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                  }}
                >
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    {start.toLocaleDateString("en-ZA", { month: "short", timeZone: "UTC" })}
                  </span>
                  <span style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
                    {start.toLocaleDateString("en-ZA", { day: "numeric", timeZone: "UTC" })}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                    {b.title}
                  </p>
                  <p
                    className="flex items-center gap-1 truncate"
                    style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 3 }}
                  >
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                      {venue?.name ?? "—"} · {timeLabel(b)}
                    </span>
                  </p>
                  {b.recurring && (
                    <p
                      className="flex items-center gap-1"
                      style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ink)", marginTop: 2 }}
                    >
                      <Repeat className="h-3 w-3 shrink-0" />
                      Weekly · {weekday} · next {start.toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: "UTC" })}
                    </p>
                  )}
                </div>

                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 9,
                    letterSpacing: "0.08em",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    padding: "3px 8px",
                    borderRadius: 0,
                    border: `1px solid ${st.border}`,
                    color: st.fg,
                    fontFamily: "var(--font-mono-brand)",
                  }}
                >
                  {st.label}
                </span>
              </Link>
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
