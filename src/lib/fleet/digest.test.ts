// The Fleet half of the 07:00 vehicles message (Gideon, 19 Nov 2026): every vehicle IN or
// OUT; an OUT vehicle shows only who has it; clashes and today's trip checks go under Bookings.

import { describe, expect, it } from "vitest";
import { seedFleetData, withVehicle } from "@/lib/fleet/testing/seed";
import type { FleetData } from "@/lib/fleet/rules";
import { buildFleetDigest, fleetBookingParts, fleetDigestCount, fleetVehicleParts } from "./digest";

const DAY = "2026-11-23";
const byName = (F: FleetData, name: string) => buildFleetDigest(F, DAY).vehicles.find((v) => v.label.startsWith(name))!;

describe("buildFleetDigest", () => {
  it("lists every vehicle, in name order", () => {
    const F = seedFleetData(DAY);
    const d = buildFleetDigest(F, DAY);
    expect(d.vehicles).toHaveLength(F.vehicles.length);
    const names = d.vehicles.map((v) => v.label);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en", { numeric: true })));
  });

  it("a booked vehicle is OUT and shows only who has it", () => {
    const F = seedFleetData(DAY);
    const trip = F.trips.find((t) => t.vehicleId === "crv" && t.from <= DAY && DAY <= t.to)!;
    const G = { ...F, trips: F.trips.map((t) => (t === trip ? { ...t, label: "HULC", who: "Jane Doe" } : t)) };
    const crv = byName(G, "Honda CR-V");
    expect(crv).toMatchObject({ state: "out", due: [] });
    expect(crv.where).toBe(`HULC · Jane Doe, back ${"13 Dec"}`);
  });

  it("a vehicle at the workshop is OUT and shows only the workshop", () => {
    const h1 = byName(seedFleetData(DAY), "Hyundai H1 #1");
    expect(h1).toMatchObject({ state: "out", due: [], where: "At Motech (Bumper-to-bumper inspection)" });
  });

  it("marked In workshop with no visit booked: still OUT, since when", () => {
    const F = withVehicle(seedFleetData(DAY), "kombi", { status: "In workshop", statusSince: "2026-11-20", followUp: null });
    expect(byName(F, "VW Kombi")).toMatchObject({ state: "out", where: "At the workshop, since 20 Nov" });
  });

  it("an IN vehicle lists what's due, without its own name on every line", () => {
    const h3 = byName(seedFleetData(DAY), "Hyundai H1 #3");
    expect(h3.state).toBe("in");
    expect(h3.due).toContain("Weekly check due in 2 days");
    expect(h3.due).toContain("Licence disc expires in 7 days (30 Nov 2026)");
    expect(h3.due.join(" ")).not.toContain("KPH 387 NW");
    expect(h3.due.join(" ")).not.toContain("in-car guide");
  });

  it("faults or damage reported on an IN vehicle", () => {
    const F = seedFleetData(DAY);
    const ids = F.checklist.sections.flatMap((s) => s.items.map((i) => i.id)).slice(0, 3);
    const G = withVehicle(F, "kombi", { condition: { [ids[0]]: { s: "fix" }, [ids[1]]: { s: "fix" }, [ids[2]]: { s: "mon" } } as never });
    const due = byName(G, "VW Kombi").due;
    expect(due).toContain("2 faults or damage reported (Fix now)");
    expect(due).toContain("1 item to monitor");
  });

  it("For sale or Off the road: OFF, nothing else", () => {
    const F = withVehicle(seedFleetData(DAY), "kombi", { status: "Off the road" });
    expect(byName(F, "VW Kombi")).toMatchObject({ state: "off", where: "Off the road", due: [] });
  });

  it("a trip leaving today: OUT under Fleet, its pre-rental inspection under Bookings", () => {
    const F = seedFleetData(DAY);
    const G = { ...F, trips: [...F.trips, { id: "b1:h1-2", vehicleId: "h1-2", from: DAY, to: "2026-11-25", label: "Outreach", source: "hub" }] };
    const d = buildFleetDigest(G, DAY);
    expect(d.vehicles.find((v) => v.id === "h1-2")).toMatchObject({ state: "out", due: [] });
    expect(d.tripChecks.some((l) => l.includes("leaves today (Outreach") && l.includes("pre-rental inspection"))).toBe(true);
    expect(fleetBookingParts(d, "CAL").join("\n")).toContain("🔍 Pre- and post-rental inspections (");
  });

  it("clashes go under Bookings with a link to the Calendar", () => {
    const F = seedFleetData(DAY);
    const G = { ...F, trips: [...F.trips, { id: "b2:h1-1", vehicleId: "h1-1", from: "2026-11-22", to: "2026-11-24", label: "Camp", source: "hub" }] };
    const d = buildFleetDigest(G, DAY);
    expect(d.clashes.length).toBeGreaterThan(0);
    expect(fleetBookingParts(d, "https://x/cal")[0]).toMatch(/^\*⚠️ Clashes \(\d+\) – <https:\/\/x\/cal\|sort them out on the Calendar>\*/);
  });
});

describe("fleetVehicleParts", () => {
  it("one block per vehicle: IN with its lines or Nothing due, OUT with who has it", () => {
    const d = {
      clashes: [],
      tripChecks: [],
      vehicles: [
        { id: "a", label: "H1 #1 (A 1)", state: "in" as const, where: "", due: ["Weekly check due today"] },
        { id: "b", label: "H1 #2 (B <2>)", state: "in" as const, where: "", due: [] },
        { id: "c", label: "Kombi", state: "out" as const, where: "HULC · Jane Doe, back 21 Nov", due: [] },
      ],
    };
    expect(fleetVehicleParts(d)).toEqual([
      "🟢 *IN*  *H1 #1 (A 1)*\n• Weekly check due today",
      "🟢 *IN*  *H1 #2 (B &lt;2&gt;)*\nNothing due",
      "🔴 *OUT*  *Kombi*\nHULC · Jane Doe, back 21 Nov",
    ]);
    expect(fleetDigestCount(d)).toBe(1);
  });
});
