import { beforeEach, describe, expect, it, vi } from "vitest";
import { advanceApplicationWhenReferencesComplete } from "./advance-reference-stage";
import { maybeNotifyReferencesComplete } from "./notify-references-complete";

const sendReferencesCompleteEmail = vi.hoisted(() => vi.fn());

vi.mock("@/lib/email/send-references-complete", () => ({
  sendReferencesCompleteEmail: (...args: unknown[]) => sendReferencesCompleteEmail(...args),
}));

type Slot = { id: string; is_required: boolean };
type RefRow = { slot_id: string; status: string };

function clientFor(slots: Slot[], refs: RefRow[]) {
  const app = {
    id: "app-1",
    program_id: "sbi",
    status: "submitted",
    applicant_email: "applicant@example.com",
    applicant_info: { first_name: "Maggie", last_name: "Dee" },
    users: null,
    assigned_staff: {
      email: "staff@example.com",
      first_name: "Sam",
      last_name: "Lee",
    },
    programs: { name: "SBI" },
  };

  function builder(table: string) {
    const api = {
      select() {
        return api;
      },
      eq() {
        return api;
      },
      in() {
        return Promise.resolve({ data: [{ id: app.id }], error: null });
      },
      update() {
        return api;
      },
      maybeSingle: async () => ({ data: { id: app.id, program_id: app.program_id, status: app.status }, error: null }),
      single: async () => ({ data: app, error: null }),
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) {
        const data =
          table === "reference_slots" ? slots : table === "reference_requests" ? refs : null;
        return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
      },
    };
    return api;
  }

  return { from: builder };
}

const requiredSlots: Slot[] = [
  { id: "friend", is_required: true },
  { id: "leader", is_required: true },
];

async function bothPaths(slots: Slot[], refs: RefRow[]) {
  const db = clientFor(slots, refs);
  const advanced = await advanceApplicationWhenReferencesComplete(db, "app-1");
  await maybeNotifyReferencesComplete(db, "app-1");
  return {
    advanced: advanced.advanced,
    emailed: sendReferencesCompleteEmail.mock.calls.length > 0,
  };
}

describe("reference completion agrees for the stage write and the staff email", () => {
  beforeEach(() => {
    sendReferencesCompleteEmail.mockReset();
  });

  it("does not advance or email when a required slot has no request row", async () => {
    // The old email query only looked at existing request rows, so this
    // case used to count as complete. Both paths now say it is not.
    await expect(
      bothPaths(requiredSlots, [{ slot_id: "friend", status: "submitted" }])
    ).resolves.toEqual({ advanced: false, emailed: false });
  });

  it("advances and emails when every required slot is submitted", async () => {
    await expect(
      bothPaths(requiredSlots, [
        { slot_id: "friend", status: "submitted" },
        { slot_id: "leader", status: "submitted" },
      ])
    ).resolves.toEqual({ advanced: true, emailed: true });
  });

  it("does not let an optional pending reference block either path", async () => {
    await expect(
      bothPaths(
        [...requiredSlots, { id: "optional", is_required: false }],
        [
          { slot_id: "friend", status: "submitted" },
          { slot_id: "leader", status: "submitted" },
          { slot_id: "optional", status: "pending" },
        ]
      )
    ).resolves.toEqual({ advanced: true, emailed: true });
  });

  it("does not advance or email while a required request is still pending", async () => {
    await expect(
      bothPaths(requiredSlots, [
        { slot_id: "friend", status: "submitted" },
        { slot_id: "leader", status: "pending" },
      ])
    ).resolves.toEqual({ advanced: false, emailed: false });
  });
});
