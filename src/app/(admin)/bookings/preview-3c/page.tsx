// Dev-only render of frame 3c against fixtures, so the composition can be
// checked at 1440 and 375 without a signed-in session and without inventing
// bookings in the real database. It renders the SAME <BookingsDay> the route
// renders — only the data and the gating booleans are stand-ins.
//
// Not reachable in production: the route 404s outside development.

import { notFound } from "next/navigation";
import { BookingsDay } from "../bookings-day";
import type { TimelineResource } from "../day-timeline";
import type { ApprovalRow } from "../approval-queue";

const hm = (h: number, m = 0) => h * 60 + m;

const RESOURCES: TimelineResource[] = [
  {
    key: "venue:1",
    name: "Main Auditorium",
    kind: "Space",
    meta: "Main Building",
    color: "#0ea5e9",
    items: [
      {
        id: "b1",
        title: "Morning Devotions",
        href: "#",
        status: "approved",
        timeLabel: "07:30 – 09:00",
        window: { start: hm(7, 30), end: hm(9) },
      },
      {
        id: "b2",
        title: "DTS Lecture — Father Heart",
        href: "#",
        status: "approved",
        timeLabel: "09:30 – 12:30",
        window: { start: hm(9, 30), end: hm(12, 30) },
      },
      // Deliberate overlap with the lecture: this is the clash the screen exists
      // to make visible.
      {
        id: "b3",
        title: "Worship Practice",
        href: "#",
        status: "pending",
        timeLabel: "11:30 – 13:00",
        window: { start: hm(11, 30), end: hm(13) },
      },
    ],
  },
  {
    key: "venue:2",
    name: "Seminar Room B",
    kind: "Space",
    meta: "Main Building",
    color: "#6366f1",
    items: [
      {
        id: "b4",
        title: "Staff Meeting",
        href: "#",
        status: "approved",
        timeLabel: "14:00 – 15:30",
        window: { start: hm(14), end: hm(15, 30) },
      },
    ],
  },
  {
    key: "venue:3",
    name: "Prayer Room",
    kind: "Space",
    meta: "Upper Floor",
    color: "#16a34a",
    items: [],
  },
  {
    key: "venue:4",
    name: "Dining Hall",
    kind: "Space",
    meta: "Base",
    color: "#d97706",
    items: [
      {
        id: "b5",
        title: "Camp set-up",
        href: "#",
        status: "approved",
        timeLabel: "All day",
        window: null,
      },
    ],
  },
  {
    key: "vehicle:1",
    name: "White Quantum",
    kind: "Vehicle",
    meta: "ND 412-338",
    color: "#0f766e",
    items: [
      {
        id: "v1",
        title: "Airport run — Durban",
        href: "#",
        status: "approved",
        timeLabel: "All day",
        window: null,
      },
      // A second all-day trip on the same van: two all-day blocks always clash.
      {
        id: "v2",
        title: "Outreach — Kwa-Mashu",
        href: "#",
        status: "pending",
        timeLabel: "All day",
        window: null,
      },
    ],
  },
  {
    key: "vehicle:2",
    name: "Silver Hilux",
    kind: "Vehicle",
    meta: "ND 907-114",
    color: "#7c3aed",
    items: [],
  },
  {
    key: "vehicle:unassigned",
    name: "Awaiting a vehicle",
    kind: "Vehicle",
    meta: null,
    color: "#64748b",
    items: [
      {
        id: "v3",
        title: "Team pickup — Ballito",
        href: "#",
        status: "pending",
        timeLabel: "All day",
        window: null,
      },
    ],
  },
];

const APPROVALS: ApprovalRow[] = [
  {
    id: "b3",
    service: "spaces",
    resource: "Main Auditorium",
    when: "3 Aug 2026 · 11:30 – 13:00",
    why: "Worship Practice — Thandi Mokoena",
    href: "#",
  },
  {
    id: "v2",
    service: "vehicles",
    resource: "White Quantum",
    when: "3 Aug 2026 – 5 Aug 2026",
    why: "Outreach — Kwa-Mashu — Ministry",
    href: "#",
  },
  {
    id: "v3",
    service: "vehicles",
    resource: "Awaiting a vehicle",
    when: "3 Aug 2026",
    why: "Team pickup — Ballito — Airport run",
    href: "#",
  },
];

export default function Frame3cPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    
      <BookingsDay
        date="2026-08-03"
        today="2026-08-03"
        showing="all"
        resources={RESOURCES}
        startHour={7}
        endHour={19}
        approvals={APPROVALS}
        showApprovals
        canSpaces
        canVehicles
        canBookSpace
        canBookVehicle
      />
    
  );
}
