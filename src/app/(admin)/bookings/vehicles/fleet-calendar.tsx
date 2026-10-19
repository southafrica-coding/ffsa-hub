// Fleet calendar — one row per vehicle, one bar per booking, the month left to right.
// Design: frame 38a in FFSA Hub Redesign.dc.html. Rendered on the team-only
// booking board (/bookings/vehicles/board) — it names people and plates.
//
// Reads only what exists today (vehicles, vehicle_bookings, vehicle_booking_assignments).
// Statuses mapped from the live vocabulary:
//   approved + today inside the trip → OUT NOW (yellow)
//   approved                         → BOOKED (bone)
//   pending                          → WAITING ON APPROVAL (dashed)
//   completed, or ended before today → DONE (faded)
//   vehicle.status = maintenance     → OFF THE ROAD (black, whole month)
// Denied / cancelled are not drawn. Bookings with no vehicle assigned get their own row.

import Link from "next/link";
import type { Vehicle, VehicleBookingWithRefs } from "@/services/vehicles";
import { todayInSA } from "@/lib/users/profile-fields";

const INK = "#0A0A0A";
const BONE = "#F4F2EA";
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

export function monthWindow(month?: string) {
  // The server runs in UTC; "this month" and "today" are South African.
  const [ty, tm] = todayInSA().split("-").map(Number);
  const [y, m] = month && /^\d{4}-\d{2}$/.test(month)
    ? month.split("-").map(Number)
    : [ty, tm];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  const key = (yy: number, mm: number) => {
    const t = new Date(Date.UTC(yy, mm - 1, 1));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  return { first, last, from: iso(first), to: iso(last), prev: key(y, m - 1), next: key(y, m + 1), label: `${MONTHS[m - 1]} ${y}` };
}

export function FleetCalendar({
  vehicles,
  bookings,
  month,
  basePath = "/bookings/vehicles/board",
  status,
}: {
  vehicles: Vehicle[];
  bookings: VehicleBookingWithRefs[];
  month?: string;
  /** Page the month arrows link back to. */
  basePath?: string;
  /** The page's status filter, kept across month changes. */
  status?: string;
}) {
  const w = monthWindow(month);
  const monthHref = (m: string) =>
    `${basePath}?month=${m}${status && status !== "all" ? `&status=${encodeURIComponent(status)}` : ""}`;
  const days = w.last.getUTCDate();
  const todayIso = todayInSA();
  const today = d(todayIso);
  const inMonth = today >= w.first && today <= w.last;
  const todayN = inMonth ? today.getUTCDate() : -1;

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
      const start = s < w.first ? 1 : s.getUTCDate();
      const end = e > w.last ? days : e.getUTCDate();
      const span = Math.max(1, end - start + 1);
      const fmt = (x: Date) => `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()].slice(0, 3).toUpperCase()}`;
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
    return { n: i + 1, dow: DOW[dow], weekend: dow === 0 || dow === 6, monday: dow === 1, past: date < today };
  });
  const rule = (x: (typeof dayInfo)[number]) => (x.monday ? "#B4B0A2" : "#EFEDE4");
  const cellBg = (x: (typeof dayInfo)[number]) => (x.n === todayN ? "#FFFDF6" : x.past ? "#FBFAF6" : x.weekend ? "#FCFBF8" : "#FFFFFF");

  const Row = ({ title, sub, warn, list, offRoad }: { title: string; sub: string; warn?: string; list: VehicleBookingWithRefs[]; offRoad?: boolean }) => (
    <div style={{ display: "grid", gridTemplateColumns: cols, borderBottom: "1px solid #E7E4D9", minHeight: 62 }}>
      <div style={{ padding: "11px 16px", borderRight: `1px solid ${INK}`, display: "flex", flexDirection: "column", justifyContent: "center", gap: 3 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>{title}</div>
        <div style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: "0.1em", color: "#7C786C" }}>{sub}</div>
        {warn && <div style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", color: "#8A6400" }}>{warn}</div>}
      </div>
      <div style={{ gridColumn: `2 / span ${days}`, display: "grid", gridTemplateColumns: `repeat(${days}, minmax(0,1fr))` }}>
        {dayInfo.map((x) => (
          <span key={x.n} style={{ gridRow: 1, gridColumn: x.n, borderLeft: `1px solid ${rule(x)}`, background: cellBg(x) }} />
        ))}
        {offRoad ? (
          <div style={{ gridRow: 1, gridColumn: `1 / span ${days}`, margin: "6px 2px", background: INK, display: "flex", alignItems: "center", padding: "0 10px" }}>
            <span style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: "0.12em", color: "#FFFFFF" }}>OFF THE ROAD · MAINTENANCE</span>
          </div>
        ) : (
          barsFor(list).map(({ b, start, span, meta, kind }) => {
            const { metaColor, ...style } = BAR[kind];
            return (
              <Link
                key={b.id}
                href={`/bookings/vehicles/${b.id}`}
                title={`${b.booking_name} · ${meta}`}
                style={{ ...style, gridRow: 1, gridColumn: `${start} / span ${span}`, margin: "6px 2px", padding: span < 2 ? 0 : "5px 8px", minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "center", gap: 2, textDecoration: "none" }}
              >
                {span >= 2 && (
                  <>
                    <span style={{ fontFamily: MONO, fontSize: 7.5, fontWeight: 700, letterSpacing: "0.08em", color: metaColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
  ];

  return (
    <div style={{ background: "#FFFFFF", border: `1px solid ${INK}`, overflowX: "auto" }}>
      <div style={{ minWidth: 1080 }}>
        <div style={{ borderBottom: `1px solid ${INK}`, padding: "20px 26px", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Link href={monthHref(w.prev)} style={navBtn} aria-label="Previous month">‹</Link>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
                <span style={{ width: 16, height: 3, background: "#FFB801" }} />
                <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", color: "#55524A" }}>
                  FLEET CALENDAR · {fleet.length} VEHICLES
                </span>
              </div>
              <h2 style={{ margin: 0, fontFamily: COND, fontWeight: 900, fontSize: 44, lineHeight: 0.9, textTransform: "uppercase", color: INK }}>{w.label}</h2>
            </div>
            <Link href={monthHref(w.next)} style={navBtn} aria-label="Next month">›</Link>
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

        <div style={{ display: "grid", gridTemplateColumns: cols, background: BONE, borderBottom: `2px solid ${INK}` }}>
          <div style={{ padding: "10px 16px", borderRight: `1px solid ${INK}`, display: "flex", alignItems: "flex-end" }}>
            <span style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: "0.16em", color: "#7C786C" }}>VEHICLE</span>
          </div>
          {dayInfo.map((x) => {
            const isToday = x.n === todayN;
            return (
              <div key={x.n} style={{ padding: "8px 0 7px", textAlign: "center", borderLeft: `1px solid ${rule(x)}`, borderTop: `3px solid ${isToday ? "#FFB801" : "transparent"}`, background: isToday ? INK : x.weekend ? "#EDEAE0" : BONE }}>
                <div style={{ fontFamily: MONO, fontSize: 7.5, fontWeight: 700, letterSpacing: "0.06em", color: isToday ? "#FFB801" : x.weekend || x.past ? "#9A9689" : "#7C786C" }}>{x.dow}</div>
                <div style={{ fontFamily: COND, fontWeight: 900, fontSize: 15, lineHeight: 1.15, color: isToday ? "#FFFFFF" : x.past ? "#B4B0A2" : INK, fontVariantNumeric: "tabular-nums" }}>{x.n}</div>
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
                offRoad={v.status === "maintenance"}
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

        <div style={{ padding: "14px 26px", background: BONE, display: "flex", gap: 26, alignItems: "center", flexWrap: "wrap" }}>
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
