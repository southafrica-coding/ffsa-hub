import { describe, expect, it } from "vitest";
import {
  canMoveStatus,
  fillTemplate,
  furthestStatus,
  inServiceWindow,
  optChange,
  serviceWindowEndsAt,
  statusesThatCanBecome,
  templateComponents,
  templateValuesProblem,
  templateView,
  type GraphTemplate,
} from "./rules";

const NOW = new Date("2026-11-23T14:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const HOUR = 60 * 60 * 1000;

describe("24-hour window", () => {
  it("is open just inside 24 hours of their last message", () => {
    expect(inServiceWindow(ago(23 * HOUR + 59 * 60 * 1000), NOW)).toBe(true);
    expect(inServiceWindow(ago(1000), NOW)).toBe(true);
    expect(serviceWindowEndsAt(ago(2 * HOUR), NOW)).toBe(new Date(NOW.getTime() + 22 * HOUR).toISOString());
  });

  it("is closed at and after 24 hours", () => {
    expect(inServiceWindow(ago(24 * HOUR), NOW)).toBe(false);
    expect(inServiceWindow(ago(24 * HOUR + 1), NOW)).toBe(false);
    expect(serviceWindowEndsAt(ago(25 * HOUR), NOW)).toBeNull();
  });

  it("is closed when they've never written (our own messages don't open it)", () => {
    expect(inServiceWindow(null, NOW)).toBe(false);
    expect(inServiceWindow(undefined, NOW)).toBe(false);
    expect(inServiceWindow("not a date", NOW)).toBe(false);
  });
});

describe("statuses only move forward", () => {
  it("allows accepted → sent → delivered → read", () => {
    expect(canMoveStatus("pending", "accepted")).toBe(true);
    expect(canMoveStatus("accepted", "sent")).toBe(true);
    expect(canMoveStatus("sent", "delivered")).toBe(true);
    expect(canMoveStatus("delivered", "read")).toBe(true);
    expect(canMoveStatus("sent", "read")).toBe(true);
  });

  it("never moves back", () => {
    expect(canMoveStatus("read", "delivered")).toBe(false);
    expect(canMoveStatus("read", "sent")).toBe(false);
    expect(canMoveStatus("delivered", "sent")).toBe(false);
    expect(canMoveStatus("read", "read")).toBe(false);
  });

  it("failed replaces only a status that hasn't reached the phone, and is final", () => {
    expect(statusesThatCanBecome("failed")).toEqual(["pending", "accepted", "sent"]);
    expect(canMoveStatus("delivered", "failed")).toBe(false);
    expect(canMoveStatus("failed", "delivered")).toBe(false);
    expect(canMoveStatus("failed", "read")).toBe(false);
  });

  it("picks the furthest of several early statuses", () => {
    expect(furthestStatus(["delivered", "sent", "read"])).toBe("read");
    expect(furthestStatus(["sent", "failed"])).toBe("failed");
    expect(furthestStatus([])).toBeNull();
  });
});

describe("STOP and START", () => {
  it("treats STOP and UNSUBSCRIBE as opting out, in any case, with trailing punctuation", () => {
    for (const text of ["STOP", "stop", " Stop ", "stop.", "STOP!", "unsubscribe", "Unsubscribe."]) {
      expect(optChange(text), text).toBe("opt_out");
    }
  });

  it("treats START and YES as opting back in", () => {
    for (const text of ["START", "start", "Yes", "yes!"]) expect(optChange(text), text).toBe("opt_in");
  });

  it("ignores those words inside a sentence", () => {
    for (const text of ["please stop by on Sunday", "yes please, I'd love to", "Don't stop", "", null]) {
      expect(optChange(text), String(text)).toBeNull();
    }
  });
});

const hello: GraphTemplate = {
  name: "hello_name",
  language: "en",
  status: "APPROVED",
  category: "UTILITY",
  components: [{ type: "BODY", text: "Hi {{1}}, this is {{2}} from Missio. {{1}}, reply here any time." }, { type: "FOOTER", text: "Missio Potchefstroom" }],
};

describe("templates", () => {
  it("lists only approved templates, with their blanks in order", () => {
    const view = templateView(hello)!;
    expect(view.variables).toEqual([
      { part: "body", key: "1" },
      { part: "body", key: "2" },
    ]);
    expect(view.blockedReason).toBeNull();
    expect(templateView({ ...hello, status: "PENDING" })).toBeNull();
    expect(templateView({ ...hello, status: "REJECTED" })).toBeNull();
  });

  it("marks templates the Hub can't send yet", () => {
    const image = templateView({ ...hello, components: [{ type: "HEADER", format: "IMAGE" }, ...(hello.components ?? [])] })!;
    expect(image.blockedReason).toMatch(/picture/);
    const button = templateView({
      ...hello,
      components: [...(hello.components ?? []), { type: "BUTTONS", buttons: [{ type: "URL", url: "https://missio.example/{{1}}" }] }],
    })!;
    expect(button.blockedReason).toMatch(/button/);
  });

  it("needs every blank filled, on one line", () => {
    const view = templateView(hello)!;
    expect(templateValuesProblem(view, { "body:1": "Kea" })).toMatch(/every blank/);
    expect(templateValuesProblem(view, { "body:1": "Kea", "body:2": "Pastor\nSam" })).toMatch(/single line/);
    expect(templateValuesProblem(view, { "body:1": "Kea", "body:2": "Pastor Sam" })).toBeNull();
  });

  it("fills the preview and builds Graph components", () => {
    const view = templateView(hello)!;
    const values = { "body:1": " Kea ", "body:2": "Pastor Sam" };
    expect(fillTemplate(view, values)).toBe("Hi Kea, this is Pastor Sam from Missio. Kea, reply here any time.");
    expect(templateComponents(view, values)).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Kea" }, { type: "text", text: "Pastor Sam" }] },
    ]);
  });

  it("sends named variables by name", () => {
    const view = templateView({ ...hello, components: [{ type: "HEADER", format: "TEXT", text: "Hello {{first_name}}" }, { type: "BODY", text: "See you, {{first_name}}." }] })!;
    expect(templateComponents(view, { "header:first_name": "Kea", "body:first_name": "Kea" })).toEqual([
      { type: "header", parameters: [{ type: "text", text: "Kea", parameter_name: "first_name" }] },
      { type: "body", parameters: [{ type: "text", text: "Kea", parameter_name: "first_name" }] },
    ]);
  });
});
