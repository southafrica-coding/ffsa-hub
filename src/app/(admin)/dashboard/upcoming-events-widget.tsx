"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, MapPin, ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarEvent } from "@/app/api/calendar/upcoming/route";

const CALENDAR_URL =
  process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_URL ?? "https://calendar.google.com/calendar";
const ROTATE_MS = 5000;
const TZ = "Africa/Johannesburg";

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

export function UpcomingEventsWidget() {
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const failed = useRef(false);

  useEffect(() => {
    let active = true;
    fetch("/api/calendar/upcoming", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d: { events?: CalendarEvent[] }) => {
        if (active) setEvents(d.events ?? []);
      })
      .catch(() => {
        if (active) {
          failed.current = true;
          setEvents([]);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  // Auto-rotate through events, pausing on hover.
  useEffect(() => {
    if (!events || events.length <= 1 || paused) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % events.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [events, paused]);

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

  const ev = events[index];
  const go = (dir: number) => setIndex((i) => (i + dir + events.length) % events.length);

  return (
    <div
      style={shell}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
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
            fontSize: "9px",
            letterSpacing: "0.18em",
            fontWeight: 700,
            textTransform: "uppercase",
            color: "hsl(30 8% 42%)",
          }}
        >
          Base Calendar
        </span>
      </div>

      {/* The event card — clicking opens the full Google Calendar. */}
      <a
        href={CALENDAR_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center gap-4 transition-colors duration-150 hover:bg-[hsl(22_8%_11%)]"
        style={{ padding: "1.15rem 1.5rem", textDecoration: "none" }}
      >
        <div
          style={{
            width: 46,
            height: 46,
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
            {new Date(ev.start).toLocaleDateString("en-ZA", { month: "short", timeZone: TZ })}
          </span>
          <span style={{ fontSize: 19, fontWeight: 700, marginTop: 2 }}>
            {new Date(ev.start).toLocaleDateString("en-ZA", { day: "numeric", timeZone: TZ })}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <p
            className="truncate"
            style={{ fontSize: 14, fontWeight: 600, color: "#F0EBE3" }}
          >
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

        <ArrowUpRight
          className="h-4 w-4 shrink-0 opacity-50 transition-opacity group-hover:opacity-100"
          style={{ color: "hsl(42 95% 58%)" }}
        />
      </a>

      {/* Controls — prev/next + dot indicators (only when >1 event). */}
      {events.length > 1 && (
        <div
          className="flex items-center justify-between"
          style={{ padding: "0.6rem 1.5rem", borderTop: "1px solid hsl(22 8% 11%)" }}
        >
          <button
            type="button"
            aria-label="Previous event"
            onClick={() => go(-1)}
            style={navBtn}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>

          <div className="flex items-center gap-1.5">
            {events.map((e, i) => (
              <button
                key={e.id}
                type="button"
                aria-label={`Go to event ${i + 1}`}
                onClick={() => setIndex(i)}
                style={{
                  width: i === index ? 16 : 6,
                  height: 6,
                  borderRadius: 999,
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  transition: "all 150ms",
                  background: i === index ? "hsl(42 95% 55%)" : "hsl(22 8% 22%)",
                }}
              />
            ))}
          </div>

          <button
            type="button"
            aria-label="Next event"
            onClick={() => go(1)}
            style={navBtn}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
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

const navBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  borderRadius: 8,
  border: "1px solid hsl(22 8% 16%)",
  background: "transparent",
  color: "hsl(30 8% 55%)",
  cursor: "pointer",
};
