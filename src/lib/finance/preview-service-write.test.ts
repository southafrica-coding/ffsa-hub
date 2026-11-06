import { afterEach, describe, expect, it } from "vitest";
import { guardServiceRoleClient, serviceRoleWriteBlock } from "./preview-service-write";

afterEach(() => {
  delete process.env.VERCEL_ENV;
});

describe("service-role writes on preview", () => {
  it("is open when this is not a preview deployment", () => {
    expect(serviceRoleWriteBlock()).toBeNull();
  });

  it("refuses insert, update, delete and rpc on preview without calling through", async () => {
    process.env.VERCEL_ENV = "preview";
    const calls: string[] = [];
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "maybeSingle", "insert", "update", "upsert", "delete"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push(`${method}:${JSON.stringify(args)}`);
        return builder;
      };
    }
    builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: { id: "org" }, error: null });
    const client = {
      from(table: string) {
        calls.push(`from:${table}`);
        return builder;
      },
      rpc() {
        calls.push("rpc");
        return Promise.resolve({ data: "wrote", error: null });
      },
    };

    const guarded = guardServiceRoleClient(client) as unknown as {
      from: (table: string) => {
        select: (cols: string) => { eq: (col: string, val: string) => { maybeSingle: () => Promise<unknown> } };
        insert: (payload: unknown) => Promise<unknown>;
      };
      rpc: (name: string, args: unknown) => Promise<unknown>;
    };
    const read = await guarded.from("finance_orgs").select("id").eq("key", "npc").maybeSingle();
    expect(read).toEqual({ data: { id: "org" }, error: null });
    expect(calls).toEqual(["from:finance_orgs", 'select:["id"]', 'eq:["key","npc"]', "maybeSingle:[]"]);

    const write = await guarded.from("budgets").insert({ name: "nope" });
    expect(write).toMatchObject({ data: null, error: { code: "preview_writes_disabled" } });
    expect(calls.some((call) => call.startsWith("insert"))).toBe(false);

    const rpc = await guarded.rpc("create_budget_from_template", {});
    expect(rpc).toMatchObject({ error: { code: "preview_writes_disabled" } });
    expect(calls).not.toContain("rpc");
  });
});
