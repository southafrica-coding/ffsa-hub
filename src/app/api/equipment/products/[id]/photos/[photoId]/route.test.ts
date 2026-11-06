import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "mgr" } as { id: string } | null,
  canManage: true,
  photo: {
    id: "ph1",
    product_id: "prod1",
    file_path: "prod1/old.jpg",
    alt: "Shure SM58",
    sort_order: 2,
    created_at: "2026-01-01T00:00:00Z",
  } as Record<string, unknown> | null,
  lookupError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  uploads: [] as { bucket: string; path: string; upsert: boolean }[],
  removed: [] as string[][],
  updates: [] as { id: string; data: Record<string, unknown> }[],
  deleted: [] as string[],
  uploadError: null as { message: string } | null,
  removeFails: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _body: Buffer, opts: { upsert?: boolean }) => {
          state.uploads.push({ bucket, path, upsert: !!opts?.upsert });
          return { data: state.uploadError ? null : { path }, error: state.uploadError };
        },
        remove: async (paths: string[]) => {
          state.removed.push(paths);
          const failed = paths.find((p) => state.removeFails.includes(p));
          return { data: failed ? null : paths, error: failed ? { message: "storage down" } : null };
        },
      }),
    },
  }),
}));

vi.mock("@/services/equipment", () => ({
  getEquipmentAccess: async () => ({ canManage: state.canManage }),
  getProductPhoto: async () => ({ data: state.photo, error: state.lookupError }),
  updateProductPhoto: async (_sb: unknown, id: string, data: Record<string, unknown>) => {
    state.updates.push({ id, data });
    if (state.updateError || !state.photo) return { data: null, error: state.updateError };
    return { data: { ...state.photo, ...data }, error: null };
  },
  deleteProductPhoto: async (_sb: unknown, id: string) => {
    state.deleted.push(id);
    return { data: state.photo, error: null };
  },
}));

import { DELETE, PATCH } from "./route";

const params = () => Promise.resolve({ id: "prod1", photoId: "ph1" });

function jpeg(name = "mic.jpg") {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type: "image/jpeg" });
}

function patch(file?: File, alt?: string) {
  const form = new FormData();
  if (file) form.append("file", file);
  if (alt !== undefined) form.append("alt", alt);
  return PATCH(new Request("http://x/api/equipment/products/prod1/photos/ph1", { method: "PATCH", body: form }), {
    params: params(),
  });
}

describe("PATCH /api/equipment/products/[id]/photos/[photoId]", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    state.user = { id: "mgr" };
    state.canManage = true;
    state.photo = {
      id: "ph1",
      product_id: "prod1",
      file_path: "prod1/old.jpg",
      alt: "Shure SM58",
      sort_order: 2,
      created_at: "2026-01-01T00:00:00Z",
    };
    state.lookupError = null;
    state.updateError = null;
    state.uploads = [];
    state.removed = [];
    state.updates = [];
    state.deleted = [];
    state.uploadError = null;
    state.removeFails = [];
  });

  it("replaces the file, keeps sort order, and deletes the old object", async () => {
    const res = await patch(jpeg());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(state.uploads).toHaveLength(1);
    expect(state.uploads[0].bucket).toBe("equipment-photos");
    expect(state.uploads[0].upsert).toBe(false);
    expect(state.uploads[0].path).toMatch(/^prod1\/\d+-\d+\.jpg$/);
    expect(state.updates).toEqual([{ id: "ph1", data: { file_path: state.uploads[0].path } }]);
    expect(state.removed).toEqual([["prod1/old.jpg"]]);
    expect(body.photo.id).toBe("ph1");
    expect(body.photo.sort_order).toBe(2);
    expect(body.photo.alt).toBe("Shure SM58");
    expect(body.photo.url).toContain(encodeURIComponent(state.uploads[0].path.split("/").pop()!));
    expect(state.deleted).toEqual([]);
  });

  it("updates alt when the form collected one", async () => {
    const res = await patch(jpeg(), "  Front of the mic  ");
    expect(res.status).toBe(200);
    expect(state.updates[0].data).toEqual({
      file_path: state.uploads[0].path,
      alt: "Front of the mic",
    });
    expect(state.updates[0].data).not.toHaveProperty("sort_order");
  });

  it("refuses anyone who cannot manage listings", async () => {
    state.canManage = false;
    expect((await patch(jpeg())).status).toBe(403);
    state.user = null;
    expect((await patch(jpeg())).status).toBe(401);
    expect(state.uploads).toEqual([]);
    expect(state.updates).toEqual([]);
    expect(state.removed).toEqual([]);
  });

  it("does not write a file for a missing or foreign photo", async () => {
    state.photo = null;
    expect((await patch(jpeg())).status).toBe(404);
    state.photo = {
      id: "ph1",
      product_id: "other",
      file_path: "other/old.jpg",
      alt: null,
      sort_order: 0,
      created_at: "2026-01-01T00:00:00Z",
    };
    expect((await patch(jpeg())).status).toBe(404);
    expect(state.uploads).toEqual([]);
    expect(state.updates).toEqual([]);
  });

  it("rejects a file that is not a listing photo", async () => {
    const res = await patch(new File(["hi"], "notes.txt", { type: "text/plain" }));
    expect(res.status).toBe(400);
    expect(state.uploads).toEqual([]);
    expect(state.updates).toEqual([]);
  });

  it("removes the new object when the row update fails", async () => {
    state.updateError = { message: "row locked" };
    const res = await patch(jpeg());
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "row locked" });
    expect(state.removed).toEqual([[state.uploads[0].path]]);
    expect(state.removed.flat()).not.toContain("prod1/old.jpg");
  });

  it("reports a storage orphan when the old object cannot be removed", async () => {
    state.removeFails = ["prod1/old.jpg"];
    const res = await patch(jpeg());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/previous file/);
    expect(body.photo.file_path).toBe(state.uploads[0].path);
    expect(body.photo.sort_order).toBe(2);
    expect(state.removed).toEqual([["prod1/old.jpg"]]);
  });
});

describe("DELETE /api/equipment/products/[id]/photos/[photoId]", () => {
  beforeEach(() => {
    state.user = { id: "mgr" };
    state.canManage = true;
    state.photo = {
      id: "ph1",
      product_id: "prod1",
      file_path: "prod1/old.jpg",
      alt: "Shure SM58",
      sort_order: 2,
      created_at: "2026-01-01T00:00:00Z",
    };
    state.removed = [];
    state.deleted = [];
    state.uploads = [];
  });

  it("still removes the row and the storage object", async () => {
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), { params: params() });
    expect(res.status).toBe(200);
    expect(state.deleted).toEqual(["ph1"]);
    expect(state.removed).toEqual([["prod1/old.jpg"]]);
    expect(state.uploads).toEqual([]);
  });

  it("stays closed to people who cannot manage listings", async () => {
    state.canManage = false;
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), { params: params() });
    expect(res.status).toBe(403);
    expect(state.deleted).toEqual([]);
  });
});
