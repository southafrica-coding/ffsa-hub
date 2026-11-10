import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("REDIRECT"), { url });
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  getAuthedUser: vi.fn(),
  accountIsActive: vi.fn(),
  listVisibleDepartments: vi.fn(),
  resolveHome: vi.fn(),
  loadMinistryAccess: vi.fn(),
  buildDepartmentHome: vi.fn(),
  listServices: vi.fn(),
  listServiceOwnerRows: vi.fn(),
  usableServiceKeys: vi.fn(),
  listMinistriesById: vi.fn(),
  listActiveMemberships: vi.fn(),
  listDepartmentRows: vi.fn(),
  rocksDueFor: vi.fn(),
  viewerMemberships: vi.fn(() => []),
  toHubService: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: () => mocks.createClient() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.createAdminClient() }));
vi.mock("@/lib/api-auth", () => ({ getAuthedUser: (...args: unknown[]) => mocks.getAuthedUser(...args) }));
vi.mock("@/lib/auth/grant-scope", () => ({
  accountIsActive: (...args: unknown[]) => mocks.accountIsActive(...args),
}));
vi.mock("@/lib/departments/page", () => ({
  listVisibleDepartments: (...args: unknown[]) => mocks.listVisibleDepartments(...args),
  buildDepartmentHome: (...args: unknown[]) => mocks.buildDepartmentHome(...args),
  rocksDueFor: (...args: unknown[]) => mocks.rocksDueFor(...args),
  viewerMemberships: () => mocks.viewerMemberships(),
}));
vi.mock("@/lib/departments/http", () => ({
  resolveHome: (...args: unknown[]) => mocks.resolveHome(...args),
}));
vi.mock("@/lib/departments/access", () => ({
  loadMinistryAccess: (...args: unknown[]) => mocks.loadMinistryAccess(...args),
}));
vi.mock("@/lib/services/repository", () => ({
  listServices: (...args: unknown[]) => mocks.listServices(...args),
  listServiceOwnerRows: (...args: unknown[]) => mocks.listServiceOwnerRows(...args),
}));
vi.mock("@/lib/services/access", () => ({
  usableServiceKeys: (...args: unknown[]) => mocks.usableServiceKeys(...args),
}));
vi.mock("@/lib/departments/repository", () => ({
  listActiveMemberships: (...args: unknown[]) => mocks.listActiveMemberships(...args),
  listDepartmentRows: (...args: unknown[]) => mocks.listDepartmentRows(...args),
  listMinistriesById: (...args: unknown[]) => mocks.listMinistriesById(...args),
}));
vi.mock("@/lib/services/present", () => ({
  toHubService: (...args: unknown[]) => mocks.toHubService(...args),
}));

import { DepartmentLoadError, loadDepartmentHome, loadDepartmentList, loadHomeDashboard, loadHubServices } from "./load";

const userClient = { kind: "user" };
const adminClient = { kind: "admin" };

function signedIn() {
  mocks.createClient.mockResolvedValue(userClient);
  mocks.createAdminClient.mockReturnValue(adminClient);
  mocks.getAuthedUser.mockResolvedValue({ id: "user-1" });
  mocks.accountIsActive.mockResolvedValue(true);
}

