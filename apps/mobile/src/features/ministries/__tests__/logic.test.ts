import { makeMe } from "../../../../test/fixtures";
import { CAMS, KIDS, SOUND, detail, member, ministry } from "../__fixtures__/fixtures";
import {
  UNCATEGORIZED,
  detailContext,
  isUuid,
  listSections,
  memberA11yLabel,
  memberBadges,
  ministriesAccess,
  pendingMembers,
  rosterGroups,
  seesAllFromMe,
} from "../logic";

const role = (name: string) => ({ name, scopeType: null, scopeId: null });

describe("who may open Ministries (UX only)", () => {
  it("admins and Leadership Team are known from /api/me", () => {
    expect(seesAllFromMe(makeMe({ roles: [role("admin")] }))).toBe(true);
    expect(seesAllFromMe(makeMe({ roles: [role("super_admin")] }))).toBe(true);
    expect(seesAllFromMe(makeMe({ roles: [role("leadership_team")] }))).toBe(true);
    // A ministry_leader role alone doesn't open the web page: they must lead one.
    expect(seesAllFromMe(makeMe({ roles: [role("ministry_leader")] }))).toBe(false);
    expect(seesAllFromMe(null)).toBe(false);
  });

  it("combines /api/me with the probe", () => {
    const plain = makeMe({ roles: [role("staff")] });
    expect(ministriesAccess({ me: makeMe({ roles: [role("admin")] }), meLoading: false, probe: undefined })).toBe("allowed");
    expect(ministriesAccess({ me: plain, meLoading: false, probe: true })).toBe("allowed");
    expect(ministriesAccess({ me: plain, meLoading: false, probe: undefined })).toBe("checking");
    expect(ministriesAccess({ me: null, meLoading: true, probe: false })).toBe("checking");
    expect(ministriesAccess({ me: plain, meLoading: false, probe: false })).toBe("notAllowed");
    expect(ministriesAccess({ me: plain, meLoading: false, probe: null })).toBe("unknown");
  });
});

describe("list sections", () => {
  it("one plain list when every ministry is main", () => {
    const out = listSections([ministry(), ministry({ id: "b", name: "B" })]);
    expect(out.showHeadings).toBe(false);
    expect(out.sections).toHaveLength(1);
  });

  it("Main / Part-time headings once both exist, keeping server order", () => {
    const out = listSections([ministry({ id: KIDS, ministryType: "part_time" }), ministry({ id: "a" }), ministry({ id: "b" })]);
    expect(out.showHeadings).toBe(true);
    expect(out.sections.map((s) => [s.label, s.items.map((m) => m.id)])).toEqual([
      ["Main ministries", ["a", "b"]],
      ["Part-time ministries", [KIDS]],
    ]);
  });

  it("nothing at all → no sections", () => {
    expect(listSections([])).toEqual({ sections: [], showHeadings: false });
  });
});

describe("team groups", () => {
  it("no categories: one unlabelled group, point leader → leaders → staff, then A–Z", () => {
    const groups = rosterGroups(
      detail({
        roster: [
          member({ membershipId: "z", name: "Zed" }),
          member({ membershipId: "l", name: "Lee", role: "leader" }),
          member({ membershipId: "a", name: "amy" }),
          member({ membershipId: "p", name: "Pat", role: "leader", isPointLeader: true }),
        ],
      }),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("");
    expect(groups[0].rows.map((r) => r.membershipId)).toEqual(["p", "l", "a", "z"]);
  });

  it("categories in order (empty ones kept), someone in two shows twice, category lead ranks first there", () => {
    const groups = rosterGroups(
      detail({
        subcategories: [
          { id: CAMS, name: "Cameras" },
          { id: SOUND, name: "Sound" },
        ],
        roster: [
          member({ membershipId: "a", name: "Ann", categoryIds: [CAMS] }),
          member({ membershipId: "b", name: "Bo", categoryIds: [CAMS, SOUND], pointLeaderCategoryIds: [SOUND] }),
        ],
      }),
    );
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.membershipId)])).toEqual([
      ["Cameras", ["a", "b"]],
      ["Sound", ["b"]],
    ]);
  });

  it("Uncategorized trails when someone is in no category", () => {
    const groups = rosterGroups(
      detail({ subcategories: [{ id: CAMS, name: "Cameras" }], roster: [member({ membershipId: "x" })] }),
    );
    expect(groups.map((g) => [g.key, g.label, g.rows.length])).toEqual([
      [CAMS, "Cameras", 0],
      [UNCATEGORIZED, "Uncategorized", 1],
    ]);
  });
});

describe("badges and labels (words, never colour alone)", () => {
  it("in the web's order", () => {
    expect(memberBadges(member({ role: "leader", isPointLeader: true }), UNCATEGORIZED)).toEqual(["Ministry point leader"]);
    expect(memberBadges(member({ role: "leader", pointLeaderCategoryIds: [CAMS] }), CAMS)).toEqual(["Category point leader"]);
    // The category lead badge is scoped to the group it's shown under.
    expect(memberBadges(member({ role: "leader", pointLeaderCategoryIds: [CAMS] }), SOUND)).toEqual(["Leader"]);
    expect(memberBadges(member({ status: "pending" }), UNCATEGORIZED)).toEqual(["Pending"]);
    expect(memberBadges(member(), UNCATEGORIZED)).toEqual([]);
  });

  it("screen reader label: name, role words (Staff when none), email", () => {
    expect(memberA11yLabel(member(), UNCATEGORIZED)).toBe("Ann Lee. Staff. ann@example.org");
    expect(memberA11yLabel(member({ role: "leader", email: null }), UNCATEGORIZED)).toBe("Ann Lee. Leader");
  });
});

describe("pending, context, ids", () => {
  it("pending people once each", () => {
    const p = member({ membershipId: "p", status: "pending" });
    expect(pendingMembers([p, member(), p]).map((r) => r.membershipId)).toEqual(["p"]);
  });

  it("masthead context", () => {
    expect(detailContext(detail().ministry)).toBe("Main ministry");
    expect(detailContext({ ...detail().ministry, ministryType: "part_time", isActive: false })).toBe("Part-time ministry · Retired");
  });

  it("uuids only", () => {
    expect(isUuid(CAMS)).toBe(true);
    expect(isUuid("new")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
