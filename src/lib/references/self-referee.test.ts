import { describe, expect, it } from "vitest";
import {
  SELF_REFEREE_MESSAGE,
  isSelfReferee,
  selfRefereeError,
} from "./self-referee";

describe("isSelfReferee", () => {
  it("matches after trim and lowercase", () => {
    expect(isSelfReferee("  Ada@Example.com ", ["ada@example.com"])).toBe(true);
    expect(isSelfReferee("ada@example.com", ["  Ada@Example.com "])).toBe(true);
  });

  it("matches any applicant email", () => {
    expect(
      isSelfReferee("auth@example.com", [
        "applicant@example.com",
        null,
        "  ",
        "auth@example.com",
      ])
    ).toBe(true);
  });

  it("does not strip plus-tags or other local-part characters", () => {
    expect(isSelfReferee("ada+ref@example.com", ["ada@example.com"])).toBe(false);
    expect(isSelfReferee("ada@example.com", ["ada+ref@example.com"])).toBe(false);
    expect(isSelfReferee("a.da@example.com", ["ada@example.com"])).toBe(false);
    expect(isSelfReferee(" Ada+Ref@Example.com ", ["ada+ref@example.com"])).toBe(true);
  });

  it("does not treat a blank referee or blank applicant as a match", () => {
    expect(isSelfReferee("", ["ada@example.com"])).toBe(false);
    expect(isSelfReferee("   ", ["ada@example.com"])).toBe(false);
    expect(isSelfReferee("ada@example.com", ["", null, undefined, "  "])).toBe(false);
    expect(isSelfReferee(undefined, ["ada@example.com"])).toBe(false);
  });
});

describe("selfRefereeError", () => {
  const slots = [
    { id: "slot-1", label: "Pastoral Reference" },
    { id: "slot-2", label: "Friend" },
  ];

  it("uses the plain message for a single referee", () => {
    expect(
      selfRefereeError(
        [{ slot_id: "slot-1", referee_name: "Ada", referee_email: "ADA@example.com" }],
        ["ada@example.com"],
        slots
      )
    ).toBe(SELF_REFEREE_MESSAGE);
  });

  it("names every self-referee entry when more than one referee is submitted", () => {
    const message = selfRefereeError(
      [
        { slot_id: "slot-1", referee_name: "Pastor", referee_email: "pastor@example.com" },
        { slot_id: "slot-2", referee_name: "Ada", referee_email: " ada@example.com " },
      ],
      ["ada@example.com"],
      slots
    );
    expect(message).toContain("Friend");
    expect(message).toContain(SELF_REFEREE_MESSAGE);
    expect(message).not.toContain("Pastoral Reference");
  });

  it("returns null for a different email", () => {
    expect(
      selfRefereeError(
        [{ slot_id: "slot-1", referee_email: "pastor@example.com" }],
        ["ada@example.com"],
        slots
      )
    ).toBeNull();
  });
});
