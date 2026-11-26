import { describe, expect, it, vi } from "vitest";
import { SONG_LIBRARY_MANAGE_RPC, callerCanManageSongLibrary, canManageFromRpc } from "./can-manage";

describe("song library canManage", () => {
  it("calls song_library_can_manage, not the songwriting helper", async () => {
    expect(SONG_LIBRARY_MANAGE_RPC).toBe("song_library_can_manage");
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await expect(callerCanManageSongLibrary({ rpc })).resolves.toEqual({ data: true, error: null });
    expect(rpc).toHaveBeenCalledWith("song_library_can_manage");
    expect(rpc).not.toHaveBeenCalledWith("pw_can_access_songwriting");
  });

  it("is true when the RPC says so, and falls back to department membership when the RPC is missing", () => {
    expect(canManageFromRpc({ data: true, error: null }, "none")).toBe(true);
    expect(canManageFromRpc({ data: false, error: null }, "member")).toBe(false);
    expect(canManageFromRpc({ data: null, error: { message: "missing" } }, "member")).toBe(true);
    expect(canManageFromRpc({ data: null, error: { message: "missing" } }, "none")).toBe(false);
    expect(canManageFromRpc({ data: null, error: { message: "missing" } }, undefined)).toBe(false);
  });
});
