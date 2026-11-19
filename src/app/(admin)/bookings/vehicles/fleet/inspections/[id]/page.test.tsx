// The inspection detail page renders a saved inspection: facts, issues (Fix now first),
// all results by section, and Delete only for people who manage Fleet.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { seedFleetData } from "@/lib/fleet/testing/seed";

const TODAY = "2026-11-17";
const F = seedFleetData(TODAY);
const ID = "00000000-0000-0000-0000-0000000000aa";
let canManage = true;
let row: Record<string, unknown> | null = null;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/fleet/load", () => ({
  requireFleet: async () => ({ user: { id: "u1" }, access: { canView: true, canManage } }),
  loadFleet: async () => ({ F, vehicleRows: [], providers: [], coordinator: null }),
}));
vi.mock("@/services/fleet", () => ({ getFleetInspection: async () => ({ data: row, error: null }) }));

async function html() {
  const { default: Page } = await import("./page");
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id: ID }) }));
}

describe("inspection detail", () => {
  it("shows the inspection", async () => {
    row = {
      id: ID,
      vehicle_id: "h1-2",
      type: "weekly",
      date: TODAY,
      odometer_km: 225100,
      fuel: "½",
      inspector: "Jack",
      results: {
        "eng-oil": { s: "mon", v: "", n: "A bit low", p: [], t: "Engine oil level", sec: "Engine" },
        "tyr-fl": { s: "fix", v: "1.2", n: "", p: [], t: "Tread depth: front left", sec: "Tyres & wheels" },
        "ext-front": { s: "ok", v: "", n: "", p: [], t: "Front", sec: "Body" },
      },
      walk: { front: "a".repeat(32) },
      extra: [],
      docs: [],
      counts: { ok: 1, mon: 1, fix: 1, na: 0 },
      mins: 17,
      summary: "Book tyres.",
      created_at: "2026-11-17T08:00:00Z",
    };
    const h = await html();
    expect(h).toContain("Weekly check · 17 Nov 2026");
    expect(h).toContain("225 100 km");
    expect(h).toContain("17 min");
    expect(h).toContain("3 of ");
    expect(h).toContain("Book tyres.");
    expect(h).toContain("Copy report text");
    expect(h).toContain(">Delete<");
    expect(h).toContain("/api/vehicles/fleet/files/" + "a".repeat(32));
    expect(h.indexOf("Tread depth: front left")).toBeLessThan(h.indexOf("Engine oil level"));
    expect(h).toContain("1.2 mm");
  });

  it("hides Delete from people who only view, and says when it's gone", async () => {
    canManage = false;
    expect(await html()).not.toContain(">Delete<");
    row = null;
    expect(await html()).toContain("Inspection not found");
  });
});
