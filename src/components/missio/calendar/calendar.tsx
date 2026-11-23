"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { joburgToday, monthEnd, monthStart, MONTH_NAMES } from "@/lib/missio/calendar/dates";
import {
  ALL_FILTERS,
  calendarQueryString,
  clampYear,
  expandAll,
  matchesFilters,
  parseCalendarQuery,
  type CalendarQuery,
  type CalendarView,
  type Occurrence,
} from "@/lib/missio/calendar/occurrences";
import { hasNationalDates, nationalEvents } from "@/lib/missio/calendar/south-africa";
import { CALENDAR_CATEGORIES, CAMPUS_LABEL, CAMPUSES, CATEGORY_SHORT, type CalendarCategory, type CalendarEvent } from "@/lib/missio/calendar/types";
import { isMissioPastor } from "../access";
import content from "../content.module.css";
import { HouseStatus } from "../house-churches/status";
import { useMissioLoad } from "../house-churches/load";
import shell from "../shell.module.css";
import { useMissioViewer } from "../viewer";
import { calendarClient, type CalendarClient } from "./client";
import { EventDetail, EventSheet } from "./event-sheet";
import { ShareSheet } from "./share-sheet";
import { AgendaView, Legend, Marker, MonthView, YearView } from "./views";
import styles from "./calendar.module.css";

const VIEW_LABEL: Record<CalendarView, string> = { year: "Year", month: "Month", agenda: "List" };

type Sheet =
  | { kind: "none" }
  | { kind: "add"; day: string }
  | { kind: "edit"; event: CalendarEvent; occurrence: Occurrence | null }
  | { kind: "detail"; occurrence: Occurrence }
  | { kind: "share" };

