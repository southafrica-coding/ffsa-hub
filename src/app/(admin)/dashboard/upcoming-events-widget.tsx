"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, MapPin } from "lucide-react";
import type { CalendarEvent } from "@/app/api/calendar/upcoming/route";

const CALENDAR_URL =
  process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_URL ?? "https://calendar.google.com/calendar";
const TZ = "Africa/Johannesburg";

// How many rows are visible before the list starts auto-scrolling.
const VISIBLE = 3;
// Approximate row height (px) used only to size the scrolling viewport.
const ROW_H = 76;
// Auto-scroll pace in pixels per second (a touch slower than the first cut).
const SPEED = 14;

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
      className="flex items-center gap-4 transition-colors duration-150 hover:bg-[color:var(--surface-2)]"
      style={{
        padding: "0.8rem 1.5rem",
        textDecoration: "none",
        borderBottom: "1px solid var(--surface-2)",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          flexShrink: 0,
          borderRadius: 10,
          background: "var(--surface-3)",
          color: "var(--ink)",
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
        <p className="truncate" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
          {ev.title}
        </p>
        <p style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 3 }}>{formatWhen(ev)}</p>
        {ev.location && (
          <p
            className="flex items-center gap-1 truncate"
            style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}
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
  const viewportRef = useRef<HTMLDivElement>(null);
  // Paused while the cursor is over the list, so it holds still and the user
  // can wheel/trackpad through it manually.
  const pausedRef = useRef(false);

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

  // Only auto-scroll when the list is taller than the viewport.
  const scroll = !!events && events.length > VISIBLE;

  // Drive the scroll with rAF (instead of a CSS transform) so the viewport is a
  // real scroll container — that's what lets the user move it by hand on hover.
  useEffect(() => {
    if (!scroll) return;
    const el = viewportRef.current;
    if (!el) return;

    // Respect reduced-motion: no auto-advance, but manual scrolling still works.
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (!pausedRef.current) {
        const half = el.scrollHeight / 2; // height of one copy (list is duplicated)
        if (half > 0) {
          let next = el.scrollTop + (SPEED * dt) / 1000;
          if (next >= half) next -= half; // seamless wrap
          el.scrollTop = next;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scroll, events]);

  // Loading skeleton — keep layout stable.
  if (events === null) {
    return (
      <div style={shell}>
        <div style={{ padding: "1.1rem 1.5rem" }}>
          <p style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>Loading upcoming events…</p>
        </div>
      </div>
    );
  }

  // Nothing to show (no events, or integration not configured) — render nothing.
  if (events.length === 0) return null;

  return (
    <div style={shell}>
      <style>{STYLES}</style>

      <div
        className="flex items-center justify-between"
        style={{ padding: "0.85rem 1.5rem", borderBottom: "1px solid var(--rule)" }}
      >
        <div className="flex items-center gap-2.5">
          <CalendarDays className="h-4 w-4" style={{ color: "var(--ink)" }} />
          <span
            style={{
              fontFamily: "var(--font-condensed)", fontWeight: 900, textTransform: "uppercase",
              fontSize: "1.1rem",
              letterSpacing: "0.06em",
              color: "var(--text-primary)",
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
            color: "var(--text-tertiary)",
          }}
        >
          Base Calendar
        </span>
      </div>

      {/* Scrolling viewport — a real scroll container; the list is duplicated so
          the auto-scroll loops seamlessly and manual scrolling has room to move. */}
      <div
        ref={viewportRef}
        className="ffsa-cal-viewport"
        onMouseEnter={() => {
          pausedRef.current = true;
        }}
        onMouseLeave={() => {
          pausedRef.current = false;
        }}
        style={{
          maxHeight: scroll ? VISIBLE * ROW_H : undefined,
          overflowY: scroll ? "auto" : "visible",
          position: "relative",
          maskImage: scroll
            ? "linear-gradient(to bottom, transparent, #000 9%, #000 91%, transparent)"
            : undefined,
          WebkitMaskImage: scroll
            ? "linear-gradient(to bottom, transparent, #000 9%, #000 91%, transparent)"
            : undefined,
        }}
      >
        <div>
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
  background: "var(--surface-1)",
  border: "1px solid var(--rule)",
  borderRadius: 14,
  overflow: "hidden",
};

// Hide the scrollbar — the list still scrolls via wheel/trackpad on hover.
const STYLES = `
.ffsa-cal-viewport { scrollbar-width: none; -ms-overflow-style: none; }
.ffsa-cal-viewport::-webkit-scrollbar { display: none; }
`;
