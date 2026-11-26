// Fleet calendar — one row per vehicle, one bar per booking, the next 30 days left to
// right (running into the next month on its own).
// Design: frame 38a in FFSA Hub Redesign.dc.html. Rendered on the team-only
// booking board (/bookings/vehicles/board) — it names people and plates.
//
// Reads only what exists today (vehicles, vehicle_bookings, vehicle_booking_assignments).
// Statuses mapped from the live vocabulary:
//   approved + today inside the trip → OUT NOW (yellow)
//   approved                         → BOOKED (bone)
//   pending                          → WAITING ON APPROVAL (dashed)
//   completed, or ended before today → DONE (faded)
//   vehicle.status = maintenance     → OFF THE ROAD (black, all 30 days)
// Denied / cancelled are not drawn. Bookings with no vehicle assigned get their own row.
//
// For Fleet users (Fleet part 5b, one calendar) each vehicle also gets a thin lane under its
// bookings: workshop visits (hatched amber, with the workshop) and inspection days (a square,
// filled when done, red when overdue). Bookings and visits that clash get a red border.

import Link from "next/link";
import type { Vehicle, VehicleBookingWithRefs } from "@/services/vehicles";
import { todayInSA } from "@/lib/users/profile-fields";
import type { BoardLane, BoardOverlay } from "./fleet/calendar/model";

const INK = "#0A0A0A";
const BONE = "#F4F2EA";
const RED = "hsl(0 62% 42%)";
const GREEN = "#3E7F2B";
const AMBER = "#8A6400";
const HATCH = `repeating-linear-gradient(135deg, #FFF7E0 0 6px, #F3E3B5 6px 8px)`;
// next/font serves these under generated family names, so go through the
// variables the root layout sets (as globals.css does); the plain names are
// only a fallback.
const MONO = "var(--font-roboto-mono), 'Roboto Mono', ui-monospace, monospace";
const COND = "var(--font-roboto-condensed), 'Roboto Condensed', 'Arial Narrow', sans-serif";
const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Kind = "out" | "booked" | "pending" | "done";
const BAR: Record<Kind, React.CSSProperties & { metaColor: string }> = {
  out: { background: "#FFB801", border: `1px solid ${INK}`, color: INK, metaColor: INK },
  booked: { background: "#F1EFE7", border: "1px solid #B4B0A2", color: INK, metaColor: "#55524A" },
  pending: { background: "#FFFFFF", border: `1.5px dashed ${INK}`, color: INK, metaColor: "#8A6400" },
  done: { background: "#F8F7F2", border: "1px solid #DEDACE", color: "#9A9689", metaColor: "#B4B0A2" },
};

// Dates are plain YYYY-MM-DD strings; do the maths in UTC so time zones never shift a day.
const d = (s: string) => new Date(s.slice(0, 10) + "T00:00:00Z");
const iso = (x: Date) => x.toISOString().slice(0, 10);
const addDays = (x: Date, n: number) => new Date(x.getTime() + n * 86400000);

/** Days on the fleet calendar. */
export const WINDOW_DAYS = 30;
const fmtShort = (x: Date) => `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()].slice(0, 3)}`;

/**
 * The 30 days the calendar shows. `from` is a start date (YYYY-MM-DD); an old
 * month link (YYYY-MM) starts on the 1st of that month, or today if it's this
 * month; nothing means today. Back and forward move 30 days.
 */
export function calendarWindow(from?: string) {
  // The server runs in UTC; "today" is South African.
  const todayIso = todayInSA();
  let start = todayIso;
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) start = from;
  else if (from && /^\d{4}-\d{2}$/.test(from)) start = from === todayIso.slice(0, 7) ? todayIso : `${from}-01`;
  const first = d(start);
  const last = addDays(first, WINDOW_DAYS - 1);
  const sameYear = first.getUTCFullYear() === last.getUTCFullYear();
  const label = `${fmtShort(first)}${sameYear ? "" : " " + first.getUTCFullYear()} – ${fmtShort(last)} ${last.getUTCFullYear()}`;
  return {
    first,
    last,
    from: iso(first),
    to: iso(last),
    prev: iso(addDays(first, -WINDOW_DAYS)),
    next: iso(addDays(first, WINDOW_DAYS)),
    isToday: start === todayIso,
    label,
  };
}

