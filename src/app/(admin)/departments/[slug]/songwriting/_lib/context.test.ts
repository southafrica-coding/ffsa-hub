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

import { loadSongwritingContext } from "./context";

const PATH = "/departments/prayer_and_worship/songwriting";
const access = {
  canSeeDepartmentDetail: true,
  canSeeBudget: true,
  canEditBudget: false,
  canEditRocks: false,
  canSeePeopleEmails: false,
};

function home(membership: "none" | "member" | "leader" = "member") {
  return {
    department: {
      slug: "prayer_and_worship",
      name: "Prayer & Worship",
      cluster: "inward" as const,
      parentSlug: null,
      parentName: null,
      purpose: null,
      memberCount: 18,
      active: true,
      budgetOnly: false,
      viewerMembership: membership,
      access,
    },
    access,
    viewerMemberships: [],
    people: null,
    okrs: null,
    rocks: null,
    budget: null,
    servicesRun: null,
    subMinistries: null,
  };
}

function client(rpc: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(rpc) };
}

describe("loadSongwritingContext", () => {
  beforeEach(() => {
    mocks.requireSignedIn.mockReset();
    mocks.requireSignedIn.mockResolvedValue({ id: "viewer-1" });
    mocks.sessionClient.mockReset();
    mocks.loadDepartmentHomeForViewer.mockReset();
    mocks.loadDepartmentHomeForViewer.mockResolvedValue({ kind: "ok", data: home() });
  });

  it("404s any slug other than Prayer & Worship, after signing the viewer in", async () => {
    const c = client({ data: true, error: null });
    mocks.sessionClient.mockResolvedValue(c);
    await expect(loadSongwritingContext("operations", "/departments/operations/songwriting")).rejects.toThrow("NOT_FOUND");
    expect(mocks.requireSignedIn).toHaveBeenCalledWith("/departments/operations/songwriting");
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("lets a caller in when pw_can_access_songwriting is true", async () => {
    const c = client({ data: true, error: null });
    mocks.sessionClient.mockResolvedValue(c);
    await expect(loadSongwritingContext("prayer_and_worship", PATH)).resolves.toEqual({
      slug: "prayer_and_worship",
      departmentName: "Prayer & Worship",
    });
    expect(c.rpc).toHaveBeenCalledWith("pw_can_access_songwriting");
  });

  it("falls back to department membership when the RPC is missing, and 404s everyone else", async () => {
    const missing = { data: null, error: { message: "missing" } };
    mocks.sessionClient.mockResolvedValue(client(missing));
    mocks.loadDepartmentHomeForViewer.mockResolvedValue({ kind: "ok", data: home("member") });
    await expect(loadSongwritingContext("prayer_and_worship", PATH)).resolves.toMatchObject({ slug: "prayer_and_worship" });

    mocks.sessionClient.mockResolvedValue(client(missing));
    mocks.loadDepartmentHomeForViewer.mockResolvedValue({ kind: "ok", data: home("none") });
    await expect(loadSongwritingContext("prayer_and_worship", PATH)).rejects.toThrow("NOT_FOUND");
  });

  it("404s when the RPC says the caller cannot access songwriting", async () => {
    mocks.sessionClient.mockResolvedValue(client({ data: false, error: null }));
    await expect(loadSongwritingContext("prayer_and_worship", PATH)).rejects.toThrow("NOT_FOUND");
  });
});
