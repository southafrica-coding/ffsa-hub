import { describe, expect, it } from "vitest";
import { canEditSongwritingRecord, SONGWRITING_EDIT_RULE, type SongwritingRecord, type SongwritingViewer } from "./access";

const ME = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

const member: SongwritingViewer = { userId: ME, canAccess: true, isAdmin: false, isLeader: false };
const leader: SongwritingViewer = { ...member, isLeader: true };
const admin: SongwritingViewer = { ...member, isAdmin: true };
const outsider: SongwritingViewer = { ...member, canAccess: false };
const outsideAdminFlag: SongwritingViewer = { ...member, canAccess: false, isAdmin: true };

const theirs: SongwritingRecord[] = [
  { kind: "nation" },
  { kind: "training", created_by: OTHER },
  { kind: "training", created_by: null },
  { kind: "lead", created_by: OTHER },
  { kind: "lead", created_by: null },
];
const mine: SongwritingRecord[] = [
  { kind: "training", created_by: ME },
  { kind: "lead", created_by: ME },
];

describe("canEditSongwritingRecord — current rule (what 417/424 RLS allows)", () => {
  it("is the rule in force", () => {
    expect(SONGWRITING_EDIT_RULE).toBe("rls");
  });

  it("lets any active P&W member or admin edit or delete nations, trainings and leads, whoever made them", () => {
    for (const viewer of [member, leader, admin]) {
      for (const record of [...theirs, ...mine]) expect(canEditSongwritingRecord(viewer, record)).toBe(true);
    }
  });

  it("refuses anyone without songwriting access, admin flag or not", () => {
    for (const viewer of [outsider, outsideAdminFlag]) {
      for (const record of [...theirs, ...mine, { kind: "lead_event" as const, by: ME }]) expect(canEditSongwritingRecord(viewer, record)).toBe(false);
    }
  });

  it("logged contacts: only the person who logged it, or an admin (424 pw_can_delete_lead_event)", () => {
    expect(canEditSongwritingRecord(member, { kind: "lead_event", by: ME })).toBe(true);
    expect(canEditSongwritingRecord(member, { kind: "lead_event", by: OTHER })).toBe(false);
    expect(canEditSongwritingRecord(member, { kind: "lead_event", by: null })).toBe(false);
    expect(canEditSongwritingRecord(leader, { kind: "lead_event", by: OTHER })).toBe(false);
    expect(canEditSongwritingRecord(admin, { kind: "lead_event", by: OTHER })).toBe(true);
  });
});

// PLACEHOLDER — the narrowed rule Jack is deciding on (creator, department
// leaders and admins). Not in force: SONGWRITING_EDIT_RULE is still "rls".
// When Jack decides, flip SONGWRITING_EDIT_RULE, move these expectations
// into the block above, and add a migration if RLS should narrow too.
describe("canEditSongwritingRecord — PLACEHOLDER narrowed rule (creator_leaders_admins), not in force", () => {
  const narrowed = "creator_leaders_admins" as const;

  it("lets the creator edit their own trainings and leads", () => {
    for (const record of mine) expect(canEditSongwritingRecord(member, record, narrowed)).toBe(true);
  });

  it("refuses a plain member on someone else's (or an unowned) record; nations have no creator", () => {
    for (const record of theirs) expect(canEditSongwritingRecord(member, record, narrowed)).toBe(false);
  });

  it("lets department leaders and admins edit everything", () => {
    for (const viewer of [leader, admin]) {
      for (const record of [...theirs, ...mine]) expect(canEditSongwritingRecord(viewer, record, narrowed)).toBe(true);
    }
  });

  it("leaves the logged-contact rule as 424 has it", () => {
    expect(canEditSongwritingRecord(leader, { kind: "lead_event", by: OTHER }, narrowed)).toBe(false);
    expect(canEditSongwritingRecord(member, { kind: "lead_event", by: ME }, narrowed)).toBe(true);
  });

  it.todo("narrow 424's RLS to match (Hub Data), once Jack decides");
});
