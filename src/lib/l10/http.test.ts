import { describe, expect, it } from "vitest";
import { dbError } from "./http";

const answer = async (error: { code: string; message: string }) => {
  const r = dbError(error);
  return { status: r.status, body: await r.json() };
};

describe("dbError maps 416's named errors to API codes", () => {
  it("names each one", async () => {
    expect(await answer({ code: "42501", message: "l10_rating_not_allowed" })).toMatchObject({ status: 403, body: { code: "l10_rating_not_allowed" } });
    expect(await answer({ code: "42501", message: "l10_attendee_immutable" })).toMatchObject({ status: 403, body: { code: "l10_attendee_immutable" } });
    expect(await answer({ code: "42501", message: "l10_auto_headline_locked" })).toMatchObject({ status: 409, body: { code: "l10_auto_headline_locked" } });
    expect(await answer({ code: "23514", message: "l10_auto_headline_incomplete" })).toMatchObject({ status: 500, body: { code: "l10_auto_headline_incomplete" } });
    expect(
      await answer({ code: "23505", message: 'duplicate key value violates unique constraint "l10_meetings_one_open_per_team"' })
    ).toMatchObject({ status: 409, body: { code: "l10_meeting_already_open" } });
    expect(
      await answer({ code: "23505", message: 'duplicate key value violates unique constraint "l10_headlines_one_auto_recap"' })
    ).toMatchObject({ status: 409, body: { code: "l10_headlines_one_auto_recap" } });
  });

  it("keeps the generic answers for everything else, with no database text", async () => {
    expect((await answer({ code: "42501", message: "new row violates row-level security policy" })).status).toBe(403);
    expect(await answer({ code: "23505", message: 'duplicate key value violates unique constraint "x"' })).toMatchObject({ status: 409, body: { error: "That already exists" } });
    expect((await answer({ code: "23514", message: "some_check" })).status).toBe(400);
  });
});
