import { describe, expect, it } from "vitest";
import { addIsoDays, saTodayIso } from "@/lib/departments/quarter";
import { selectRocksDue } from "./dashboard";
import { ROCKS } from "./mocks";

describe("home dashboard fixtures", () => {
  it("reads today in Africa/Johannesburg", () => {
    expect(saTodayIso(new Date("2026-11-10T21:30:00Z"))).toBe("2026-11-10");
    expect(saTodayIso(new Date("2026-11-10T22:30:00Z"))).toBe("2026-11-11");
    expect(addIsoDays("2026-11-10", 14)).toBe("2026-11-24");
  });

  it("includes overdue and soon rocks from the fixture, and skips done or other ministries", () => {
    const slugs = new Set(["prayer_and_worship", "missio_ministry"]);
    expect(selectRocksDue(ROCKS, slugs, "2026-11-10").map((rock) => rock.id)).toEqual([
      "pw-rota",
      "mc-rota",
      "pw-coverage",
    ]);
    expect(selectRocksDue(ROCKS, slugs, "2026-11-10").some((rock) => rock.status === "done")).toBe(false);
  });
});
