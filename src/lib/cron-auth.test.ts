import { describe, expect, it } from "vitest";
import { cronAuthorized } from "./cron-auth";

const req = (auth?: string) => new Request("http://x", { headers: auth ? { authorization: auth } : {} });
const env = (CRON_SECRET?: string) => ({ CRON_SECRET }) as unknown as NodeJS.ProcessEnv;

describe("cronAuthorized", () => {
  it("refuses everything when CRON_SECRET isn't set", () => {
    expect(cronAuthorized(req(), env())).toBe(false);
    expect(cronAuthorized(req("Bearer "), env(""))).toBe(false);
    expect(cronAuthorized(req("Bearer undefined"), env())).toBe(false);
  });
  it("accepts only the exact bearer secret", () => {
    expect(cronAuthorized(req("Bearer s3cret"), env("s3cret"))).toBe(true);
    expect(cronAuthorized(req("Bearer s3cre"), env("s3cret"))).toBe(false);
    expect(cronAuthorized(req("s3cret"), env("s3cret"))).toBe(false);
    expect(cronAuthorized(req(), env("s3cret"))).toBe(false);
  });
});
