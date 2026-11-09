import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "mgr" } as { id: string } | null,
  canManage: true,
  product: { id: "prod1", name: "SM58" } as { id: string; name: string } | null,
  existing: [] as { id: string }[],
  uploads: [] as { bucket: string; path: string }[],
  removed: [] as string[][],
  inserted: [] as Record<string, unknown>[],
  insertError: null as { message: string } | null,
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
        upload: async (path: string) => {
          state.uploads.push({ bucket, path });
          return { data: { path }, error: null };
        },
        remove: async (paths: string[]) => {
          state.removed.push(paths);
          return { data: paths, error: null };
        },
      }),
    },
  }),
}));

vi.mock("@/services/equipment", () => ({
  getEquipmentAccess: async () => ({ canManage: state.canManage }),
  getProductById: async () => ({ data: state.product, error: null }),
  listProductPhotos: async () => ({ data: state.existing, error: null }),
  insertProductPhoto: async (_sb: unknown, data: Record<string, unknown>) => {
    state.inserted.push(data);
    if (state.insertError) return { data: null, error: state.insertError };
    return { data: { id: "ph-new", sort_order: data.sort_order, ...data }, error: null };
  },
}));

import { POST } from "./route";

function call(file?: File) {
  const form = new FormData();
  if (file) form.append("file", file);
  return POST(new Request("http://x/api/equipment/products/prod1/photos", { method: "POST", body: form }), {
    params: Promise.resolve({ id: "prod1" }),
  });
}

describe("POST /api/equipment/products/[id]/photos", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    state.user = { id: "mgr" };
    state.canManage = true;
    state.product = { id: "prod1", name: "SM58" };
    state.existing = [{ id: "ph1" }];
    state.uploads = [];
    state.removed = [];
    state.inserted = [];
    state.insertError = null;
  });

  it("still adds a photo and leaves existing files in place", async () => {
    const res = await call(new File([new Uint8Array([1, 2, 3])], "mic.jpg", { type: "image/jpeg" }));
    expect(res.status).toBe(200);
    expect(state.uploads).toHaveLength(1);
    expect(state.uploads[0].bucket).toBe("equipment-photos");
    expect(state.inserted).toEqual([
      {
        product_id: "prod1",
        file_path: state.uploads[0].path,
        alt: "SM58",
        sort_order: 1,
      },
    ]);
    expect(state.removed).toEqual([]);
    const body = await res.json();
    expect(body.photo.id).toBe("ph-new");
    expect(body.photo.url).toContain("equipment-photos");
  });

  it("stays closed to people who cannot manage listings", async () => {
    state.canManage = false;
    expect((await call(new File(["x"], "mic.jpg", { type: "image/jpeg" }))).status).toBe(403);
    state.user = null;
    expect((await call(new File(["x"], "mic.jpg", { type: "image/jpeg" }))).status).toBe(401);
    expect(state.uploads).toEqual([]);
    expect(state.inserted).toEqual([]);
  });

  it("does not store a file that fails the photo rules", async () => {
    const res = await call(new File(["x"], "mic.gif", { type: "image/gif" }));
    expect(res.status).toBe(400);
    expect(state.uploads).toEqual([]);
  });

  it("removes the new object if the row insert fails", async () => {
    state.insertError = { message: "insert failed" };
    const res = await call(new File([new Uint8Array([1])], "mic.png", { type: "image/png" }));
    expect(res.status).toBe(500);
    expect(state.removed).toEqual([[state.uploads[0].path]]);
  });
});
