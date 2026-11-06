import { makeMe } from "../../../../test/fixtures";
import { detail, noDecision, school, student, yesDecision } from "../__fixtures__/fixtures";
import { staffDecisionsAccess } from "../access";
import {
  canMakeStaff,
  decidedLine,
  decisionProblem,
  decisionWord,
  departmentLabel,
  formatDecidedDate,
  isUuid,
  needsDecisionCount,
  offerMakeStaffAfterSave,
  rowA11yLabel,
  schoolA11yLabel,
} from "../logic";
import { strings } from "../strings";

const role = (name: string) => ({ name, scopeType: null, scopeId: null });

describe("who sees Staff decisions (role-only, like the web's ROLE_ONLY_MODULES)", () => {
  it("leadership_team: allowed", () => {
    expect(staffDecisionsAccess(makeMe({ roles: [role("staff"), role("leadership_team")] }), "ready")).toBe("allowed");
  });

  it("admin and super_admin alone: not allowed", () => {
    expect(staffDecisionsAccess(makeMe({ roles: [role("admin")] }), "ready")).toBe("notAllowed");
    expect(staffDecisionsAccess(makeMe({ roles: [role("super_admin")] }), "ready")).toBe("notAllowed");
    expect(staffDecisionsAccess(makeMe({ roles: [role("staff")] }), "ready")).toBe("notAllowed");
  });

  it("still loading: checking; /api/me unreadable: unknown (the server decides)", () => {
    expect(staffDecisionsAccess(null, "loading")).toBe("checking");
    expect(staffDecisionsAccess(null, "error")).toBe("unknown");
  });
});

describe("decision rules", () => {
  it("a no needs a note; a yes doesn't; nothing chosen can't be saved", () => {
    expect(decisionProblem(null, "")).toBe(strings.sheet.chooseFirst);
    expect(decisionProblem(false, "")).toBe(strings.sheet.noteRequired);
    expect(decisionProblem(false, "   ")).toBe(strings.sheet.noteRequired);
    expect(decisionProblem(false, "Not this year")).toBeNull();
    expect(decisionProblem(true, "")).toBeNull();
  });

  it("Make staff: only for a yes, with a Hub account, not staff yet", () => {
    expect(canMakeStaff(student({ decision: yesDecision }))).toBe(true);
    expect(canMakeStaff(student({ decision: noDecision }))).toBe(false);
    expect(canMakeStaff(student({ decision: null }))).toBe(false);
    expect(canMakeStaff(student({ decision: yesDecision, userId: null }))).toBe(false);
    expect(canMakeStaff(student({ decision: yesDecision, isStaff: true }))).toBe(false);
  });

  it("after saving, the make-staff step follows a yes for someone who can be made staff", () => {
    expect(offerMakeStaffAfterSave(student(), true)).toBe(true);
    expect(offerMakeStaffAfterSave(student(), false)).toBe(false);
    expect(offerMakeStaffAfterSave(student({ isStaff: true }), true)).toBe(false);
    expect(offerMakeStaffAfterSave(student({ userId: null }), true)).toBe(false);
  });
});

describe("words and counts", () => {
  it("the decision is always in words, with a tone that only helps", () => {
    expect(decisionWord(student({ decision: yesDecision }))).toEqual({ label: "Accepted: yes", tone: "positive" });
    expect(decisionWord(student({ decision: noDecision }))).toEqual({ label: "Accepted: no", tone: "attention" });
    expect(decisionWord(student())).toEqual({ label: "Not decided", tone: "default" });
  });

  it("dates like the web ('1 Oct 2026'), with who decided", () => {
    expect(formatDecidedDate("2026-10-01T10:00:00Z")).toBe("1 Oct 2026");
    expect(formatDecidedDate("nope")).toBe("");
    expect(decidedLine(student({ decision: yesDecision }))).toBe("Decided 1 Oct 2026 by Lee Team");
    expect(decidedLine(student({ decision: { ...yesDecision, decidedByName: null } }))).toBe("Decided 1 Oct 2026");
    expect(decidedLine(student())).toBeNull();
  });

  it("the band counts undecided students, but never on an archived school", () => {
    expect(needsDecisionCount(detail())).toBe(1);
    expect(needsDecisionCount(detail({ school: school({ archived: true }) }))).toBe(0);
    expect(needsDecisionCount(detail({ rows: [] }))).toBe(0);
  });

  it("department labels fall back to the stored value", () => {
    const opts = detail().departmentOptions;
    expect(departmentLabel(opts, "media")).toBe("Media");
    expect(departmentLabel(opts, "gone")).toBe("gone");
    expect(departmentLabel(opts, null)).toBeNull();
  });

  it("screen-reader sentences", () => {
    expect(schoolA11yLabel(school({ archived: true, total: 1, yes: 0, no: 0, undecided: 1 }))).toBe(
      "Leadership Track 2026. Archived. 1 student. 0 yes, 0 no, 1 undecided",
    );
    expect(rowA11yLabel(student({ isStaff: true, decision: noDecision }))).toBe(
      "Ann Bell. ann@example.org. Staff. Accepted: no. Note: Not this year. Decided 2 Oct 2026 by Lee Team",
    );
  });

  it("only uuids open a school", () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isUuid("x")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
