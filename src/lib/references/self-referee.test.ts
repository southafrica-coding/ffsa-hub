import { createFakeSupabase } from "@/lib/testing/fake-supabase";
import { describe, expect, it, vi } from "vitest";
import {
  SELF_REFEREE_MESSAGE,
  isSelfReferee,
  loadApplicantEmails,
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

describe("loadApplicantEmails auth lookup", () => {
  it("logs a failed auth lookup and still returns the other applicant emails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = createFakeSupabase({
      resolve: (q) => {
        if (q.table === "application_responses") {
          return {
            data: {
              applicant_email: "ada@example.com",
              applicant_info: { email: "info@example.com" },
              user_id: "user-1",
              users: { email: "user@example.com" },
            },
          };
        }
        return { data: null };
      },
    });
    fake.client.auth.admin = {
      getUserById: async () => ({ data: { user: null }, error: { message: "auth down" } }),
    };

    const result = await loadApplicantEmails(fake.client, "app-1");

    expect(result.error).toBeNull();
    expect(result.emails).toEqual(["ada@example.com", "info@example.com", "user@example.com"]);
    expect(isSelfReferee("ada@example.com", result.emails)).toBe(true);
    expect(isSelfReferee("pastor@example.com", result.emails)).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      "[self-referee] auth email lookup failed",
      expect.objectContaining({ message: "auth down" })
    );
    errorSpy.mockRestore();
  });
});