describe("department loaders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a signed-out reader to login with a safe return path", async () => {
    mocks.createClient.mockResolvedValue(userClient);
    mocks.getAuthedUser.mockResolvedValue(null);
    await expect(loadDepartmentList("/departments")).rejects.toMatchObject({
      url: "/login?redirect=" + encodeURIComponent("/departments"),
    });
    await expect(loadDepartmentList("//evil.example")).rejects.toMatchObject({ url: "/login" });
  });

  it("404s an inactive account", async () => {
    mocks.createClient.mockResolvedValue(userClient);
    mocks.getAuthedUser.mockResolvedValue({ id: "user-1" });
    mocks.accountIsActive.mockResolvedValue(false);
    await expect(loadDepartmentList("/departments")).rejects.toThrow("NOT_FOUND");
  });

  it("404s a forbidden department list and throws on any other list failure", async () => {
    signedIn();
    mocks.listVisibleDepartments.mockResolvedValueOnce({
      data: null,
      error: { message: "access lookup failed" },
      accessError: true,
    });
    await expect(loadDepartmentList("/departments")).rejects.toThrow("NOT_FOUND");

    mocks.listVisibleDepartments.mockResolvedValueOnce({ data: null, error: { message: "db down" } });
    await expect(loadDepartmentList("/departments")).rejects.toBeInstanceOf(DepartmentLoadError);
  });

  it("404s a missing or forbidden home and throws when the home read fails", async () => {
    signedIn();
    mocks.resolveHome.mockResolvedValueOnce({ data: null, error: null });
    await expect(loadDepartmentHome("missing", "/departments/missing")).rejects.toThrow("NOT_FOUND");

    mocks.resolveHome.mockResolvedValueOnce({ data: null, error: { message: "lookup failed" } });
    await expect(loadDepartmentHome("media", "/departments/media")).rejects.toThrow("NOT_FOUND");

    mocks.resolveHome.mockResolvedValue({ data: { id: "dept-1", slug: "media" }, error: null });
    mocks.loadMinistryAccess.mockResolvedValueOnce({ ok: false });
    await expect(loadDepartmentHome("media", "/departments/media")).rejects.toThrow("NOT_FOUND");

    mocks.loadMinistryAccess.mockResolvedValueOnce({
      ok: true,
      denied: true,
      access: {
        canSeeDepartmentDetail: false,
        canSeeBudget: false,
        canEditBudget: false,
        canEditRocks: false,
        canSeePeopleEmails: false,
      },
    });
    await expect(loadDepartmentHome("media", "/departments/media")).rejects.toThrow("NOT_FOUND");

    mocks.loadMinistryAccess.mockResolvedValue({
      ok: true,
      denied: false,
      access: {
        canSeeDepartmentDetail: true,
        canSeeBudget: false,
        canEditBudget: false,
        canEditRocks: false,
        canSeePeopleEmails: false,
      },
    });
    mocks.buildDepartmentHome.mockResolvedValueOnce({ data: null, error: { message: "db down" } });
    await expect(loadDepartmentHome("media", "/departments/media")).rejects.toBeInstanceOf(DepartmentLoadError);
  });

  it("returns the home payload from the loader, including a folded slug", async () => {
    signedIn();
    const access = {
      canSeeDepartmentDetail: true,
      canSeeBudget: false,
      canEditBudget: false,
      canEditRocks: false,
      canSeePeopleEmails: false,
    };
    const payload = { department: { slug: "finances_legal" }, access };
    mocks.resolveHome.mockResolvedValue({ data: { id: "fin-1", slug: "finances_legal" }, error: null });
    mocks.loadMinistryAccess.mockResolvedValue({ ok: true, denied: false, access });
    mocks.buildDepartmentHome.mockResolvedValue({ data: payload, error: null });

    await expect(loadDepartmentHome("donors_dev", "/departments/donors_dev")).resolves.toBe(payload);
    expect(mocks.resolveHome).toHaveBeenCalledWith(userClient, "donors_dev");
    expect(mocks.buildDepartmentHome).toHaveBeenCalledWith(
      adminClient,
      userClient,
      "user-1",
      access,
      { id: "fin-1", slug: "finances_legal" }
    );
  });

  it("404s a forbidden service read and throws when ministry names fail", async () => {
    signedIn();
    mocks.listServices.mockResolvedValue({ data: [], error: { message: "nope" } });
    mocks.listServiceOwnerRows.mockResolvedValue({ data: [], error: null });
    await expect(loadHubServices("/services")).rejects.toThrow("NOT_FOUND");

    mocks.listServices.mockResolvedValue({ data: [], error: null });
    mocks.listServiceOwnerRows.mockResolvedValue({ data: [], error: null });
    mocks.usableServiceKeys.mockResolvedValue({ ok: true, keys: new Set() });
    mocks.listMinistriesById.mockResolvedValue({ data: [], error: { message: "db down" } });
    await expect(loadHubServices("/services")).rejects.toBeInstanceOf(DepartmentLoadError);
  });

  it("throws the home dashboard before returning departments when a later read fails", async () => {
    signedIn();
    mocks.listVisibleDepartments.mockResolvedValue({
      data: [{ slug: "media", access: { canSeeDepartmentDetail: true } }],
      error: null,
    });
    mocks.listServices.mockResolvedValue({ data: [], error: null });
    mocks.listServiceOwnerRows.mockResolvedValue({ data: [], error: null });
    mocks.listActiveMemberships.mockResolvedValue({ data: [], error: null });
    mocks.usableServiceKeys.mockResolvedValue({ ok: true, keys: new Set() });
    mocks.listDepartmentRows.mockResolvedValue({ data: [], error: null });
    mocks.rocksDueFor.mockResolvedValue({ data: null, error: { message: "db down" } });

    await expect(loadHomeDashboard("/home")).rejects.toBeInstanceOf(DepartmentLoadError);
  });
});
