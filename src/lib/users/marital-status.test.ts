import { describe, expect, it } from "vitest";
import {
  addableRelationships,
  canHaveSpouse,
  familyGatePlan,
  familyQuestionsFor,
  householdRelationshipError,
  normalizeMaritalStatus,
} from "./marital-status";

// Marital status decides which family questions apply — in the onboarding
// wizard, the staff family gate, the profile household editor and the
// household API. These pin the rule so the screens and server can't drift.

describe("normalizeMaritalStatus", () => {
  it("accepts the four listed values, case- and space-insensitively", () => {
    expect(normalizeMaritalStatus("single")).toBe("single");
    expect(normalizeMaritalStatus(" Married ")).toBe("married");
    expect(normalizeMaritalStatus("DIVORCED")).toBe("divorced");
    expect(normalizeMaritalStatus("widowed")).toBe("widowed");
  });

  it("returns null for blank or off-list values", () => {
    expect(normalizeMaritalStatus("")).toBeNull();
    expect(normalizeMaritalStatus(null)).toBeNull();
    expect(normalizeMaritalStatus(undefined)).toBeNull();
    expect(normalizeMaritalStatus("engaged")).toBeNull();
    expect(normalizeMaritalStatus(1)).toBeNull();
  });
});

describe("familyQuestionsFor", () => {
  it("asks a married person about a spouse and children", () => {
    expect(familyQuestionsFor("married")).toEqual({ spouse: true, children: true });
  });

  it("asks a single person about children but never a spouse (single parents)", () => {
    expect(familyQuestionsFor("single")).toEqual({ spouse: false, children: true });
  });

  it("asks divorced and widowed people about children only", () => {
    expect(familyQuestionsFor("divorced")).toEqual({ spouse: false, children: true });
    expect(familyQuestionsFor("widowed")).toEqual({ spouse: false, children: true });
  });

  it("keeps the old behaviour (ask both) when the status is unknown", () => {
    expect(familyQuestionsFor(null)).toEqual({ spouse: true, children: true });
    expect(familyQuestionsFor("")).toEqual({ spouse: true, children: true });
  });
});

describe("addableRelationships", () => {
  it("offers the add buttons that fit the status", () => {
    expect(addableRelationships("married")).toEqual(["spouse", "child"]);
    expect(addableRelationships("divorced")).toEqual(["child"]);
    expect(addableRelationships("widowed")).toEqual(["child"]);
    expect(addableRelationships("single")).toEqual(["child"]);
  });
});

describe("canHaveSpouse / householdRelationshipError (server rule)", () => {
  it("only a married (or unknown) status may store a spouse", () => {
    expect(canHaveSpouse("married")).toBe(true);
    expect(canHaveSpouse(null)).toBe(true);
    expect(canHaveSpouse("single")).toBe(false);
    expect(canHaveSpouse("divorced")).toBe(false);
    expect(canHaveSpouse("widowed")).toBe(false);
  });

  it("refuses spouse data for a single person with a readable message", () => {
    const err = householdRelationshipError("spouse", "single");
    expect(err).toMatch(/single/);
    expect(err).toMatch(/spouse can't be added/);
  });

  it("refuses spouse data for divorced and widowed people", () => {
    expect(householdRelationshipError("spouse", "divorced")).not.toBeNull();
    expect(householdRelationshipError("spouse", "widowed")).not.toBeNull();
  });

  it("accepts a spouse for a married person", () => {
    expect(householdRelationshipError("spouse", "married")).toBeNull();
  });

  it("always accepts children and dependents, including for a single parent", () => {
    for (const status of ["single", "married", "divorced", "widowed", null]) {
      expect(householdRelationshipError("child", status)).toBeNull();
      expect(householdRelationshipError("dependent", status)).toBeNull();
    }
  });

  it("ignores writes that don't set a relationship (partial updates)", () => {
    expect(householdRelationshipError(undefined, "single")).toBeNull();
  });
});

describe("familyGatePlan (staff family gate)", () => {
  it("asks a single person about children, never a spouse", () => {
    expect(familyGatePlan("single", null)).toEqual({ askSpouse: false, askChildren: true });
    expect(familyGatePlan("single", false)).toEqual({ askSpouse: false, askChildren: true });
    expect(familyGatePlan("single", true)).toEqual({ askSpouse: false, askChildren: true });
  });

  it("asks divorced / widowed people about children but not a spouse", () => {
    expect(familyGatePlan("divorced", null)).toEqual({ askSpouse: false, askChildren: true });
    expect(familyGatePlan("widowed", null)).toEqual({ askSpouse: false, askChildren: true });
  });

  it("asks a married person both", () => {
    expect(familyGatePlan("married", null)).toEqual({ askSpouse: true, askChildren: true });
  });
});
