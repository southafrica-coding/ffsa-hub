import { describe, expect, it } from "vitest";
import { HOUSE_CHURCH_ERROR_CODES, invalidInput, mapMissioDbError, type HouseChurchErrorCode } from "@/lib/missio/db-errors";

const SECRET = "relation secret_table detail hint Ada Lovelace note";

function bodyOf(error: { code?: string; message?: string; details?: string; hint?: string }) {
  const mapped = mapMissioDbError(error);
  return JSON.stringify({ error: mapped.error, code: mapped.code, status: mapped.status });
}

describe("mapMissioDbError", () => {
  it.each([
    ["missio_member_not_in_org"],
    ["missio_contact_not_in_org"],
    ["missio_user_not_in_org"],
    ["missio_resolve_not_allowed"],
  ])("maps 23503 %s to not_missio_person without database text", (name) => {
    const mapped = mapMissioDbError({
      code: "23503",
      message: name,
      details: SECRET,
      hint: "see Ada Lovelace",
    });
    expect(mapped).toEqual({
      status: 400,
      code: "not_missio_person",
      error: "This person is not in Missio.",
    });
    expect(bodyOf({ code: "23503", message: name, details: SECRET, hint: "see Ada Lovelace" })).not.toContain(SECRET);
    expect(bodyOf({ code: "23503", message: name, details: SECRET, hint: "see Ada Lovelace" })).not.toContain(name);
  });

  it("maps 23514 missio_started_at_in_future to 400 invalid_input without database text", () => {
    const mapped = mapMissioDbError({
      code: "23514",
      message: "missio_started_at_in_future",
      details: SECRET,
      hint: "started_at > current_date",
    });
    expect(mapped).toEqual({
      status: 400,
      code: "invalid_input",
      error: "Check the fields and try again.",
      fieldErrors: { startedAt: "Check this field and try again." },
    });
    const body = JSON.stringify(mapped);
    expect(body).not.toContain("missio_started_at_in_future");
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain("current_date");
  });

  it("maps 23514 missio_ended_at_in_future to 409 ended_at_in_future", () => {
    const mapped = mapMissioDbError({
      code: "23514",
      message: "missio_ended_at_in_future",
      details: SECRET,
      hint: "ended_at > current_date",
    });
    expect(mapped).toEqual({
      status: 409,
      code: "ended_at_in_future",
      error: "That end date is after today.",
    });
    const body = bodyOf({
      code: "23514",
      message: "missio_ended_at_in_future",
      details: SECRET,
      hint: "ended_at > current_date",
    });
    expect(body).not.toContain("missio_ended_at_in_future");
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain("current_date");
  });

  it("maps an unrecognised database error to server_error and drops the text", () => {
    const mapped = mapMissioDbError({
      code: "XX000",
      message: SECRET,
      details: "Key (contact_id)=(secret) already exists",
      hint: "double check the sheet line",
    });
    expect(mapped).toEqual({ status: 500, code: "server_error", error: "Something went wrong." });
    const body = JSON.stringify(mapped);
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain("contact_id");
    expect(body).not.toContain("sheet line");
    expect(body).not.toContain("XX000");
  });

  it("does not treat a 23503 or 23514 without the known text as a mapped case", () => {
    expect(
      mapMissioDbError({ code: "23503", message: SECRET, details: "foreign key", hint: "contacts" }).code
    ).toBe("server_error");
    const unmapped = mapMissioDbError({
      code: "23514",
      message: "ended_at_check",
      details: SECRET,
      hint: "started_at > current_date",
    });
    expect(unmapped).toEqual({ status: 500, code: "server_error", error: "Something went wrong." });
    expect(JSON.stringify(unmapped)).not.toContain("ended_at_check");
    expect(JSON.stringify(unmapped)).not.toContain(SECRET);
    expect(JSON.stringify(unmapped)).not.toContain("current_date");
  });
});

describe("HOUSE_CHURCH_ERROR_CODES", () => {
  it("pins the Hub UI list", () => {
    expect([...HOUSE_CHURCH_ERROR_CODES]).toEqual([
      "invalid_input",
      "not_missio_person",
      "not_found",
      "already_member",
      "already_resolved",
      "membership_not_current",
      "ended_at_in_future",
      "unauthenticated",
      "forbidden",
      "rate_limited",
      "server_error",
    ]);
    const sample: HouseChurchErrorCode = "membership_not_current";
    expect(HOUSE_CHURCH_ERROR_CODES).toContain(sample);
    expect(mapMissioDbError({ code: "23514", message: "missio_started_at_in_future" }).code).toBe("invalid_input");
    expect(mapMissioDbError({ code: "23503", message: "missio_user_not_in_org" }).code).toBe("not_missio_person");
    expect(HOUSE_CHURCH_ERROR_CODES).toContain("invalid_input");
    expect(HOUSE_CHURCH_ERROR_CODES).toContain("not_missio_person");
  });
});

describe("invalidInput", () => {
  it("returns our message and fieldErrors, not the submitted value", () => {
    const body = invalidInput({
      contactId: "Check this field and try again.",
      role: "Check this field and try again.",
    });
    expect(body).toEqual({
      status: 400,
      code: "invalid_input",
      error: "Check the fields and try again.",
      fieldErrors: {
        contactId: "Check this field and try again.",
        role: "Check this field and try again.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("Ada Lovelace");
    expect(invalidInput().fieldErrors).toEqual({});
  });
});
