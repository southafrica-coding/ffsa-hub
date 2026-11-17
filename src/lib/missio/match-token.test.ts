import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { missioMatchToken, queryHmac } from "./match-token";

const KEY = "test-service-role-key";

afterEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
});

describe("missio match tokens", () => {
  it("cannot be rebuilt with an unsalted sha256 or without the service-role key", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
    const token = missioMatchToken({
      userId: "user",
      orgId: "org",
      contactId: "contact",
      normalizedValue: "jane@gmail.com",
      nowSeconds: 1_700_000_000,
    });
    const plain = createHash("sha256").update("v1|1700000900|user|org|contact|jane@gmail.com").digest("base64url");
    expect(token).toMatch(/^v1\.1700000900\./);
    expect(token).not.toContain(plain);
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(
      missioMatchToken({
        userId: "user",
        orgId: "org",
        contactId: "contact",
        normalizedValue: "jane@gmail.com",
      })
    ).toBeNull();
    expect(queryHmac("jane@gmail.com")).toBeNull();
  });
});
