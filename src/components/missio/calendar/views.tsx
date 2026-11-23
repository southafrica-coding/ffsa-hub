"use client";

import { useState } from "react";
import {
  daysInMonth,
  formatDay,
  formatSpan,
  isoDate,
  monthEnd,
  monthStart,
  MONTH_NAMES,
  WEEKDAY_SHORT,
  weekdayMon,
} from "@/lib/missio/calendar/dates";
import { covers, isLongSpan, type Occurrence } from "@/lib/missio/calendar/occurrences";
import { CAMPUS_LABEL, CATEGORY_LABEL, CATEGORY_SHORT, type CalendarCategory } from "@/lib/missio/calendar/types";
import styles from "./calendar.module.css";

// ============================================================
// Year, month and list views. Pure presentation: the board owns state.
// Every category has a colour AND a shape AND a word, so colour is
// never the only clue (legend at the top, words on every row).
// ============================================================

export function Marker({ category }: { category: CalendarCategory }) {
  return <span className={styles.marker} data-cat={category} aria-hidden="true" />;
}

export function CategoryTag({ category }: { category: CalendarCategory }) {
  return (
    <span className={styles.tag} data-cat={category}>
      <Marker category={category} />
      {CATEGORY_SHORT[category]}
    </span>
  );
}

/** "All day", "09:00–11:00", "14 Jan – 27 Mar", "Fri 18:00 – Sun 14:00". */
export function whenLabel(occ: Occurrence): string {
  const { event } = occ;
  const multi = occ.startsOn !== occ.endsOn;
  if (!event.startTime || !event.endTime) return multi ? formatSpan(occ.startsOn, occ.endsOn) : "All day";
  if (!multi) return `${event.startTime}–${event.endTime}`;
  return `${formatDay(occ.startsOn)} ${event.startTime} – ${formatDay(occ.endsOn)} ${event.endTime}`;
}

function repeatLabel(occ: Occurrence): string | null {
  const repeat = occ.event.repeat;
  if (!repeat) return null;
  return repeat.every === 1 ? "Every week" : `Every ${repeat.every} weeks`;
}

