import { describe, expect, it } from "vitest";
import { candidateContext, houseTitle, peopleCount, reviewReasons, sortHouses, sortMembers } from "./format";

describe("house church formatting", () => {
  it("uses House N when the name is missing", () => {
    expect(houseTitle({ number: 4, name: null })).toBe("House 4");
    expect(houseTitle({ number: 4, name: "  " })).toBe("House 4");
    expect(houseTitle({ number: 2, name: "Oak Table" })).toBe("Oak Table");
  });

  it("counts one person differently from many", () => {
    expect(peopleCount(1)).toBe("1 person");
    expect(peopleCount(6)).toBe("6 people");
  });

  it("orders houses by number and members by role, then name", () => {
    expect(sortHouses([{ number: 3 }, { number: 1 }, { number: 2 }]).map((house) => house.number)).toEqual([1, 2, 3]);
    const members = sortMembers([
      { role: "member" as const, displayName: "Jonah Feldman" },
      { role: "co_leader" as const, displayName: "Lindiwe Nkosi" },
      { role: "leader" as const, displayName: "Theo Martins" },
      { role: "member" as const, displayName: "Amina Kruger" },
    ]);
    expect(members.map((member) => member.displayName)).toEqual([
      "Theo Martins",
      "Lindiwe Nkosi",
      "Amina Kruger",
      "Jonah Feldman",
    ]);
  });

  it("mentions the people list only when the contact is already a Missio person", () => {
    expect(
      candidateContext({
        contactId: "c",
        displayName: "Peter Adler",
        firstName: "Peter",
        lastName: "Adler",
        orgPersonId: "p",
      })
    ).toBe("In the people list");
    expect(
      candidateContext({ contactId: "c", displayName: "Jonah Feldman", firstName: "Jonah", lastName: "Feldman" })
    ).toBeNull();
  });

  it("says a family label is not one person, once", () => {
    expect(reviewReasons({ kind: "family_label", matchType: "family_label" })).toEqual(["Family name, not one person"]);
    expect(reviewReasons({ kind: "family_label", matchType: "none" })).toEqual([
      "Family name, not one person",
      "No match found",
    ]);
    expect(reviewReasons({ kind: "person", matchType: "multiple" })).toEqual(["Several possible matches"]);
    expect(reviewReasons({ kind: "person", matchType: "first_only" })).toEqual(["First name only"]);
    expect(reviewReasons({ kind: "person", matchType: "partial" })).toEqual(["Partial name"]);
  });
});