/** Query state mirrored to the address bar (replaceState, no reload). */
function useCalendarQuery(today: string, syncUrl: boolean) {
  const [query, setQuery] = useState<CalendarQuery>(() => ({ ...ALL_FILTERS, view: "year", year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  useEffect(() => {
    if (!syncUrl || typeof window === "undefined") return;
    setQuery(parseCalendarQuery(window.location.search, today));
  }, [today, syncUrl]);
  const update = useCallback(
    (patch: Partial<CalendarQuery>) => {
      setQuery((current) => {
        const next = { ...current, ...patch };
        if (syncUrl && typeof window !== "undefined") {
          window.history.replaceState(window.history.state, "", `${window.location.pathname}${calendarQueryString(next, today)}`);
        }
        return next;
      });
    },
    [syncUrl, today]
  );
  return [query, update] as const;
}

function CalendarScreen({
  events,
  today,
  pastor,
  syncUrl = true,
  onAdd,
  onOpenEvent,
  actions,
  banner,
}: {
  events: CalendarEvent[];
  today: string;
  pastor: boolean;
  syncUrl?: boolean;
  onAdd?: (day: string) => void;
  onOpenEvent: (occ: Occurrence) => void;
  actions?: React.ReactNode;
  banner?: React.ReactNode;
}) {
  const [query, update] = useCalendarQuery(today, syncUrl);
  const [selected, setSelected] = useState(today);
  const { view, year, month } = query;

  const all = useMemo(() => [...events, ...nationalEvents(year)], [events, year]);
  const visible = useMemo(() => all.filter((event) => matchesFilters(event, query)), [all, query]);
  const [from, to] = view === "year" ? [`${year}-01-01`, `${year}-12-31`] : [monthStart(year, month), monthEnd(year, month)];
  const occurrences = useMemo(() => expandAll(visible, from, to), [visible, from, to]);

  // Keep the selected day inside the month on screen.
  const selectedDay = selected >= monthStart(year, month) && selected <= monthEnd(year, month) ? selected : today >= monthStart(year, month) && today <= monthEnd(year, month) ? today : monthStart(year, month);

  function step(delta: number) {
    if (view === "year") {
      update({ year: clampYear(year + delta) });
      return;
    }
    const index = year * 12 + (month - 1) + delta;
    update({ year: clampYear(Math.floor(index / 12)), month: (index % 12) + 1 });
  }

  function toggleCategory(category: CalendarCategory) {
    const has = query.categories.includes(category);
    update({ categories: has ? query.categories.filter((item) => item !== category) : [...query.categories, category] });
  }

  const title = view === "year" ? String(year) : `${MONTH_NAMES[month - 1]} ${year}`;
  const isNow = view === "year" ? year === Number(today.slice(0, 4)) : today >= monthStart(year, month) && today <= monthEnd(year, month);

  return (
    <div className={`${content.page} ${styles.page}`} data-testid="missio-calendar">
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={content.title}>Calendar</h1>
          <p className={`${shell.lede} ${content.lede}`}>
            {pastor
              ? "Everything Missio has on, through the year. Share it once and it stays up to date in everyone’s Google or phone calendar."
              : "Everything Missio has on, through the year."}
          </p>
        </div>
        {actions ? <div className={styles.headActions}>{actions}</div> : null}
      </div>

      {banner}

      <div className={styles.toolbar}>
        <div className={styles.stepper}>
          <button type="button" className={styles.iconButton} onClick={() => step(-1)} aria-label={view === "year" ? "Previous year" : "Previous month"}>
            <Chevron left />
          </button>
          <h2 className={styles.period} aria-live="polite">
            {title}
          </h2>
          <button type="button" className={styles.iconButton} onClick={() => step(1)} aria-label={view === "year" ? "Next year" : "Next month"}>
            <Chevron />
          </button>
          {!isNow ? (
            <button
              type="button"
              className={styles.todayButton}
              onClick={() => {
                setSelected(today);
                update({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
              }}
            >
              Today
            </button>
          ) : null}
        </div>
        <div className={styles.views} role="group" aria-label="View">
          {(Object.keys(VIEW_LABEL) as CalendarView[]).map((item) => (
            <button key={item} type="button" aria-pressed={view === item} onClick={() => update({ view: item })}>
              {VIEW_LABEL[item]}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.filters}>
        <div className={styles.filterChips} role="group" aria-label="Show categories">
          {CALENDAR_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              className={styles.filterChip}
              data-cat={category}
              aria-pressed={query.categories.includes(category)}
              onClick={() => toggleCategory(category)}
            >
              <Marker category={category} />
              {category === "national" ? "Holidays & school" : category === "sundays" ? "Sundays" : CATEGORY_SHORT[category]}
            </button>
          ))}
        </div>
        <div className={styles.campus} role="group" aria-label="Campus">
          {CAMPUSES.map((campus) => (
            <button key={campus} type="button" aria-pressed={query.campus === campus} onClick={() => update({ campus })}>
              {campus === "all" ? "All" : CAMPUS_LABEL[campus]}
            </button>
          ))}
        </div>
      </div>
      <p className={styles.filterNote}>
        {query.categories.includes("national")
          ? hasNationalDates(year)
            ? "Holidays & school: South African public holidays and national public-school terms (DBE). They aren’t Missio’s house-church terms."
            : `No public holiday or school dates are loaded for ${year} yet.`
          : "Public holidays and school terms are hidden."}
      </p>

      <Legend />

      {view === "year" ? (
        <YearView year={year} occurrences={occurrences} today={today} onOpenMonth={(m) => update({ view: "month", month: m })} />
      ) : null}
      {view === "month" ? (
        <MonthView
          year={year}
          month={month}
          occurrences={occurrences}
          today={today}
          selected={selectedDay}
          onSelect={setSelected}
          onOpen={onOpenEvent}
          onAdd={onAdd}
        />
      ) : null}
      {view === "agenda" ? <AgendaView year={year} month={month} occurrences={occurrences} today={today} onOpen={onOpenEvent} /> : null}
    </div>
  );
}

function Chevron({ left = false }: { left?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={left ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}

/**
 * The pastor's calendar (/missio/calendar). Pastors only: the route
 * checks has_org_role, and RLS (migration 395) is the wall underneath.
 */
export function MissioCalendar({ client = calendarClient, now }: { client?: CalendarClient; now?: Date }) {
  const today = useMemo(() => joburgToday(now), [now]);
  const { state, retry } = useMissioLoad(() => client.list(), [client]);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [sheet, setSheet] = useState<Sheet>({ kind: "none" });
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (state.phase === "ready") setEvents(state.data.events);
  }, [state]);

  const available = state.phase === "ready" ? state.data.available : true;
  const list = events ?? [];
  const close = () => setSheet({ kind: "none" });

  let banner: React.ReactNode = null;
  if (state.phase === "loading") banner = <p className={shell.state}>Loading the calendar…</p>;
  else if (state.phase === "error") banner = <HouseStatus error={state.error} fallback="The calendar didn’t load." onRetry={retry} />;
  else if (!available)
    banner = (
      <p className={styles.notice} role="status" data-testid="calendar-unavailable">
        The calendar isn’t switched on yet, so events can’t be added or shared. Public holidays and school terms show
        below.
      </p>
    );
  else if (list.length === 0)
    banner = (
      <div className={styles.empty} data-testid="calendar-empty">
        <p>
          <b>No Missio events yet.</b> Add Sundays and special services, house church terms, camps and outreaches, and
          leader meetings. Public holidays and school terms are already in.
        </p>
        <button type="button" className={shell.primary} onClick={() => setSheet({ kind: "add", day: today })}>
          Add the first event
        </button>
      </div>
    );

  return (
    <>
      <CalendarScreen
        events={list}
        today={today}
        pastor
        onAdd={(day) => setSheet({ kind: "add", day })}
        onOpenEvent={(occ) =>
          occ.event.source === "missio" ? setSheet({ kind: "edit", event: occ.event, occurrence: occ }) : setSheet({ kind: "detail", occurrence: occ })
        }
        banner={
          <>
            {banner}
            {notice ? (
              <p className={shell.info} role="status">
                {notice}
              </p>
            ) : null}
          </>
        }
        actions={
          <>
            <button type="button" className={`${shell.ghost} ${styles.headButton}`} onClick={() => setSheet({ kind: "share" })} data-testid="calendar-share-open">
              <ShareIcon />
              Share
            </button>
            <button type="button" className={`${shell.primary} ${styles.headButton}`} onClick={() => setSheet({ kind: "add", day: today })} data-testid="calendar-add">
              + Add event
            </button>
          </>
        }
      />
      {sheet.kind === "add" || sheet.kind === "edit" ? (
        <EventSheet
          client={client}
          event={sheet.kind === "edit" ? sheet.event : null}
          occurrence={sheet.kind === "edit" ? sheet.occurrence : null}
          day={sheet.kind === "add" ? sheet.day : today}
          onClose={close}
          onSaved={(saved) => {
            setEvents((current) => [...(current ?? []).filter((item) => item.id !== saved.id), saved]);
            setNotice(sheet.kind === "add" ? `Added “${saved.title}”.` : `Saved “${saved.title}”.`);
            close();
          }}
          onDeleted={(id) => {
            setEvents((current) => (current ?? []).filter((item) => item.id !== id));
            setNotice("Deleted.");
            close();
          }}
        />
      ) : null}
      {sheet.kind === "detail" ? <EventDetail occurrence={sheet.occurrence} pastor onClose={close} /> : null}
      {sheet.kind === "share" ? <ShareSheet client={client} onClose={close} /> : null}
    </>
  );
}

/** The public read-only page (/serve/missio/calendar/<token>). No edit controls. */
export function PublicCalendar({ name, events, now }: { name: string; events: CalendarEvent[]; now?: Date }) {
  const today = useMemo(() => joburgToday(now), [now]);
  const [detail, setDetail] = useState<Occurrence | null>(null);
  return (
    <div className={styles.publicFrame} data-skin="missio">
      <header className={styles.publicTop}>
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand mark */}
        <img src="/brands/missio/missio-wordmark-paper.png" alt={name || "Missio"} className={styles.publicMark} />
        <span>Read-only calendar</span>
      </header>
      <main className={styles.publicMain}>
        <CalendarScreen events={events} today={today} pastor={false} onOpenEvent={setDetail} />
      </main>
      {detail ? <EventDetail occurrence={detail} pastor={false} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}

function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13" />
    </svg>
  );
}

/**
 * /missio/calendar inside the shell. Leaders and coaches open Missio but
 * not the calendar (same gate as People); the API refuses them anyway.
 */
export function MissioCalendarPage({ client, now }: { client?: CalendarClient; now?: Date }) {
  const viewer = useMissioViewer();
  if (viewer && !isMissioPastor(viewer)) {
    return (
      <div className={content.page} data-testid="calendar-pastors-only">
        <h1 className={content.title}>Calendar</h1>
        <p className={`${shell.lede} ${content.lede}`}>The Missio calendar is for pastors for now.</p>
      </div>
    );
  }
  return <MissioCalendar client={client} now={now} />;
}
