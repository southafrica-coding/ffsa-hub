import { describe, expect, it } from "vitest";
import { GUIDE, tutorialSteps } from "@/lib/fleet/guide";
import { PENDING, guideHref, guidePageHref } from "./links";

const F = "/bookings/vehicles/fleet";
const tk = { v: "h1-1" };

describe("guideHref", () => {
  it("maps the app's hash links to Hub routes", () => {
    expect(guideHref("#v-{v}", tk)).toBe(`${F}/h1-1`);
    expect(guideHref("#v-crv", tk)).toBe(`${F}/crv`);
    expect(guideHref("#workshops", tk)).toBe(`${F}/workshops`);
    expect(guideHref("#checklist", tk)).toBe(`${F}/checklist`);
    expect(guideHref("#guide", tk)).toBe(`${F}/guide`);
    expect(guideHref("#guide-tutorial", tk)).toBe(`${F}/guide?page=tutorial`);
    expect(guideHref("#inspect-crv", tk)).toBe(`${F}/crv/inspect`);
    expect(guideHref("#i-abc", tk)).toBe(`${F}/inspections/abc`);
  });

  it("maps guide-hub.json's screen keys", () => {
    expect(guideHref("vehicle", tk)).toBe(`${F}/h1-1`);
    expect(guideHref("vehicles", tk)).toBe(`${F}/vehicles`);
    expect(guideHref("checklist", tk)).toBe(`${F}/checklist`);
  });

  it("sends Today and Schedule to their screens, and Calendar to the booking board (one calendar, Fleet 5d)", () => {
    for (const k of ["today", "#today"]) expect(guideHref(k, tk)).toBe(F);
    for (const k of ["calendar", "#calendar"]) expect(guideHref(k, tk)).toBe("/bookings/vehicles/board");
    for (const k of ["schedule", "#schedule"]) expect(guideHref(k, tk)).toBe(`${F}/schedule`);
    expect(Object.keys(PENDING).sort()).toEqual(["calendar", "schedule", "today"]);
  });

  it("gives no link when there's nowhere to go", () => {
    expect(guideHref("", tk)).toBeNull();
    expect(guideHref(undefined, tk)).toBeNull();
    expect(guideHref("#v-{v}", { v: "" })).toBeNull();
    expect(guideHref("vehicle", { v: "" })).toBeNull();
    expect(guideHref("#ask", tk)).toBeNull();
    expect(guideHref("#nowhere", tk)).toBeNull();
  });

  it("every link in the Hub Guide's tutorial resolves", () => {
    for (const [title, , link] of tutorialSteps()) if (link) expect(guideHref(link, tk), title).not.toBeNull();
  });

  it("links to Guide pages", () => {
    expect(guidePageHref()).toBe(`${F}/guide`);
    for (const p of GUIDE.pages) expect(guidePageHref(p.id)).toBe(`${F}/guide?page=${p.id}`);
  });
});
