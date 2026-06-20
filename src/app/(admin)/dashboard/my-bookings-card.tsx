"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, ArrowUpRight, MapPin } from "lucide-react";

type Ref = { name: string; color: string | null; building?: string | null };

type Booking = {
  id: string;
  title: string;
  booking_date: string;
  start_time: string | null;
  end_time: string | null;
  status: "pending" | "approved" | "denied" | "cancelled";
  venue: Ref | Ref[] | null;
  ministry: Ref | Ref[] | null;
};

const TZ = "Africa/Johannesburg";

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  approved: { bg: "hsl(142 50% 22% / 0.5)", fg: "hsl(142 52% 65%)", label: "Approved" },
  pending: { bg: "hsl(42 95% 55% / 0.16)", fg: "hsl(42 95% 62%)", label: "Pending" },
  denied: { bg: "hsl(0 60% 30% / 0.4)", fg: "hsl(0 70% 70%)", label: "Denied" },
};

function one(r: Ref | Ref[] | null): Ref | null {
  return Array.isArray(r) ? r[0] ?? null : r;
}

function timeLabel(b: Booking): string {
  if (!b.start_time) return "All day";
  const t = (s: string) =>
    new Date(`1970-01-01T${s}`).toLocaleTimeString("en-ZA", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    });
  return b.end_time ? `${t(b.start_time)}–${t(b.end_time)}` : t(b.start_time);
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
        style={{ padding: "0.85rem 1.5rem", borderBottom: "1px solid hsl(22 8% 13%)" }}
      >
        <div className="flex items-center gap-2.5">
          <CalendarClock className="h-4 w-4" style={{ color: "hsl(42 95% 58%)" }} />
          <span
            style={{
              fontFamily: "var(--font-bebas, 'Arial Black', sans-serif)",
              fontSize: "1.1rem",
              letterSpacing: "0.06em",
              color: "#F0EBE3",
            }}
          >
            My Space Bookings
          </span>
        </div>
        <Link
          href="/bookings"
          className="flex items-center gap-1 transition-opacity hover:opacity-80"
          style={{ fontSize: 9, letterSpacing: "0.18em", fontWeight: 700, textTransform: "uppercase", color: "hsl(30 8% 45%)" }}
        >
          View all
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {bookings === null ? (
        <div style={{ padding: "1.1rem 1.5rem" }}>
          <p style={{ fontSize: 12, color: "hsl(30 8% 42%)" }}>Loading your bookings…</p>
        </div>
      ) : bookings.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1.5 text-center" style={{ padding: "2rem 1.5rem" }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: "#F0EBE3" }}>No upcoming bookings</p>
          <Link href="/bookings" style={{ fontSize: 12, color: "hsl(42 95% 60%)" }}>
            Request a space →
          </Link>
        </div>
      ) : (
        <div style={{ maxHeight: 3 * 76, overflowY: "auto" }} className="ffsa-bk-list">
          <style>{".ffsa-bk-list{scrollbar-width:thin;scrollbar-color:hsl(22 8% 22%) transparent}"}</style>
          {bookings.map((b) => {
            const venue = one(b.venue);
            const ministry = one(b.ministry);
            const start = new Date(b.booking_date + "T00:00:00");
            const st = STATUS_STYLE[b.status] ?? STATUS_STYLE.pending;
            return (
              <Link
                key={b.id}
                href="/bookings"
                className="flex items-center gap-4 transition-colors duration-150 hover:bg-[hsl(22_8%_11%)]"
                style={{ padding: "0.8rem 1.5rem", textDecoration: "none", borderBottom: "1px solid hsl(22 8% 11%)" }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    flexShrink: 0,
                    borderRadius: 10,
                    background: venue?.color ? `${venue.color}22` : "hsl(42 95% 55% / 0.12)",
                    color: venue?.color || "hsl(42 95% 58%)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                  }}
                >
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    {start.toLocaleDateString("en-ZA", { month: "short", timeZone: TZ })}
                  </span>
                  <span style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>
                    {start.toLocaleDateString("en-ZA", { day: "numeric", timeZone: TZ })}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate" style={{ fontSize: 14, fontWeight: 600, color: "#F0EBE3" }}>
                    {b.title}
                  </p>
                  <p
                    className="flex items-center gap-1 truncate"
                    style={{ fontSize: 11.5, color: "hsl(30 8% 50%)", marginTop: 3 }}
                  >
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                      {venue?.name ?? "—"} · {timeLabel(b)}
                    </span>
                  </p>
                </div>

                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 9,
                    letterSpacing: "0.08em",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    padding: "3px 8px",
                    borderRadius: 999,
                    background: st.bg,
                    color: st.fg,
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
  background: "hsl(22 10% 8%)",
  border: "1px solid hsl(22 8% 14%)",
  borderRadius: 14,
  overflow: "hidden",
};
