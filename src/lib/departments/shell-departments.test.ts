import { beforeEach, describe, expect, it, vi } from "vitest";

const readIndex = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/departments", () => ({
  loadDepartmentsIndexForViewer: (client: unknown) => readIndex(client),
}));

import { departmentsForShell, toShellDepartments } from "./load";

describe("shell departments", () => {
  beforeEach(() => {
    readIndex.mockReset();
  });

  it("maps a member and a leader onto HubShell's id, label and href", () => {
    expect(
      toShellDepartments([
        { slug: "media", name: "Media", viewerMembership: "member" },
        { slug: "worship", name: "Worship", viewerMembership: "leader" },
      ])
    ).toEqual([
      { id: "media", label: "Media", href: "/departments/media" },
      { id: "worship", label: "Worship", href: "/departments/worship" },
    ]);
  });

  it("leaves admins and leadership viewers with no membership out of My departments", () => {
    expect(toShellDepartments([{ slug: "media", name: "Media", viewerMembership: "none" }])).toEqual([]);
  });

  it("returns an empty My departments list when every membership read came back none", async () => {
    readIndex.mockResolvedValue({
      kind: "ok",
      data: [
        { slug: "media", name: "Media", viewerMembership: "none" },
        { slug: "training", name: "Training", viewerMembership: "none" },
      ],
    });
    await expect(departmentsForShell({ kind: "session" })).resolves.toEqual([]);
  });

  it("returns an empty list when the viewer has no departments", async () => {
    readIndex.mockResolvedValue({ kind: "ok", data: [] });
    await expect(departmentsForShell({ kind: "session" })).resolves.toEqual([]);
  });

  it("returns an empty list without throwing when the read fails", async () => {
    for (const kind of ["error", "forbidden", "unauthenticated", "not_found"] as const) {
      readIndex.mockResolvedValueOnce({ kind, error: new Error("db down") });
      await expect(departmentsForShell({ kind })).resolves.toEqual([]);
    }
    readIndex.mockRejectedValueOnce(new Error("boom"));
    await expect(departmentsForShell({ kind: "thrown" })).resolves.toEqual([]);
  });
});
