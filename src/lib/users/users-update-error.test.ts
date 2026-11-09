import { describe, expect, it } from "vitest";
import {
  DEACTIVATED_ACCOUNT_MESSAGE,
  SELF_EDIT_DENIED_MESSAGE,
  usersUpdateDenialMessage,
} from "./users-update-error";

describe("usersUpdateDenialMessage", () => {
  it("passes through the trigger's own 42501 sentences", () => {
    expect(
      usersUpdateDenialMessage({
        code: "42501",
        message: "Only an admin can change job_title on an account.",
      })
    ).toBe("Only an admin can change job_title on an account.");
    expect(
      usersUpdateDenialMessage({
        code: "42501",
        message: "Only an admin can change is_active, contact_id on an account.",
      })
    ).toBe("Only an admin can change is_active, contact_id on an account.");
    expect(
      usersUpdateDenialMessage({ code: "42501", message: DEACTIVATED_ACCOUNT_MESSAGE })
    ).toBe(DEACTIVATED_ACCOUNT_MESSAGE);
    expect(
      usersUpdateDenialMessage({
        code: "42501",
        message: "Only staff choose a department.",
      })
    ).toBe("Only staff choose a department.");
    expect(
      usersUpdateDenialMessage({
        code: "42501",
        message: "Only an admin can set the department leadership_team.",
      })
    ).toBe("Only an admin can set the department leadership_team.");
    expect(
      usersUpdateDenialMessage({
        code: "42501",
        message: "Only an admin can change the account status.",
      })
    ).toBe("Only an admin can change the account status.");
    expect(
      usersUpdateDenialMessage({
        code: "42501",
        message: "Only an admin can change accepted_at.",
      })
    ).toBe("Only an admin can change accepted_at.");
  });

  it("hides a raw PostgREST permission denial", () => {
    expect(
      usersUpdateDenialMessage({
        code: "42501",
        message: "permission denied for column is_active",
      })
    ).toBe(SELF_EDIT_DENIED_MESSAGE);
    expect(
      usersUpdateDenialMessage({
        message: "permission denied for table users",
      })
    ).toBe(SELF_EDIT_DENIED_MESSAGE);
  });

  it("leaves ordinary errors alone", () => {
    expect(usersUpdateDenialMessage({ code: "23514", message: "check violation" })).toBeNull();
    expect(usersUpdateDenialMessage(null)).toBeNull();
  });
});
