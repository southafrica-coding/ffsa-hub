import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));

import { generateWeeklyFeedbackLinks } from "./feedback-links";

// A fake database that remembers links, so running twice can be checked.
type Row = Record<string, unknown>;
let links: Row[];
let calls: string[];

function fakeDb() {
  return {
    from(table: string) {
      calls.push(table);
      let op = "select";
      let payload: Row | null = null;
      const filters: Array<[string, unknown]> = [];
      const b: Record<string, unknown> = {};
      const chain = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => (fn(...a), b);
      b.select = chain(() => {});
      b.insert = chain((p) => ((op = "insert"), (payload = p as Row)));
      b.update = chain((p) => ((op = "update"), (payload = p as Row)));
      b.eq = chain((c, v) => filters.push([c as string, v]));
      b.order = chain(() => {});
      const run = () => {
        if (table === "organisations") return { id: "org-missio" };
        if (table === "house_churches") return [1, 2, 3].map((n) => ({ id: `h${n}`, number: n }));
        if (op === "insert") {
          links.push({ id: `l${links.length + 1}`, ...payload });
          return null;
        }
        if (op === "update") return null;
        return links.find((l) => filters.every(([c, v]) => l[c] === v)) ?? null;
      };
      b.maybeSingle = () => Promise.resolve({ data: run(), error: null });
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(resolve);
      return b;
    },
  };
}

const ON = { MISSIO_FEEDBACK_LINKS_ENABLED: "1" } as unknown as NodeJS.ProcessEnv;

beforeEach(() => {
  links = [];
  calls = [];
  process.env.MISSIO_AVAILABILITY_TOKEN_SECRET = "a-test-secret-that-is-long-enough-for-hmac";
});

describe("generateWeeklyFeedbackLinks", () => {
  it("does nothing by default: no database call at all", async () => {
    expect(await generateWeeklyFeedbackLinks(fakeDb(), { env: {} as NodeJS.ProcessEnv })).toEqual({ status: "off", links: [] });
    expect(await generateWeeklyFeedbackLinks(fakeDb(), { env: { MISSIO_FEEDBACK_LINKS_ENABLED: "yes" } as unknown as NodeJS.ProcessEnv })).toMatchObject({ status: "off" });
    expect(calls).toEqual([]);
  });

  it("stays off on a preview even with the flag", async () => {
    const env = { MISSIO_FEEDBACK_LINKS_ENABLED: "1", VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv;
    expect(await generateWeeklyFeedbackLinks(fakeDb(), { env })).toMatchObject({ status: "off" });
    expect(calls).toEqual([]);
  });

  it("when switched on, makes one link per house and is idempotent", async () => {
    const first = await generateWeeklyFeedbackLinks(fakeDb(), { env: ON });
    expect(first.status).toBe("done");
    expect(first.links.map((l) => l.number)).toEqual([1, 2, 3]);
    expect(links).toHaveLength(3);
    const again = await generateWeeklyFeedbackLinks(fakeDb(), { env: ON });
    expect(links).toHaveLength(3);
    expect(again.links.map((l) => l.path)).toEqual(first.links.map((l) => l.path));
  });
});
