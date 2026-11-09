import { beforeEach, describe, expect, it, vi } from "vitest";

// The acceptance email for applicants who already have an account — the path
// that used to send nothing (pre-linked applicants, Applicants-list "accepted")
// or ignore a failed send (existing-account match).

const sends = vi.hoisted(() => ({
  calls: [] as Array<{ to: string; subject: string; category: string; sourceId?: string | null }>,
  result: { ok: true, id: "msg_1" } as
    | { ok: true; id: string | null }
    | { ok: false; error: string; suppressed: boolean },
}));

vi.mock("@/lib/email/send-transactional", () => ({
  sendTransactional: vi.fn(async (input: { to: string; subject: string; category: string; sourceId?: string | null }) => {
    sends.calls.push(input);
    return sends.result;
  }),
}));

import {
  acceptanceEmailWarning,
  buildEnrollmentConfirmation,
  escapeIlike,
  sendAcceptanceToLinkedAccount,
} from "./acceptance-email";

type Tables = Record<string, Array<Record<string, unknown>>>;

/** Minimal admin client: select(...).eq(col, val).maybeSingle() over in-memory rows. */
function fakeAdmin(tables: Tables) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          return q;
        },
        maybeSingle: async () => ({
          data: (tables[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null,
          error: null,
        }),
      };
      return q;
    },
  };
}

const program = {
  name: "Fire & Fragrance SA Experience 2027",
  acceptance_email_subject: null,
  acceptance_email_body: null,
};

beforeEach(() => {
  sends.calls = [];
  sends.result = { ok: true, id: "msg_1" };
});

describe("escapeIlike", () => {
  it("escapes LIKE wildcards so underscores in addresses match literally", () => {
    expect(escapeIlike("first_last@x.com")).toBe("first\\_last@x.com");
    expect(escapeIlike("100%@x.com")).toBe("100\\%@x.com");
    expect(escapeIlike("plain@x.com")).toBe("plain@x.com");
  });
});

describe("acceptanceEmailWarning", () => {
  it("is null when the send went out", () => {
    expect(acceptanceEmailWarning({ ok: true, id: "x" }, "a@x.com")).toBeNull();
  });
  it("names the suppression list when the address bounced before", () => {
    expect(
      acceptanceEmailWarning({ ok: false, error: "suppressed", suppressed: true }, "a@x.com")
    ).toMatch(/a@x\.com is on the email suppression list/);
  });
  it("passes the provider error through", () => {
    expect(
      acceptanceEmailWarning({ ok: false, error: "Invalid `to` field", suppressed: false }, "a@x.com")
    ).toMatch(/failed to send: Invalid `to` field/);
  });
  it("warns when there is no address at all", () => {
    expect(acceptanceEmailWarning(null, null)).toMatch(/No email address/);
  });
});

describe("buildEnrollmentConfirmation", () => {
  it("uses the default subject when the school has no custom copy", () => {
    const { subject, html } = buildEnrollmentConfirmation(program, "Sam", "https://hub.test");
    expect(subject).toBe("You're enrolled in Fire & Fragrance SA Experience 2027");
    expect(html).toContain("https://hub.test/my-schools");
  });
  it("fills the school's custom subject placeholders", () => {
    const { subject } = buildEnrollmentConfirmation(
      { ...program, acceptance_email_subject: "Welcome {{first_name}} to {{program_name}}" },
      "Sam",
      "https://hub.test"
    );
    expect(subject).toBe("Welcome Sam to Fire & Fragrance SA Experience 2027");
  });
});

describe("sendAcceptanceToLinkedAccount", () => {
  it("emails a pre-linked applicant at their account address", async () => {
    const admin = fakeAdmin({
      application_responses: [
        {
          id: "r1",
          program_id: "p1",
          user_id: "u1",
          applicant_email: null,
          applicant_info: null,
          programs: program,
        },
      ],
      users: [{ id: "u1", email: "student@example.com", first_name: "Sam" }],
    });

    const res = await sendAcceptanceToLinkedAccount(admin, "r1", { siteUrl: "https://hub.test" });

    expect(res).toEqual({ sent: true, email: "student@example.com", warning: null });
    expect(sends.calls).toHaveLength(1);
    expect(sends.calls[0]).toMatchObject({
      to: "student@example.com",
      category: "enrollment_confirmation",
      sourceId: "r1",
    });
  });

  it("falls back to the application's address when no account is linked", async () => {
    const admin = fakeAdmin({
      application_responses: [
        {
          id: "r2",
          program_id: "p1",
          user_id: null,
          applicant_email: null,
          applicant_info: { email: "info@example.com", first_name: "Jo" },
          programs: program,
        },
      ],
    });
    const res = await sendAcceptanceToLinkedAccount(admin, "r2");
    expect(res.email).toBe("info@example.com");
    expect(sends.calls[0].to).toBe("info@example.com");
  });

  it("returns a warning instead of swallowing a suppressed address", async () => {
    sends.result = { ok: false, error: "Recipient is on the suppression list", suppressed: true };
    const admin = fakeAdmin({
      application_responses: [
        { id: "r3", program_id: "p1", user_id: "u3", applicant_email: null, applicant_info: null, programs: program },
      ],
      users: [{ id: "u3", email: "bounced@example.com", first_name: "Al" }],
    });
    const res = await sendAcceptanceToLinkedAccount(admin, "r3");
    expect(res.sent).toBe(false);
    expect(res.warning).toMatch(/bounced@example\.com is on the email suppression list/);
  });

  it("warns and sends nothing when there is no address anywhere", async () => {
    const admin = fakeAdmin({
      application_responses: [
        { id: "r4", program_id: "p1", user_id: null, applicant_email: null, applicant_info: {}, programs: program },
      ],
    });
    const res = await sendAcceptanceToLinkedAccount(admin, "r4");
    expect(res.sent).toBe(false);
    expect(res.warning).toMatch(/No email address/);
    expect(sends.calls).toHaveLength(0);
  });

  it("never throws when the lookup blows up", async () => {
    const admin = {
      from() {
        throw new Error("db down");
      },
    };
    const res = await sendAcceptanceToLinkedAccount(admin, "r5");
    expect(res.sent).toBe(false);
    expect(res.warning).toMatch(/db down/);
  });
});
