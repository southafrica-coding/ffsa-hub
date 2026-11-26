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
  getViewer: vi.fn(),
  sessionClient: vi.fn(),
  loadCachedDepartmentsIndex: vi.fn(),
}));

vi.mock("@/lib/departments/session", () => ({
  requireSignedIn: mocks.requireSignedIn,
  getViewer: mocks.getViewer,
}));

vi.mock("@/lib/departments/load", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/departments/load")>()),
  sessionClient: mocks.sessionClient,
  loadCachedDepartmentsIndex: mocks.loadCachedDepartmentsIndex,
}));

vi.mock("@/lib/departments/login-path", () => ({
  loginPath: (path: string) => `/login?next=${encodeURIComponent(path)}`,
}));

import { loadLibraryViewer, loadLibraryViewerForIndex } from "./viewer";

const PATH = "/song-library";
const owner = { slug: "prayer_and_worship", name: "Prayer & Worship", viewerMembership: "member" as const };

function setup(opts: { rpc: { data: unknown; error: unknown }; membership?: "none" | "member" | "leader" }) {
  const rpc = vi.fn().mockResolvedValue(opts.rpc);
  const supabase = { rpc };
  mocks.sessionClient.mockResolvedValue(supabase);
  mocks.requireSignedIn.mockResolvedValue({ id: "viewer-1" });
  mocks.loadCachedDepartmentsIndex.mockResolvedValue({
    kind: "ok",
    data: [{ ...owner, viewerMembership: opts.membership ?? "member" }],
  });
  return { rpc, supabase };
}

describe("loadLibraryViewer", () => {
  beforeEach(() => {
    mocks.requireSignedIn.mockReset();
    mocks.getViewer.mockReset();
    mocks.sessionClient.mockReset();
    mocks.loadCachedDepartmentsIndex.mockReset();
  });

  it("resolves canManage with song_library_can_manage, not the songwriting helper", async () => {
    const { rpc } = setup({ rpc: { data: true, error: null } });
    await expect(loadLibraryViewer(PATH)).resolves.toEqual({ canManage: true, ownerName: "Prayer & Worship" });
    expect(mocks.requireSignedIn).toHaveBeenCalledWith(PATH);
    expect(rpc).toHaveBeenCalledWith("song_library_can_manage");
    expect(rpc).not.toHaveBeenCalledWith("pw_can_access_songwriting");
  });

  it("is not a manager when the RPC is false, and falls back to membership when the RPC is missing", async () => {
    setup({ rpc: { data: false, error: null }, membership: "member" });
    await expect(loadLibraryViewer(PATH)).resolves.toEqual({ canManage: false, ownerName: "Prayer & Worship" });

    setup({ rpc: { data: null, error: { message: "missing" } }, membership: "member" });
    await expect(loadLibraryViewer(PATH)).resolves.toMatchObject({ canManage: true });

    setup({ rpc: { data: null, error: { message: "missing" } }, membership: "none" });
    await expect(loadLibraryViewer(PATH)).resolves.toMatchObject({ canManage: false });
  });
});

describe("loadLibraryViewerForIndex", () => {
  beforeEach(() => {
    mocks.getViewer.mockReset();
    mocks.sessionClient.mockReset();
    mocks.loadCachedDepartmentsIndex.mockReset();
  });

  it("redirects a signed-out viewer and returns null for an inactive account", async () => {
    mocks.getViewer.mockResolvedValue({ user: null, supabase: {}, active: false });
    await expect(loadLibraryViewerForIndex(PATH)).rejects.toMatchObject({ url: "/login?next=%2Fsong-library" });

    mocks.getViewer.mockResolvedValue({ user: { id: "viewer-1" }, supabase: {}, active: false });
    await expect(loadLibraryViewerForIndex(PATH)).resolves.toBeNull();
  });
});
