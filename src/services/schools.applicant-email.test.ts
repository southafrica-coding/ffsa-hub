import { describe, expect, it } from "vitest";
import { createFakeSupabase, filterValue } from "@/lib/testing/fake-supabase";
import { getResponseByEmailAndProgram } from "./schools";

describe("getResponseByEmailAndProgram", () => {
  it("matches a mixed-case stored email literally, including underscores", async () => {
    const fake = createFakeSupabase({
      resolve: () => ({ data: { id: "app-1", status: "submitted" } }),
    });
    const { data } = await getResponseByEmailAndProgram(fake.client, "Ada_Smith@Example.com", "p1");
    expect(data).toEqual({ id: "app-1", status: "submitted" });
    const query = fake.queries.find((q) => q.table === "application_responses");
    expect(filterValue(query!, "ilike", "applicant_email")).toBe("ada\\_smith@example.com");
    expect(query!.filters.some((f) => f.op === "eq" && f.args[0] === "applicant_email")).toBe(false);
  });

  it("does not query when the address contains a PostgREST * wildcard", async () => {
    const fake = createFakeSupabase({
      resolve: () => ({ data: { id: "should-not-run", status: "submitted" } }),
    });
    await expect(getResponseByEmailAndProgram(fake.client, "a*@gmail.com", "p1")).rejects.toThrow(/wildcard/i);
    expect(fake.queries).toHaveLength(0);
  });
});
