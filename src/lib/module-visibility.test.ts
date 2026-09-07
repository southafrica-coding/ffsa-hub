import { describe, it, expect } from "vitest";
import { passesVisibilityGate, visibilityOf, type ModuleVisibilityMap } from "./module-visibility";
import { getAccessibleModules, moduleForPathname, type ModuleDefinition } from "@/config/modules";
import { LayoutDashboard } from "lucide-react";

const map = (entries: [string, "live" | "beta" | "hidden"][]): ModuleVisibilityMap =>
  new Map(entries);

const mod = (id: string, requiredRoles: string[] = ["super_admin", "admin"]): ModuleDefinition => ({
  id,
  label: id,
  href: `/${id}`,
  icon: LayoutDashboard,
  description: "",
  requiredRoles,
});

describe("visibilityOf", () => {
  it("defaults to live for an unknown module", () => {
    expect(visibilityOf("nope", map([]))).toBe("live");
  });
  it("defaults to live when there is no map at all (read failed)", () => {
    expect(visibilityOf("events", undefined)).toBe("live");
  });
});

describe("passesVisibilityGate", () => {
  const beta = map([["events", "beta"]]);
  const hidden = map([["events", "hidden"]]);

  it("lets a super admin into a beta module", () => {
    expect(passesVisibilityGate("events", ["super_admin"], beta)).toBe(true);
  });
  it("keeps a plain admin OUT of a beta module", () => {
    expect(passesVisibilityGate("events", ["admin"], beta)).toBe(false);
  });
  it("keeps everyone else out of a beta module", () => {
    expect(passesVisibilityGate("events", ["staff"], beta)).toBe(false);
    expect(passesVisibilityGate("events", [], beta)).toBe(false);
  });
  it("keeps even a super admin out of a hidden module", () => {
    expect(passesVisibilityGate("events", ["super_admin"], hidden)).toBe(false);
  });
  it("fails OPEN when the map is missing", () => {
    expect(passesVisibilityGate("events", [], undefined)).toBe(true);
  });
});

describe("getAccessibleModules", () => {
  it("hides a beta module from an admin who would otherwise see everything", () => {
    const mods = [mod("events"), mod("finance")];
    const out = getAccessibleModules(mods, ["admin"], undefined, map([["events", "beta"]]));
    expect(out.map((m) => m.id)).toEqual(["finance"]);
  });

  it("hides a beta module even when it is open to all authenticated users", () => {
    const mods = [mod("prayer-room", [])];
    const out = getAccessibleModules(mods, ["staff"], undefined, map([["prayer-room", "beta"]]));
    expect(out).toEqual([]);
  });

  it("still applies normal permissions to a live module", () => {
    const mods = [mod("events")];
    expect(getAccessibleModules(mods, ["staff"], new Set(), map([]))).toEqual([]);
    expect(
      getAccessibleModules(mods, ["staff"], new Set(["events"]), map([])).map((m) => m.id)
    ).toEqual(["events"]);
  });

  it("never hides the Modules control panel itself", () => {
    const mods = [mod("modules")];
    const out = getAccessibleModules(mods, ["super_admin"], undefined, map([["modules", "hidden"]]));
    expect(out.map((m) => m.id)).toEqual(["modules"]);
  });
});

describe("moduleForPathname", () => {
  it("matches a module and its sub-routes", () => {
    expect(moduleForPathname("/events")?.id).toBe("events");
    expect(moduleForPathname("/events/abc/tickets")?.id).toBe("events");
  });
  it("prefers the longest href so /settings/slack is not Settings", () => {
    expect(moduleForPathname("/settings/slack")?.id).toBe("slack");
    expect(moduleForPathname("/settings")?.id).toBe("settings");
  });
  it("does not let /e swallow /events-style neighbours", () => {
    expect(moduleForPathname("/finance")?.id).toBe("finance");
  });
  it("returns null for personal pages that are never gated", () => {
    expect(moduleForPathname("/profile")).toBeNull();
    expect(moduleForPathname("/my-finance")).toBeNull();
  });
});
