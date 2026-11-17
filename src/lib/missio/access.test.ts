import { describe, expect, it } from "vitest";
import { getOrgSlugFromPath } from "./access";

describe("getOrgSlugFromPath", () => {
  it("reads missio from a Missio path", () => {
    expect(getOrgSlugFromPath("/missio")).toBe("missio");
    expect(getOrgSlugFromPath("/missio/")).toBe("missio");
    expect(getOrgSlugFromPath("/missio/people")).toBe("missio");
    expect(getOrgSlugFromPath("/missio/people?campus=potch")).toBe("missio");
  });

  it("reads the other seeded org slug", () => {
    expect(getOrgSlugFromPath("/ffsa")).toBe("ffsa");
    expect(getOrgSlugFromPath("/ffsa/staff")).toBe("ffsa");
  });

  it("returns null for anything that is not a known org slug", () => {
    expect(getOrgSlugFromPath("/")).toBeNull();
    expect(getOrgSlugFromPath("")).toBeNull();
    expect(getOrgSlugFromPath("/dashboard")).toBeNull();
    expect(getOrgSlugFromPath("/api/missio")).toBeNull();
    expect(getOrgSlugFromPath("/api/missio/people")).toBeNull();
    expect(getOrgSlugFromPath("/missioextra")).toBeNull();
    expect(getOrgSlugFromPath("/Missio")).toBeNull();
    expect(getOrgSlugFromPath("/mission")).toBeNull();
  });
});