export function FleetCalendar({
  vehicles,
  bookings,
  from,
  basePath = "/bookings/vehicles/board",
  status,
  overlay,
}: {
  vehicles: Vehicle[];
  bookings: VehicleBookingWithRefs[];
  /** First day shown (YYYY-MM-DD); today when absent. */
  from?: string;
  /** Page the arrows link back to. */
  basePath?: string;
  /** The page's status filter, kept when moving through the dates. */
  status?: string;
  /** Fleet's lane (workshop visits, inspection days, clashes): Fleet users only. */
  overlay?: BoardOverlay | null;
}) {
  const w = calendarWindow(from);
  const windowHref = (f: string | null) => {
    const q = new URLSearchParams();
    if (f) q.set("from", f);
    if (status && status !== "all") q.set("status", status);
    const qs = q.toString();
    return `${basePath}${qs ? `?${qs}` : ""}`;
  };
  const days = WINDOW_DAYS;
  const todayIso = todayInSA();
  const today = d(todayIso);
  const dayIndex = (x: Date) => Math.round((x.getTime() - w.first.getTime()) / 86400000) + 1;
  const inMonth = today >= w.first && today <= w.last;
  const todayN = inMonth ? dayIndex(today) : -1;

  const live = bookings.filter((b) => b.status !== "denied" && b.status !== "cancelled");
  const fleet = vehicles.filter((v) => v.status !== "retired");
  const groups: { label: string; rows: Vehicle[] }[] = [
    { label: "KOMBIS", rows: fleet.filter((v) => v.vehicle_type === "van") },
    { label: "CARS", rows: fleet.filter((v) => v.vehicle_type === "car") },
  ].filter((g) => g.rows.length);

  const kindOf = (b: VehicleBookingWithRefs): Kind => {
    if (b.status === "pending") return "pending";
    if (b.status === "completed" || d(b.return_date) < today) return "done";
    if (d(b.checkout_date) <= today && d(b.return_date) >= today) return "out";
    return "booked";
  };

  const barsFor = (list: VehicleBookingWithRefs[]) =>
    list.map((b) => {
      const s = d(b.checkout_date), e = d(b.return_date);
      const start = s < w.first ? 1 : dayIndex(s);
      const end = e > w.last ? days : dayIndex(e);
      const span = Math.max(1, end - start + 1);
      const fmt = (x: Date) => fmtShort(x).toUpperCase();
      const meta = `${s < w.first ? "← " : ""}${fmt(s)} – ${fmt(e)}${e > w.last ? " →" : ""}`;
      return { b, start, span, meta, kind: kindOf(b) };
    });

  const byVehicle = (id: string) => live.filter((b) => (b.assignments ?? []).some((a) => a.vehicle?.id === id));
  const unassigned = live.filter((b) => !(b.assignments ?? []).some((a) => a.vehicle));
  const outNow = live.filter((b) => kindOf(b) === "out").length;
  const busyToday = new Set(live.filter((b) => b.status === "approved" && d(b.checkout_date) <= today && d(b.return_date) >= today)
    .flatMap((b) => (b.assignments ?? []).map((a) => a.vehicle?.id)));
  const freeToday = fleet.filter((v) => v.status === "active" && !busyToday.has(v.id)).length;

  const cols = `210px repeat(${days}, minmax(0,1fr))`;
  const dayInfo = Array.from({ length: days }, (_, i) => {
    const date = addDays(w.first, i);
    const dow = date.getUTCDay();
    const dom = date.getUTCDate();
    return { n: i + 1, dom, mon: i === 0 || dom === 1 ? MONTHS[date.getUTCMonth()].slice(0, 3).toUpperCase() : "", dow: DOW[dow], weekend: dow === 0 || dow === 6, monday: dow === 1, past: date < today };
  });
  // A new month gets a black rule, a new week a darker one.
  const rule = (x: (typeof dayInfo)[number]) => (x.dom === 1 && x.n > 1 ? INK : x.monday ? "#B4B0A2" : "#EFEDE4");
  const cellBg = (x: (typeof dayInfo)[number]) => (x.n === todayN ? "#FFFDF6" : x.past ? "#FBFAF6" : x.weekend ? "#FCFBF8" : "#FFFFFF");

  const clashIds = new Set(overlay?.clashBookingIds ?? []);
  const spanOf = (from: string, to: string) => {
    const s = d(from), e = d(to);
    const start = s < w.first ? 1 : dayIndex(s);
    const end = e > w.last ? days : dayIndex(e);
    return { start, span: Math.max(1, end - start + 1), cut: { l: s < w.first, r: e > w.last } };
  };

  /** The Fleet lane: workshop visits and inspection days, under the bookings. */
  const LaneMarks = ({ lane }: { lane: BoardLane }) => (
    <>
      {lane.out && (() => {
        const start = lane.out.since && d(lane.out.since) > w.first ? (d(lane.out.since) > w.last ? days + 1 : dayIndex(d(lane.out.since))) : 1;
        if (start > days) return null;
        return (
          <span
            title={`${lane.out.label}${lane.out.since ? " since " + lane.out.since : ""}: can’t be booked until it’s back in service`}
            style={{ gridRow: 2, gridColumn: `${start} / span ${days - start + 1}`, margin: "0 2px 5px", background: INK, display: "flex", alignItems: "center", padding: "0 8px", minWidth: 0, overflow: "hidden" }}
          >
            <span style={{ fontFamily: MONO, fontSize: 7.5, fontWeight: 700, letterSpacing: "0.1em", color: "#FFFFFF", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {lane.out.label} · UNTIL IT’S BACK
            </span>
          </span>
        );
      })()}
      {lane.visits.map((v) => {
        const { start, span, cut } = spanOf(v.from, v.to);
        return (
          <span
            key={v.id}
            title={`${v.clash ? "Clash · " : ""}${v.tip}`}
            style={{ gridRow: 2, gridColumn: `${start} / span ${span}`, margin: "0 2px 5px", background: HATCH, border: v.clash ? `2px solid ${RED}` : `1px solid ${AMBER}`, minWidth: 0, overflow: "hidden", display: "flex", alignItems: "center", padding: span < 2 ? 0 : "0 6px" }}
          >
            {span >= 2 && (
              <span style={{ fontFamily: MONO, fontSize: 7.5, fontWeight: 700, letterSpacing: "0.08em", color: v.clash ? RED : AMBER, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {cut.l ? "← " : ""}{v.clash ? "CLASH · " : ""}{v.label.toUpperCase()}{cut.r ? " →" : ""}
              </span>
            )}
            <span className="sr-only">{v.clash ? "Clash: " : ""}{v.tip}</span>
          </span>
        );
      })}
      {lane.checks
        .filter((c) => c.date >= iso(w.first) && c.date <= iso(w.last))
        .map((c) => (
          <span key={c.date} title={c.tip} style={{ gridRow: 2, gridColumn: dayIndex(d(c.date)), justifySelf: "center", alignSelf: "center", marginBottom: 5, width: 11, height: 11, boxSizing: "border-box", border: `2px solid ${c.st === "late" ? RED : GREEN}`, background: c.st === "done" ? GREEN : "transparent" }}>
            <span className="sr-only">{c.tip}</span>
          </span>
        ))}
    </>
  );

  const Row = ({ title, sub, warn, list, offRoad, lane }: { title: string; sub: string; warn?: string; list: VehicleBookingWithRefs[]; offRoad?: boolean; lane?: BoardLane }) => (
    <div style={{ display: "grid", gridTemplateColumns: cols, borderBottom: "1px solid #E7E4D9", minHeight: lane ? 82 : 62 }}>
      <div style={{ padding: "11px 16px", borderRight: `1px solid ${INK}`, display: "flex", flexDirection: "column", justifyContent: "center", gap: 3 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>{title}</div>
        <div style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: "0.1em", color: "#7C786C" }}>{sub}</div>
        {warn && <div style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", color: "#8A6400" }}>{warn}</div>}
      </div>
      <div style={{ gridColumn: `2 / span ${days}`, display: "grid", gridTemplateColumns: `repeat(${days}, minmax(0,1fr))`, gridTemplateRows: lane ? "minmax(56px, 1fr) 22px" : undefined }}>
        {dayInfo.map((x) => (
          <span key={x.n} style={{ gridRow: lane ? "1 / span 2" : 1, gridColumn: x.n, borderLeft: `1px solid ${rule(x)}`, background: cellBg(x) }} />
        ))}
        {lane && !offRoad && <LaneMarks lane={lane} />}
        {offRoad ? (
          <div style={{ gridRow: 1, gridColumn: `1 / span ${days}`, margin: "6px 2px", background: INK, display: "flex", alignItems: "center", padding: "0 10px" }}>
            <span style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: "0.12em", color: "#FFFFFF" }}>OFF THE ROAD · MAINTENANCE</span>
          </div>
        ) : (
          barsFor(list).map(({ b, start, span, meta, kind }) => {
            const { metaColor, ...base } = BAR[kind];
            const clash = clashIds.has(b.id) && kind !== "done";
            const style = clash ? { ...base, border: `2px solid ${RED}` } : base;
            return (
              <Link
                key={b.id}
                href={`/bookings/vehicles/${b.id}`}
                title={`${clash ? "Clash · " : ""}${b.booking_name} · ${meta}`}
                style={{ ...style, gridRow: 1, gridColumn: `${start} / span ${span}`, margin: "6px 2px", padding: span < 2 ? 0 : "5px 8px", minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, textDecoration: "none" }}
              >
                {span >= 2 && (
                  <>
                    <span style={{ fontFamily: MONO, fontSize: 7.5, fontWeight: 700, letterSpacing: "0.08em", color: metaColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {clash ? <span style={{ color: RED }}>CLASH · </span> : null}
                      {kind === "pending" ? "WAITING · " : ""}{meta}
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {b.booking_name}{b.point_person ? ` · ${b.point_person}` : ""}
                    </span>
                  </>
                )}
              </Link>
            );
          })
        )}
      </div>
    </div>
  );

  const navBtn: React.CSSProperties = { width: 44, height: 44, border: `1px solid ${INK}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 15, fontWeight: 700, color: INK, textDecoration: "none" };
  const legend: [string, React.CSSProperties][] = [
    ["BOOKED", { background: "#F1EFE7", border: "1px solid #B4B0A2" }],
    ["WAITING ON APPROVAL", { background: "#FFFFFF", border: `1.5px dashed ${INK}` }],
    ["OUT RIGHT NOW", { background: "#FFB801", border: `1px solid ${INK}` }],
    ["OFF THE ROAD", { background: INK }],
    ["DONE", { background: "#F8F7F2", border: "1px solid #DEDACE" }],
    ["FREE", { background: "#FFFFFF", border: "1px solid #DEDACE" }],
    ...(overlay
      ? ([
          ["AT THE WORKSHOP", { background: HATCH, border: `1px solid ${AMBER}` }],
          ["CLASH", { background: "#FFFFFF", border: `2px solid ${RED}` }],
          ["INSPECTION DAY", { width: 12, border: `2px solid ${GREEN}` }],
          ["CHECKED", { width: 12, background: GREEN, border: `2px solid ${GREEN}` }],
          ["CHECK OVERDUE", { width: 12, border: `2px solid ${RED}` }],
        ] as [string, React.CSSProperties][])
      : []),
  ];

  return (
    // Only the day grid scrolls sideways; the header and legend wrap, so on a phone the
    // dates and the back/forward buttons stay on screen.
    <div style={{ background: "#FFFFFF", border: `1px solid ${INK}` }}>
      <div>
        <div style={{ borderBottom: `1px solid ${INK}`, padding: "16px clamp(14px, 4vw, 26px)", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "16px 24px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <Link href={windowHref(w.prev)} style={navBtn} aria-label="Previous 30 days">‹</Link>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
                <span style={{ width: 16, height: 3, background: "#FFB801" }} />
                <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", color: "#55524A" }}>
                  FLEET CALENDAR · {fleet.length} VEHICLES · {w.isToday ? "NEXT 30 DAYS" : "30 DAYS"}
                  {!w.isToday && (
                    <>
                      {" · "}
                      <Link href={windowHref(null)} style={{ color: INK, textDecoration: "underline" }}>TODAY</Link>
                    </>
                  )}
                </span>
              </div>
              <h2 style={{ margin: 0, fontFamily: COND, fontWeight: 900, fontSize: "clamp(26px, 8vw, 44px)", lineHeight: 0.95, textTransform: "uppercase", color: INK }}>{w.label}</h2>
            </div>
            <Link href={windowHref(w.next)} style={navBtn} aria-label="Next 30 days">›</Link>
          </div>
          {inMonth && (
            <div style={{ display: "flex", gap: 20 }}>
              {[["OUT RIGHT NOW", outNow], ["FREE TODAY", freeToday]].map(([l, n]) => (
                <div key={l as string}>
                  <div style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: "0.12em", color: "#7C786C" }}>{l}</div>
                  <div style={{ fontFamily: COND, fontWeight: 900, fontSize: 30, lineHeight: 1, color: INK, fontVariantNumeric: "tabular-nums" }}>{n}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 1080 }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, background: BONE, borderBottom: `2px solid ${INK}` }}>
          <div style={{ padding: "10px 16px", borderRight: `1px solid ${INK}`, display: "flex", alignItems: "flex-end" }}>
            <span style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: "0.16em", color: "#7C786C" }}>VEHICLE</span>
          </div>
          {dayInfo.map((x) => {
            const isToday = x.n === todayN;
            return (
              <div key={x.n} style={{ padding: "8px 0 7px", textAlign: "center", borderLeft: `1px solid ${rule(x)}`, borderTop: `3px solid ${isToday ? "#FFB801" : "transparent"}`, background: isToday ? INK : x.weekend ? "#EDEAE0" : BONE }}>
                <div style={{ fontFamily: MONO, fontSize: 7.5, fontWeight: 700, letterSpacing: "0.06em", color: isToday ? "#FFB801" : x.weekend || x.past ? "#9A9689" : "#7C786C" }}>{x.dow}</div>
                <div style={{ fontFamily: COND, fontWeight: 900, fontSize: 15, lineHeight: 1.15, color: isToday ? "#FFFFFF" : x.past ? "#B4B0A2" : INK, fontVariantNumeric: "tabular-nums" }}>{x.dom}</div>
                <div style={{ fontFamily: MONO, fontSize: 7, fontWeight: 700, letterSpacing: "0.06em", lineHeight: 1.2, minHeight: 8, color: isToday ? "#FFB801" : INK }}>{x.mon}</div>
              </div>
            );
          })}
        </div>

        {groups.map((g) => (
          <div key={g.label}>
            <div style={{ background: INK, padding: "8px 16px", display: "flex", gap: 12 }}>
              <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", color: "#FFFFFF" }}>{g.label}</span>
              <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.12em", color: "#8E8A7C" }}>{g.rows.length} VEHICLES</span>
            </div>
            {g.rows.map((v) => (
              <Row
                key={v.id}
                title={v.name}
                sub={[v.registration_plate, v.seats ? `${v.seats} SEATS` : null].filter(Boolean).join(" · ").toUpperCase()}
                list={byVehicle(v.id)}
                // Fleet users see an out-of-action vehicle's bookings with a bar in the lane
                // (Fleet 5c); everyone else sees the row blacked out as before.
                offRoad={v.status === "maintenance" && !overlay?.lanes[v.id]?.out}
                lane={overlay?.lanes[v.id]}
              />
            ))}
          </div>
        ))}

        {unassigned.length > 0 && (
          <div>
            <div style={{ background: INK, padding: "8px 16px", display: "flex", gap: 12 }}>
              <span style={{ fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", color: "#FFFFFF" }}>NO VEHICLE YET</span>
              <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.12em", color: "#8E8A7C" }}>{unassigned.length} BOOKINGS</span>
            </div>
            <Row title="Not assigned" sub="ASSIGN FROM THE BOOKING" list={unassigned} />
          </div>
        )}

        </div>
        </div>

        <div style={{ padding: "14px clamp(14px, 4vw, 26px)", background: BONE, display: "flex", gap: "10px 26px", alignItems: "center", flexWrap: "wrap" }}>
          {legend.map(([l, s]) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "#45423B" }}>
              <span style={{ width: 20, height: 12, boxSizing: "border-box", ...s }} />{l}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
