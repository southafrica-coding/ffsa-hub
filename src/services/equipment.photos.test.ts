import { describe, expect, it } from "vitest";
import { getProductPhoto, updateProductPhoto } from "@/services/equipment";

function capture() {
  const ops: { method: string; args: unknown[] }[] = [];
  const q: Record<string, (...args: unknown[]) => unknown> = {};
  const chain = (method: string) => (...args: unknown[]) => {
    ops.push({ method, args });
    return q;
  };
  q.update = chain("update");
  q.delete = chain("delete");
  q.insert = chain("insert");
  q.select = chain("select");
  q.eq = chain("eq");
  q.maybeSingle = async () => ({
    data: { id: "ph", sort_order: 4, alt: "kept", file_path: "prod/new.jpg" },
    error: null,
  });
  return { ops, client: { from: () => q } };
}

describe("updateProductPhoto", () => {
  it("writes the new file path and leaves sort order alone", async () => {
    const db = capture();
    await updateProductPhoto(db.client, "ph", { file_path: "prod/new.jpg" });
    expect(db.ops).toEqual([
      { method: "update", args: [{ file_path: "prod/new.jpg" }] },
      { method: "eq", args: ["id", "ph"] },
      { method: "select", args: [] },
    ]);
  });

  it("writes alt only when the caller collected one", async () => {
    const db = capture();
    await updateProductPhoto(db.client, "ph", { file_path: "prod/new.jpg", alt: null });
    expect(db.ops[0]).toEqual({ method: "update", args: [{ file_path: "prod/new.jpg", alt: null }] });
  });

  it("loads one photo row by id", async () => {
    const db = capture();
    await getProductPhoto(db.client, "ph");
    expect(db.ops).toEqual([
      { method: "select", args: ["*"] },
      { method: "eq", args: ["id", "ph"] },
    ]);
  });
});
