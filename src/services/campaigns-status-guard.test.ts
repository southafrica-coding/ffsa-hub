import { describe, expect, it } from "vitest";
import { deleteCampaign, updateCampaign } from "@/services/campaigns";

function recorder(row: { id: string } | null = { id: "c1" }) {
  const filters: Array<{ op: string; args: unknown[] }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {
    update(payload: unknown) {
      filters.push({ op: "update", args: [payload] });
      return b;
    },
    delete() {
      filters.push({ op: "delete", args: [] });
      return b;
    },
    eq(...args: unknown[]) {
      filters.push({ op: "eq", args });
      return b;
    },
    in(...args: unknown[]) {
      filters.push({ op: "in", args });
      return b;
    },
    select() {
      return b;
    },
    maybeSingle() {
      return Promise.resolve({ data: row, error: null });
    },
  };
  return { client: { from: () => b }, filters };
}

describe("campaign writes conditioned on status", () => {
  it("updateCampaign limits the write to the given statuses", async () => {
    const rec = recorder();
    const { data, error } = await updateCampaign(
      rec.client,
      "c1",
      { subject: "Hi" },
      { onlyStatuses: ["draft", "scheduled"] }
    );
    expect(error).toBeNull();
    expect(data).toEqual({ id: "c1" });
    expect(rec.filters).toContainEqual({ op: "eq", args: ["id", "c1"] });
    expect(rec.filters).toContainEqual({
      op: "in",
      args: ["status", ["draft", "scheduled"]],
    });
  });

  it("updateCampaign reports zero rows instead of throwing", async () => {
    const rec = recorder(null);
    const { data, error } = await updateCampaign(rec.client, "c1", { subject: "Hi" }, {
      onlyStatuses: ["draft", "scheduled"],
    });
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("deleteCampaign limits the delete to the given statuses", async () => {
    const rec = recorder();
    await deleteCampaign(rec.client, "c1", { onlyStatuses: ["scheduled"] });
    expect(rec.filters).toContainEqual({ op: "eq", args: ["id", "c1"] });
    expect(rec.filters).toContainEqual({ op: "in", args: ["status", ["scheduled"]] });
  });
});