function monthGrid(year: number, month: number): Array<string | null> {
  const first = monthStart(year, month);
  const lead = weekdayMon(first);
  const total = daysInMonth(year, month);
  const cells: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= total; day += 1) cells.push(isoDate(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function categoriesOn(day: string, occurrences: Occurrence[]): CalendarCategory[] {
  const seen: CalendarCategory[] = [];
  for (const occ of occurrences) {
    if (isLongSpan(occ) || !covers(occ, day)) continue;
    if (!seen.includes(occ.event.category)) seen.push(occ.event.category);
  }
  return seen;
}

function isPublicHoliday(day: string, occurrences: Occurrence[]): boolean {
  return occurrences.some((occ) => occ.event.category === "national" && !isLongSpan(occ) && covers(occ, day));
}

// ── Year ────────────────────────────────────────────────────

export function YearView({
  year,
  occurrences,
  today,
  onOpenMonth,
}: {
  year: number;
  occurrences: Occurrence[];
  today: string;
  onOpenMonth: (month: number) => void;
}) {
  return (
    <ol className={styles.year} data-testid="calendar-year">
      {MONTH_NAMES.map((name, index) => {
        const month = index + 1;
        const from = monthStart(year, month);
        const to = monthEnd(year, month);
        const inMonth = occurrences.filter((occ) => occ.endsOn >= from && occ.startsOn <= to);
        const starting = inMonth.filter((occ) => occ.startsOn >= from);
        const missio = inMonth.filter((occ) => occ.event.source === "missio").length;
        const isCurrent = today >= from && today <= to;
        const count = missio === 1 ? "1 event" : `${missio} events`;
        return (
          <li key={name}>
            <button
              type="button"
              className={styles.monthCard}
              data-current={isCurrent || undefined}
              onClick={() => onOpenMonth(month)}
              aria-label={`${name} ${year}: ${count}. Open the month.`}
            >
              <span className={styles.monthHead}>
                <span className={styles.monthName}>{name}</span>
                <span className={styles.monthCount}>{missio > 0 ? count : ""}</span>
              </span>
              <span className={styles.mini} aria-hidden="true">
                {WEEKDAY_SHORT.map((day) => (
                  <span key={day} className={styles.miniHead}>
                    {day[0]}
                  </span>
                ))}
                {monthGrid(year, month).map((day, cell) =>
                  day ? (
                    <span
                      key={day}
                      className={styles.miniDay}
                      data-today={day === today || undefined}
                      data-holiday={isPublicHoliday(day, inMonth) || undefined}
                    >
                      {Number(day.slice(8))}
                      <span className={styles.miniMarks}>
                        {categoriesOn(day, inMonth)
                          .filter((category) => category !== "national")
                          .slice(0, 3)
                          .map((category) => (
                            <Marker key={category} category={category} />
                          ))}
                      </span>
                    </span>
                  ) : (
                    <span key={`blank-${cell}`} />
                  )
                )}
              </span>
              <span className={styles.monthList}>
                {starting.slice(0, 3).map((occ) => (
                  <span key={occ.key} className={styles.monthItem} data-cat={occ.event.category}>
                    <Marker category={occ.event.category} />
                    <span className={styles.monthItemDay}>{Number(occ.startsOn.slice(8))}</span>
                    <span className={styles.monthItemTitle}>{occ.event.title}</span>
                  </span>
                ))}
                {starting.length > 3 ? <span className={styles.monthMore}>+{starting.length - 3} more</span> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ── Month ───────────────────────────────────────────────────

export function MonthView({
  year,
  month,
  occurrences,
  today,
  selected,
  onSelect,
  onOpen,
  onAdd,
}: {
  year: number;
  month: number;
  occurrences: Occurrence[];
  today: string;
  selected: string;
  onSelect: (day: string) => void;
  onOpen: (occ: Occurrence) => void;
  onAdd?: (day: string) => void;
}) {
  const long = occurrences.filter(isLongSpan);
  const short = occurrences.filter((occ) => !isLongSpan(occ));
  const dayItems = occurrences.filter((occ) => covers(occ, selected));
  return (
    <div className={styles.monthLayout} data-testid="calendar-month">
      <div className={styles.monthMain}>
        {long.length > 0 ? (
          <div className={styles.spans}>
            <span className={styles.spansLabel}>Running this month</span>
            <ul>
              {long.map((occ) => (
                <li key={occ.key}>
                  <button type="button" className={styles.spanChip} data-cat={occ.event.category} onClick={() => onOpen(occ)}>
                    <Marker category={occ.event.category} />
                    <b>{occ.event.title}</b>
                    <span>{formatSpan(occ.startsOn, occ.endsOn)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className={styles.grid} role="grid" aria-label={`${MONTH_NAMES[month - 1]} ${year}`}>
          <div className={styles.gridRow} role="row">
            {WEEKDAY_SHORT.map((day) => (
              <span key={day} className={styles.gridHead} role="columnheader">
                {day}
              </span>
            ))}
          </div>
          {chunk(monthGrid(year, month), 7).map((week, row) => (
            <div key={row} className={styles.gridRow} role="row">
              {week.map((day, cell) => {
                if (!day) return <span key={`blank-${row}-${cell}`} className={styles.cellBlank} role="gridcell" />;
                const items = short.filter((occ) => covers(occ, day));
                const holiday = items.some((occ) => occ.event.category === "national");
                return (
                  <button
                    key={day}
                    type="button"
                    role="gridcell"
                    className={styles.cell}
                    data-today={day === today || undefined}
                    data-holiday={holiday || undefined}
                    aria-selected={day === selected}
                    aria-label={`${formatDay(day)}${day === today ? ", today" : ""}: ${items.length === 0 ? "nothing on" : items.map((occ) => occ.event.title).join(", ")}`}
                    onClick={() => onSelect(day)}
                  >
                    <span className={styles.cellNum}>{Number(day.slice(8))}</span>
                    <span className={styles.cellChips}>
                      {items.slice(0, 3).map((occ) => (
                        <span key={occ.key} className={styles.cellChip} data-cat={occ.event.category}>
                          <Marker category={occ.event.category} />
                          <span className={styles.cellChipText}>
                            {occ.event.startTime ? `${occ.event.startTime} ` : ""}
                            {occ.event.title}
                          </span>
                        </span>
                      ))}
                      {items.length > 3 ? <span className={styles.cellMore}>+{items.length - 3}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <section className={styles.dayPanel} aria-live="polite" data-testid="calendar-day">
        <div className={styles.dayHead}>
          <h2>{formatDay(selected)}</h2>
          {onAdd ? (
            <button type="button" className={styles.addSmall} onClick={() => onAdd(selected)}>
              + Add on this day
            </button>
          ) : null}
        </div>
        {dayItems.length === 0 ? <p className={styles.quiet}>Nothing on this day.</p> : <OccurrenceList items={dayItems} onOpen={onOpen} />}
      </section>
    </div>
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

function OccurrenceList({ items, onOpen }: { items: Occurrence[]; onOpen: (occ: Occurrence) => void }) {
  return (
    <ul className={styles.rows}>
      {items.map((occ) => {
        const repeat = repeatLabel(occ);
        const meta = [
          occ.event.campus !== "all" ? CAMPUS_LABEL[occ.event.campus] : null,
          occ.event.location,
          repeat,
        ].filter(Boolean);
        return (
          <li key={occ.key}>
            <button type="button" className={styles.row} data-cat={occ.event.category} onClick={() => onOpen(occ)}>
              <span className={styles.rowWhen}>{whenLabel(occ)}</span>
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>{occ.event.title}</span>
                <span className={styles.rowMeta}>
                  <CategoryTag category={occ.event.category} />
                  {meta.length > 0 ? <span>{meta.join(" · ")}</span> : null}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ── Agenda ──────────────────────────────────────────────────

export function AgendaView({
  year,
  month,
  occurrences,
  today,
  onOpen,
}: {
  year: number;
  month: number;
  occurrences: Occurrence[];
  today: string;
  onOpen: (occ: Occurrence) => void;
}) {
  const [showEarlier, setShowEarlier] = useState(false);
  const from = monthStart(year, month);
  const to = monthEnd(year, month);
  const isCurrent = today >= from && today <= to;
  const start = isCurrent && !showEarlier ? today : from;
  const groups = new Map<string, Occurrence[]>();
  for (const occ of occurrences) {
    if (occ.endsOn < start) continue;
    // A span that began earlier is listed on the first day shown.
    const day = occ.startsOn < start ? start : occ.startsOn;
    groups.set(day, [...(groups.get(day) ?? []), occ]);
  }
  const days = [...groups.keys()].sort();
  const hidden = isCurrent && !showEarlier ? occurrences.filter((occ) => occ.endsOn < today).length : 0;

  return (
    <div className={styles.agenda} data-testid="calendar-agenda">
      {hidden > 0 ? (
        <button type="button" className={styles.earlier} onClick={() => setShowEarlier(true)}>
          Show {hidden} earlier this month
        </button>
      ) : null}
      {days.length === 0 ? (
        <p className={styles.quiet}>
          Nothing {isCurrent && !showEarlier ? "else" : ""} in {MONTH_NAMES[month - 1]} with these filters.
        </p>
      ) : null}
      {days.map((day) => (
        <section key={day} className={styles.agendaDay}>
          <h3 data-today={day === today || undefined}>
            {formatDay(day)}
            {day === today ? <span className={styles.todayTag}>Today</span> : null}
          </h3>
          <OccurrenceList items={groups.get(day) ?? []} onOpen={onOpen} />
        </section>
      ))}
    </div>
  );
}

// ── Legend ──────────────────────────────────────────────────

export function Legend() {
  return (
    <ul className={styles.legend} aria-label="Key">
      {(Object.keys(CATEGORY_LABEL) as CalendarCategory[]).map((category) => (
        <li key={category}>
          <Marker category={category} />
          {CATEGORY_LABEL[category]}
        </li>
      ))}
      <li>
        <span className={styles.legendToday} aria-hidden="true" />
        Today
      </li>
      <li>
        <span className={styles.legendHoliday} aria-hidden="true" />
        Public holiday (outlined date)
      </li>
    </ul>
  );
}
