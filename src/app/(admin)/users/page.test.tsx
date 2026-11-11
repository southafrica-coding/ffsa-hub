import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /users/merge allows super_admin and admin (the page query and the merge
 * API both use those two names). Everyone else is sent back to /users.
 */
const state = vi.hoisted(() => ({
  userId: null as string | null,
  roles: [] as string[],
}));

function query(rows: Array<{ roles: { name: string } }>) {
  const filters: { column: string; value: unknown }[] = [];
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.limit = () => builder;
  builder.order = () => builder;
  builder.in = (column: string, value: unknown) => {
    filters.push({ column, value });
    return builder;
  };
  builder.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown
  ) => {
    let data = rows;
    for (const filter of filters) {
      if (filter.column === "roles.name" && Array.isArray(filter.value)) {
        const allowed = new Set(filter.value as string[]);
        data = data.filter((row) => allowed.has(row.roles.name));
      }
    }
    return Promise.resolve({ data, error: null }).then(resolve, reject);
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({
        data: {
          session: state.userId ? { user: { id: state.userId } } : null,
        },
      }),
    },
    from: (table: string) =>
      query(
        table === "user_roles" ? state.roles.map((name) => ({ roles: { name } })) : []
      ),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => query([]),
  }),
}));

vi.mock("@/services/users", () => ({
  getUsers: async () => ({ data: [], count: 0, error: null }),
}));

vi.mock("@/services/ministries", () => ({
  listMinistries: async () => ({ data: [] }),
  listActiveMinistryMemberships: async () => ({ data: [] }),
}));

vi.mock("@/services/schools", () => ({
  listActiveEnrollmentSchools: async () => ({ data: [] }),
}));

vi.mock("@/lib/schools/awaiting-arrival", () => ({
  getAwaitingArrivalByUser: async () => ({}),
}));

vi.mock("@/lib/users/auth-signins", () => ({
  getAuthSignIns: async () => new Map(),
}));

vi.mock("@/lib/users/account-flags", () => ({
  getAccountFlags: async () => new Map(),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
}));

vi.mock("./users-table", () => ({
  UsersTable: () => null,
}));

vi.mock("./invite-user-form", () => ({
  InviteUserForm: () => null,
}));

vi.mock("./public-signup-link-card", () => ({
  PublicSignupLinkCard: () => null,
}));

import UsersPage from "./page";

async function markup() {
  return renderToStaticMarkup(await UsersPage());
}

describe("Users merge link", () => {
  beforeEach(() => {
    state.userId = "user-1";
    state.roles = [];
  });

  it.each(["super_admin", "admin"])("shows Merge accounts to %s", async (role) => {
    state.roles = [role];
    const html = await markup();
    expect(html).toContain('href="/users/merge"');
    expect(html).toContain("Merge accounts");
  });

  it.each(["staff", "finance_admin", "legal_admin", "program_leader", "ministry_leader"])(
    "hides Merge accounts from %s",
    async (role) => {
      state.roles = [role];
      const html = await markup();
      expect(html).not.toContain("/users/merge");
      expect(html).not.toContain("Merge accounts");
    }
  );

  it("hides Merge accounts from a signed-in person with no admin role", async () => {
    state.roles = [];
    const html = await markup();
    expect(html).not.toContain("/users/merge");
    expect(html).not.toContain("Merge accounts");
  });

  it("hides Merge accounts when nobody is signed in", async () => {
    state.userId = null;
    state.roles = ["super_admin"];
    const html = await markup();
    expect(html).not.toContain("/users/merge");
    expect(html).not.toContain("Merge accounts");
  });
});
