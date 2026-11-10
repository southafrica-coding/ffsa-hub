import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/lib/testing/fake-supabase";
import { getSchoolsCountScopes } from "./schools-count-scopes";

const PROGRAM_A = "11111111-1111-4111-8111-111111111111";
const PROGRAM_B = "22222222-2222-4222-8222-222222222222";

type RoleSeed = { name: string; scope_type: string | null; scope_id: string | null };
type PermSeed = { key: string; scope_type: string | null; scope_id: string | null };

function scopes(seed: { roles?: RoleSeed[]; perms?: PermSeed[] }) {
  const f = createFakeSupabase({
    resolve: (q) => {
      if (q.table === "user_roles") {
        return {
          data: (seed.roles ?? []).map((role) => ({
            scope_type: role.scope_type,
            scope_id: role.scope_id,
            roles: { name: role.name },
          })),
        };
      }
      if (q.table === "user_permissions") {
        return {
          data: (seed.perms ?? []).map((perm) => ({
            scope_type: perm.scope_type,
            scope_id: perm.scope_id,
            permissions: { key: perm.key },
          })),
        };
      }
      return { data: [] };
    },
  });
  return getSchoolsCountScopes(f.client, "u");
}

describe("getSchoolsCountScopes program_leader scope", () => {
  it("treats an unscoped program_leader as every program", async () => {
    expect(
      await scopes({ roles: [{ name: "program_leader", scope_type: null, scope_id: PROGRAM_A }] })
    ).toEqual({ globalLevel: "manage", programLevels: {} });
  });

  it("counts a program-scoped role for that program only", async () => {
    expect(
      await scopes({
        roles: [{ name: "program_leader", scope_type: "program", scope_id: PROGRAM_A }],
      })
    ).toEqual({ globalLevel: null, programLevels: { [PROGRAM_A]: "manage" } });
  });

  it("grants nothing for a team or event scope", async () => {
    expect(
      await scopes({ roles: [{ name: "program_leader", scope_type: "team", scope_id: "team-1" }] })
    ).toEqual({ globalLevel: null, programLevels: {} });
    expect(
      await scopes({ roles: [{ name: "program_leader", scope_type: "event", scope_id: "event-1" }] })
    ).toEqual({ globalLevel: null, programLevels: {} });
  });

  it("still sees an unscoped role when a team-scoped row comes first", async () => {
    expect(
      await scopes({
        roles: [
          { name: "program_leader", scope_type: "team", scope_id: "team-1" },
          { name: "program_leader", scope_type: null, scope_id: null },
        ],
      })
    ).toEqual({ globalLevel: "manage", programLevels: {} });
  });

  it("keeps admin and super_admin global, and leaves direct grants alone", async () => {
    expect(await scopes({ roles: [{ name: "admin", scope_type: null, scope_id: null }] })).toEqual({
      globalLevel: "manage",
      programLevels: {},
    });
    expect(
      await scopes({ roles: [{ name: "super_admin", scope_type: "event", scope_id: "event-1" }] })
    ).toEqual({ globalLevel: "manage", programLevels: {} });

    expect(
      await scopes({
        perms: [{ key: "schools.view_applications", scope_type: null, scope_id: null }],
      })
    ).toEqual({ globalLevel: "view", programLevels: {} });
    expect(
      await scopes({
        perms: [{ key: "schools.view_applications", scope_type: "program", scope_id: PROGRAM_B }],
      })
    ).toEqual({ globalLevel: null, programLevels: { [PROGRAM_B]: "view" } });
  });
});
