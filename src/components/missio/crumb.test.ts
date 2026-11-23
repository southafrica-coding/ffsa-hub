import { describe, expect, it } from "vitest";
import { missioCrumbLabel } from "./crumb";

describe("Missio breadcrumb", () => {
  it("maps each route to its section, including nested pages", () => {
    expect(missioCrumbLabel("/missio")).toBe("Home");
    expect(missioCrumbLabel("/missio/people")).toBe("People");
    expect(missioCrumbLabel("/missio/people/person-theo")).toBe("People");
    expect(missioCrumbLabel("/missio/house-churches")).toBe("House churches");
    expect(missioCrumbLabel("/missio/house-churches/house-2")).toBe("House churches");
    expect(missioCrumbLabel("/missio/house-churches/review")).toBe("House churches");
    expect(missioCrumbLabel("/missio/follow-up")).toBe("Follow-up");
    expect(missioCrumbLabel("/missio/follow-up/r_1")).toBe("Follow-up");
    expect(missioCrumbLabel("/missio/follow-up?stage=joined")).toBe("Follow-up");
    expect(missioCrumbLabel("/missio/volunteers")).toBe("Volunteers");
    expect(missioCrumbLabel("/serve/missio/preview/pastor")).toBe("Volunteers");
    expect(missioCrumbLabel("/dashboard")).toBe("Home");
  });
});
