import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /my-attendance's own guard is getCurrentUser: any signed-in profile may
 * open it, and a session with no profile row is sent to /login. There is
 * no role check on that page, so the link follows the profile, not a role.
 */
const state = vi.hoisted(() => ({
  authUser: null as { id: string } | null,
  profile: null as { id: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.authUser } }),
    },
    from: () => {
      const builder: Record<string, unknown> = {};
      const self = () => builder;
      for (const method of ["select", "eq", "in", "order", "limit"]) builder[method] = self;
      builder.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown
      ) => Promise.resolve({ data: [], error: null }).then(resolve, reject);
      return builder;
    },
  }),
}));

vi.mock("@/services/schools", () => ({
  getEnrollmentsByUser: async () => ({ data: [] }),
  getResponsesByUser: async () => ({ data: [] }),
}));

vi.mock("@/services/users", () => ({
  getCurrentUser: async () => ({ data: state.profile, error: null }),
}));

import MySchoolsPage from "./page";

async function markup() {
  return renderToStaticMarkup(await MySchoolsPage());
}

describe("My training attendance link", () => {
  beforeEach(() => {
    state.authUser = null;
    state.profile = null;
  });

  it.each(["member", "leader", "admin", "finance", "portal"])(
    "shows View my attendance to a signed-in %s profile",
    async () => {
      state.authUser = { id: "user-1" };
      state.profile = { id: "user-1" };
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
    state.profile = null;
    const html = await markup();
    expect(html).not.toContain("/my-attendance");
    expect(html).not.toContain("View my attendance");
  });
});
