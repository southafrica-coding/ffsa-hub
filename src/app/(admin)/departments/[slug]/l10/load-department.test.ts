import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("REDIRECT"), { url });
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const mocks = vi.hoisted(() => ({
  requireSignedIn: vi.fn(),
  sessionClient: vi.fn(),
  loadDepartmentHomeForViewer: vi.fn(),
}));

vi.mock("@/lib/departments/session", () => ({
  requireSignedIn: mocks.requireSignedIn,
  getViewer: vi.fn(),
}));

vi.mock("@/lib/departments", () => ({
  loadDepartmentHomeForViewer: mocks.loadDepartmentHomeForViewer,
  loadDepartmentsIndexForViewer: vi.fn(),
  loadHomeForViewer: vi.fn(),
  loadServicesForViewer: vi.fn(),
}));

vi.mock("@/lib/departments/load", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/departments/load")>()),
  sessionClient: mocks.sessionClient,
}));

import { loadL10Team } from "./load-department";

const TEAM_ID = "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const DEPT_ID = "dept-ops";
const PATH = `/departments/ops/l10/${TEAM_ID}`;
const department = { slug: "ops", name: "Operations" };

type Row = Record<string, unknown> | null;

/** A session client whose from-chain answers per table; records what was read. */
function client(rows: { team: Row; ministry: Row; teamError?: boolean }) {
  const reads: { table: string; columns: string; filters: [string, unknown][] }[] = [];
  return {
    reads,
    from(table: string) {
      const read = { table, columns: "", filters: [] as [string, unknown][] };
      reads.push(read);
      const q = {
        select(columns: string) {
          read.columns = columns;
          return q;
        },
        eq(column: string, value: unknown) {
          read.filters.push([column, value]);
          return q;
        },
        async maybeSingle() {
          if (table === "staff_ministries") return { data: rows.ministry, error: null };
          return { data: rows.team, error: rows.teamError ? { message: "nope" } : null };
        },
      };
      return q;
    },
  };
}

function setup(rows: Parameters<typeof client>[0]) {
  const c = client(rows);
  mocks.sessionClient.mockResolvedValue(c);
  return c;
}

const activeTeam = { id: TEAM_ID, department_id: DEPT_ID, is_active: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSignedIn.mockResolvedValue({ id: "viewer-1" });
  mocks.loadDepartmentHomeForViewer.mockResolvedValue({ kind: "ok", data: { department } });
});

describe("loadL10Team", () => {
  it("404s a teamId that isn't a uuid, before any read", async () => {
    setup({ team: activeTeam, ministry: { id: DEPT_ID } });
    await expect(loadL10Team("ops", "not-a-uuid", PATH)).rejects.toThrow("NOT_FOUND");
    expect(mocks.requireSignedIn).not.toHaveBeenCalled();
    expect(mocks.sessionClient).not.toHaveBeenCalled();
  });

  it("404s a team that is missing or hidden by RLS", async () => {
    setup({ team: null, ministry: { id: DEPT_ID } });
    await expect(loadL10Team("ops", TEAM_ID, PATH)).rejects.toThrow("NOT_FOUND");
  });

  it("404s on a read error", async () => {
    setup({ team: activeTeam, ministry: { id: DEPT_ID }, teamError: true });
    await expect(loadL10Team("ops", TEAM_ID, PATH)).rejects.toThrow("NOT_FOUND");
  });

  it("404s an inactive team", async () => {
    setup({ team: { ...activeTeam, is_active: false }, ministry: { id: DEPT_ID } });
    await expect(loadL10Team("ops", TEAM_ID, PATH)).rejects.toThrow("NOT_FOUND");
  });

  it("404s a team in another department", async () => {
    setup({ team: { ...activeTeam, department_id: "dept-other" }, ministry: { id: DEPT_ID } });
    await expect(loadL10Team("ops", TEAM_ID, PATH)).rejects.toThrow("NOT_FOUND");
  });

  it("404s when the department row can't be read", async () => {
    setup({ team: activeTeam, ministry: null });
    await expect(loadL10Team("ops", TEAM_ID, PATH)).rejects.toThrow("NOT_FOUND");
  });

  it("404s when the viewer can't see the department", async () => {
    setup({ team: activeTeam, ministry: { id: DEPT_ID } });
    mocks.loadDepartmentHomeForViewer.mockResolvedValue({ kind: "forbidden" });
    await expect(loadL10Team("ops", TEAM_ID, PATH)).rejects.toThrow("NOT_FOUND");
  });

  it("returns the viewer, department and client for an active team in this department", async () => {
    const c = setup({ team: activeTeam, ministry: { id: DEPT_ID } });
    const loaded = await loadL10Team("ops", TEAM_ID, PATH);
    expect(loaded).toEqual({ viewerId: "viewer-1", department, supabase: c });
    expect(mocks.requireSignedIn).toHaveBeenCalledWith(PATH);
    expect(mocks.loadDepartmentHomeForViewer).toHaveBeenCalledWith(c, "ops");
    expect(c.reads).toEqual([
      { table: "l10_teams", columns: "id, department_id, is_active", filters: [["id", TEAM_ID]] },
      { table: "staff_ministries", columns: "id", filters: [["slug", "ops"]] },
    ]);
  });
});
