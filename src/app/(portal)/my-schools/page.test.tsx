import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /my-attendance sends anyone without a users row to login. The link uses
 * that same fact: one read of the signed-in person's users row. No role check.
 */
const state = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  usersRow: null as { id: string } | null,
  usersError: null as { message: string } | null,
  usersReject: false,
}));

function query(result: { data: unknown; error: { message: string } | null }, rejectRead: boolean) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  for (const method of ["select", "eq", "in", "order", "limit"]) builder[method] = self;
  const finish = () => (rejectRead ? Promise.reject(new Error("users read failed")) : Promise.resolve(result));
  builder.maybeSingle = finish;
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    finish().then(resolve, reject);
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.authUser } }),
    },
    from: (table: string) =>
      table === "users"
        ? query({ data: state.usersRow, error: state.usersError }, state.usersReject)
        : query({ data: [], error: null }, false),
  }),
}));

vi.mock("@/services/schools", () => ({
  getEnrollmentsByUser: async () => ({ data: [] }),
  getResponsesByUser: async () => ({ data: [] }),
}));

import MySchoolsPage from "./page";

async function markup() {
  return renderToStaticMarkup(await MySchoolsPage());
}

describe("My training attendance link", () => {
  beforeEach(() => {
    state.authUser = null;
    state.usersRow = null;
    state.usersError = null;
    state.usersReject = false;
  });

  it.each(["member", "leader", "admin", "finance", "portal"])(
    "shows View my attendance to a signed-in %s profile",
    async () => {
      state.authUser = { id: "user-1" };
      state.usersRow = { id: "user-1" };
      const html = await markup();
      expect(html).toContain('href="/my-attendance"');
      expect(html).toContain("View my attendance");
    }
  );

  it("hides the attendance link when nobody is signed in", async () => {
    const html = await markup();
    expect(html).not.toContain("/my-attendance");
    expect(html).not.toContain("View my attendance");
    expect(html).toContain("Not authenticated");
  });

  it("hides the attendance link when the session has no profile", async () => {
    state.authUser = { id: "user-1" };
    state.usersRow = null;
    const html = await markup();
    expect(html).not.toContain("/my-attendance");
    expect(html).not.toContain("View my attendance");
  });

  it("hides the attendance link when the profile read errors", async () => {
    state.authUser = { id: "user-1" };
    state.usersRow = null;
    state.usersError = { message: "permission denied" };
    const html = await markup();
    expect(html).toContain("My training");
    expect(html).not.toContain("/my-attendance");
    expect(html).not.toContain("View my attendance");
  });

  it("hides the attendance link when the profile read rejects", async () => {
    state.authUser = { id: "user-1" };
    state.usersReject = true;
    const html = await markup();
    expect(html).toContain("My training");
    expect(html).not.toContain("/my-attendance");
    expect(html).not.toContain("View my attendance");
  });
});
