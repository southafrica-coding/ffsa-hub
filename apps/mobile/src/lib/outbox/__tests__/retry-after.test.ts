import { retryAfterRecorder } from "../retry-after";

const res = (status: number, headers: Record<string, string> = {}) => new Response("{}", { status, headers });

describe("Retry-After recorder", () => {
  it("remembers a 429/503 Retry-After once, and forgets it on the next request", async () => {
    const base = jest.fn().mockResolvedValueOnce(res(429, { "Retry-After": "20" })).mockResolvedValueOnce(res(200));
    const r = retryAfterRecorder(base, () => 0);
    expect((await r.fetchImpl("https://x.test/a")).status).toBe(429);
    expect(r.take()).toBe(20_000);
    expect(r.take()).toBeNull();
    await r.fetchImpl("https://x.test/b");
    expect(r.take()).toBeNull();
  });

  it("ignores Retry-After on other statuses, and a 503 without one", async () => {
    const base = jest.fn().mockResolvedValueOnce(res(500, { "Retry-After": "5" })).mockResolvedValueOnce(res(503));
    const r = retryAfterRecorder(base);
    await r.fetchImpl("https://x.test/a");
    expect(r.take()).toBeNull();
    await r.fetchImpl("https://x.test/a");
    expect(r.take()).toBeNull();
  });

  it("passes the request through unchanged", async () => {
    const base = jest.fn().mockResolvedValue(res(200));
    const r = retryAfterRecorder(base);
    const init = { method: "POST" };
    await r.fetchImpl("https://x.test/a", init);
    expect(base).toHaveBeenCalledWith("https://x.test/a", init);
  });
});
