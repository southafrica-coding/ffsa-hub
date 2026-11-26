import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { STARTER_TEAMS, missingStarterTeams } from "./starter-teams";
import { addStarterTeams } from "./service";

// A tiny in-memory missio_teams with the real UNIQUE (org_id, name). No database.

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

type Team = { org_id: string; name: string };

function fakeClient(rows: Team[], opts: { failRead?: boolean; failInsert?: string; raceOn?: string } = {}) {
  const inserts: Team[] = [];
  const client = {
    from(table: string) {
      expect(table).toBe("missio_teams");
      return {
        select() {
          return {
            eq(_col: string, org: string) {
              if (opts.failRead) return Promise.resolve({ data: null, error: { message: "down" } });
              return Promise.resolve({ data: rows.filter((row) => row.org_id === org).map((row) => ({ name: row.name })), error: null });
            },
          };
        },
        insert(row: Team) {
          inserts.push(row);
          if (opts.failInsert === row.name) return Promise.resolve({ error: { code: "XX000", message: "boom" } });
          // Another tap got there first.
          if (opts.raceOn === row.name || rows.some((existing) => existing.org_id === row.org_id && existing.name === row.name)) {
            return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
          }
          rows.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { client, inserts, rows };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("missingStarterTeams", () => {
  it("lists the six in Jack's order, comparing trimmed and in any case", () => {
    expect(STARTER_TEAMS).toEqual(["Sound", "Worship", "Kids", "Welcome", "Production", "Hospitality"]);
    expect(missingStarterTeams([])).toEqual([...STARTER_TEAMS]);
    expect(missingStarterTeams(["  kids ", "SOUND", "Prayer"])).toEqual(["Worship", "Welcome", "Production", "Hospitality"]);
    expect(missingStarterTeams([...STARTER_TEAMS])).toEqual([]);
  });
});

describe("addStarterTeams", () => {
  it("adds all six once, then nothing the second time", async () => {
    const db = fakeClient([{ org_id: OTHER_ORG, name: "Sound" }]);
    const first = await addStarterTeams(db.client, ORG);
    expect(first).toEqual({ ok: true, body: { added: [...STARTER_TEAMS], alreadyPresent: [] } });
    expect(db.inserts.map((row) => row.name)).toEqual([...STARTER_TEAMS]);
    expect(db.inserts.every((row) => row.org_id === ORG)).toBe(true);

    db.inserts.length = 0;
    const second = await addStarterTeams(db.client, ORG);
    expect(second).toEqual({ ok: true, body: { added: [], alreadyPresent: [...STARTER_TEAMS] } });
    expect(db.inserts).toEqual([]);
  });

  it("leaves an existing Kids alone and adds the other five", async () => {
    const db = fakeClient([{ org_id: ORG, name: "kids" }]);
    const result = await addStarterTeams(db.client, ORG);
    expect(result).toEqual({
      ok: true,
      body: { added: ["Sound", "Worship", "Welcome", "Production", "Hospitality"], alreadyPresent: ["Kids"] },
    });
    expect(db.rows.filter((row) => row.org_id === ORG).map((row) => row.name)).toEqual([
      "kids",
      "Sound",
      "Worship",
      "Welcome",
      "Production",
      "Hospitality",
    ]);
  });

  it("treats a unique-name conflict as already present and carries on", async () => {
    const db = fakeClient([], { raceOn: "Worship" });
    const result = await addStarterTeams(db.client, ORG);
    expect(result).toEqual({
      ok: true,
      body: { added: ["Sound", "Kids", "Welcome", "Production", "Hospitality"], alreadyPresent: ["Worship"] },
    });
  });

  it("fails without inserting when the teams can't be read, and stops on a real insert error", async () => {
    const unread = fakeClient([], { failRead: true });
    expect(await addStarterTeams(unread.client, ORG)).toMatchObject({ ok: false, status: 500 });
    expect(unread.inserts).toEqual([]);

    const broken = fakeClient([], { failInsert: "Kids" });
    expect(await addStarterTeams(broken.client, ORG)).toMatchObject({ ok: false, status: 500, code: "server_error" });
  });
});
