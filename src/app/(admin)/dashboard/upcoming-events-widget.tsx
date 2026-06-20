"use client";

import { useEffect, useState } from "react";
import { CalendarDays, MapPin } from "lucide-react";
import type { CalendarEvent } from "@/app/api/calendar/upcoming/route";

const CALENDAR_URL =
  process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_URL ?? "https://calendar.google.com/calendar";
const TZ = "Africa/Johannesburg";

// How many rows are visible before the list starts auto-scrolling.
const VISIBLE = 3;
// Approximate row height (px) used only to size the scrolling viewport.
const ROW_H = 76;

function formatWhen(ev: CalendarEvent): string {
  const start = new Date(ev.start);
  const day = start.toLocaleDateString("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: TZ,
  });
  if (ev.allDay) return `${day} · All day`;
  const time = start.toLocaleTimeString("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  });
  return `${day} · ${time}`;
}

function EventRow({ ev }: { ev: CalendarEvent }) {
  const start = new Date(ev.start);
  return (
    <a
      href={CALENDAR_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-4 transition-colors duration-150 hover:bg-[hsl(22_8%_11%)]"
      style={{
        padding: "0.8rem 1.5rem",
        textDecoration: "none",
        borderBottom: "1px solid hsl(22 8% 11%)",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          flexShrink: 0,
          borderRadius: 10,
          background: "hsl(42 95% 55% / 0.12)",
          color: "hsl(42 95% 58%)",
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
          {ev.title}
        </p>
        <p style={{ fontSize: 11.5, color: "hsl(30 8% 50%)", marginTop: 3 }}>{formatWhen(ev)}</p>
        {ev.location && (
          <p
            className="flex items-center gap-1 truncate"
            style={{ fontSize: 11, color: "hsl(30 8% 42%)", marginTop: 2 }}
          >
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{ev.location}</span>
          </p>
        )}
      </div>
    </a>
  );
}

export function UpcomingEventsWidget() {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/calendar/upcoming", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d: { events?: CalendarEvent[] }) => {
        if (active) setEvents(d.events ?? []);
      })
      .catch(() => {
        if (active) setEvents([]);
      });
    return () => {
      active = false;
    };
  }, []);

  // Loading skeleton — keep layout stable.
  if (events === null) {
    return (
      <div style={shell}>
        <div style={{ padding: "1.1rem 1.5rem" }}>
          <p style={{ fontSize: "12px", color: "hsl(30 8% 42%)" }}>Loading upcoming events…</p>
        </div>
      </div>
    );
  }

  // Nothing to show (no events, or integration not configured) — render nothing.
  if (events.length === 0) return null;

  // Only auto-scroll when the list is taller than the viewport.
  const scroll = events.length > VISIBLE;
  // A steady, readable pace that scales with how many events there are.
  const duration = events.length * 3.2;

  return (
    <div style={shell}>
      <style>{KEYFRAMES}</style>

      <div
        className="flex items-center justify-between"
        style={{ padding: "0.85rem 1.5rem", borderBottom: "1px solid hsl(22 8% 13%)" }}
      >
        <div className="flex items-center gap-2.5">
          <CalendarDays className="h-4 w-4" style={{ color: "hsl(42 95% 58%)" }} />
          <span
            style={{
              fontFamily: "var(--font-bebas, 'Arial Black', sans-serif)",
              fontSize: "1.1rem",
              letterSpacing: "0.06em",
              color: "#F0EBE3",
            }}
          >
            Upcoming Events
          </span>
        </div>
        <span
          style={{
            fontSize: 9,
            letterSpacing: "0.18em",
            fontWeight: 700,
            textTransform: "uppercase",
            color: "hsl(30 8% 42%)",
          }}
        >
          Base Calendar
        </span>
      </div>

      {/* Scrolling viewport — the track is duplicated so the loop is seamless. */}
      <div
        className="ffsa-cal-viewport"
        style={{
          maxHeight: scroll ? VISIBLE * ROW_H : undefined,
          overflow: "hidden",
          position: "relative",
          maskImage: scroll
            ? "linear-gradient(to bottom, transparent, #000 9%, #000 91%, transparent)"
            : undefined,
          WebkitMaskImage: scroll
            ? "linear-gradient(to bottom, transparent, #000 9%, #000 91%, transparent)"
            : undefined,
        }}
      >
        <div
          className="ffsa-cal-track"
          style={scroll ? { animation: `ffsa-cal-scroll ${duration}s linear infinite` } : undefined}
        >
          {events.map((ev) => (
            <EventRow key={ev.id} ev={ev} />
          ))}
          {scroll && events.map((ev) => <EventRow key={`dup-${ev.id}`} ev={ev} />)}
        </div>
      </div>
    </div>
  );
}

const shell: React.CSSProperties = {
  background: "hsl(22 10% 8%)",
  border: "1px solid hsl(22 8% 14%)",
  borderRadius: 14,
  overflow: "hidden",
};

// Continuous upward scroll; the track holds two copies so -50% loops seamlessly.
// Pauses on hover, and respects users who prefer reduced motion.
const KEYFRAMES = `
@keyframes ffsa-cal-scroll {
  from { transform: translateY(0); }
  to { transform: translateY(-50%); }
}
.ffsa-cal-viewport:hover .ffsa-cal-track { animation-play-state: paused !important; }
@media (prefers-reduced-motion: reduce) {
  .ffsa-cal-track { animation: none !important; }
}
`;
