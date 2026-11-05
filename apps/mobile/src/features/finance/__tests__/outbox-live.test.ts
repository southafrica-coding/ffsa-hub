// The real outbox wiring (live.ts + store.ts) end to end, with fakes only at
// the edges: fetch (behind the real createApiFetch), NetInfo, the file system
// and Supabase storage. Proves: bearer token on every API call, the website's
// bucket/path/upsert for files, the JSON contract of both POSTs, nothing sent
// offline, the queue on disk, and no double submit on retry.

import { EXPENSE, TEAM, USER, expenseItem, receiptItem } from "../__fixtures__/fixtures";

const mockNet = { isConnected: true as boolean | null, isInternetReachable: true as boolean | null };
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { fetch: async () => mockNet, addEventListener: () => () => {} },
}));

// In-memory expo-file-system (SDK 58 File / Directory / Paths).
const mockFiles = new Map<string, string | Uint8Array>();
jest.mock("expo-file-system", () => {
  const join = (...parts: (string | { uri: string })[]) =>
    parts
      .map((p) => (typeof p === "string" ? p : p.uri))
      .reduce((a, b) => `${a.replace(/\/+$/, "")}/${b.replace(/^\/+/, "")}`);
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(...parts);
    }
    get name() {
      return this.uri.split("/").pop() ?? "";
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    get size() {
      const v = mockFiles.get(this.uri);
      return typeof v === "string" ? v.length : (v?.length ?? 0);
    }
    lastModified = Date.now();
    create() {
      mockFiles.set(this.uri, "");
    }
    delete() {
      mockFiles.delete(this.uri);
    }
    writeSync(s: string) {
      mockFiles.set(this.uri, s);
    }
    async text() {
      return String(mockFiles.get(this.uri) ?? "");
    }
    copySync(dest: File) {
      mockFiles.set(dest.uri, mockFiles.get(this.uri) ?? "");
    }
    moveSync(dest: File) {
      mockFiles.set(dest.uri, mockFiles.get(this.uri) ?? "");
      mockFiles.delete(this.uri);
      this.uri = dest.uri;
    }
    async arrayBuffer() {
      const v = mockFiles.get(this.uri);
      if (v === undefined) throw new Error("missing");
      return (typeof v === "string" ? new TextEncoder().encode(v) : v).buffer;
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(...parts);
    }
    exists = true;
    create() {}
    list() {
      return [...mockFiles.keys()].filter((k) => k.startsWith(`${this.uri}/`)).map((k) => new File(k));
    }
  }
  return { File, Directory, Paths: { document: { uri: "file:///docs" } } };
});

const mockUpload = jest.fn(async (..._args: unknown[]) => ({ data: { path: "x" }, error: null as null | { message: string; status?: number } }));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" }, access_token: "header.payload.sig" } } }) },
    storage: { from: (bucket: string) => ({ upload: (...args: unknown[]) => mockUpload(bucket, ...args) }) },
  },
}));

// The outbox builds its own apiFetch (the real createApiFetch, so a 429's
// Retry-After reaches it); the fake sits at the global fetch it calls.
const mockFetch = jest.fn();
globalThis.fetch = ((...args: unknown[]) => mockFetch(...args)) as typeof fetch;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const savedExpense = { success: true, data: { id: EXPENSE, team_id: TEAM, category_id: "cat-food", expense_date: "2026-11-03", zar_amount: 120.5 } };

beforeEach(() => {
  jest.resetModules();
  mockFiles.clear();
  mockFetch.mockReset();
  mockUpload.mockClear();
  mockNet.isConnected = true;
  mockNet.isInternetReachable = true;
  mockFiles.set("file:///docs/finance-outbox/r-1.jpg", new Uint8Array([0xff, 0xd8, 0xff]));
});

async function load() {
  // A fresh singleton per test (modules are reset in beforeEach).
  return jest.requireActual<typeof import("../outbox/live")>("../outbox/live").getOutbox();
}

describe("outbox, wired to the network", () => {
  it("POSTs the expense with its id and bearer token, uploads the photo the website's way, then registers it", async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url.endsWith("/api/finance/outreach/expenses") ? json(200, savedExpense) : json(200, { success: true, data: { id: "rec-1" } }),
    );
    const outbox = await load();
    await outbox.add(expenseItem(), receiptItem());
    await outbox.process();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [[url1, init1], [url2, init2]] = mockFetch.mock.calls;
    expect(url1).toBe("https://hub.example.test/api/finance/outreach/expenses");
    expect(init1.method).toBe("POST");
    expect(new Headers(init1.headers).get("Authorization")).toBe("Bearer header.payload.sig");
    expect(JSON.parse(init1.body)).toMatchObject({ id: EXPENSE, team_id: TEAM, description: "Bread and milk", zar_amount: 120.5 });

    expect(mockUpload).toHaveBeenCalledWith(
      "outreach-receipts",
      `${TEAM}/${EXPENSE}/1762160000000_receipt.jpg`,
      expect.anything(),
      { contentType: "image/jpeg", upsert: true },
    );

    expect(url2).toBe("https://hub.example.test/api/finance/outreach/receipts");
    expect(new Headers(init2.headers).get("Authorization")).toBe("Bearer header.payload.sig");
    expect(JSON.parse(init2.body)).toEqual({
      expense_id: EXPENSE,
      file_path: `${TEAM}/${EXPENSE}/1762160000000_receipt.jpg`,
      file_name: "receipt.jpg",
      file_size: 245000,
      mime_type: "image/jpeg",
    });

    expect(outbox.getItems()).toEqual([]);
    expect(mockFiles.has("file:///docs/finance-outbox/r-1.jpg")).toBe(false);
    expect(JSON.parse(String(mockFiles.get("file:///docs/finance-outbox/queue.json")))).toEqual({ version: 2, items: [] });
  });

  it("offline: sends nothing and keeps everything on disk", async () => {
    mockNet.isConnected = false;
    const outbox = await load();
    await outbox.add(expenseItem(), receiptItem());
    await outbox.process();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    const onDisk = JSON.parse(String(mockFiles.get("file:///docs/finance-outbox/queue.json")));
    expect(onDisk.version).toBe(2);
    expect(onDisk.items.map((i: { id: string }) => i.id)).toEqual([EXPENSE, "r-1"]);
    expect(mockFiles.has("file:///docs/finance-outbox/r-1.jpg")).toBe(true);
  });

  it("a lost response is retried with the same id; the server's replay answer finishes it (one expense)", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Network request failed")).mockResolvedValueOnce(json(200, { ...savedExpense, replayed: true }));
    const outbox = await load();
    await outbox.add(expenseItem());
    await outbox.process();
    expect(outbox.getItems()[0]).toMatchObject({ status: "waiting", attempts: 1 });

    // (A reconnect straight after a failure no longer re-fires within
    // MIN_WAKE_GAP_MS, so this is the person tapping Retry.)
    await outbox.retry(EXPENSE);
    await outbox.process();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const ids = mockFetch.mock.calls.map(([, init]) => JSON.parse(init.body).id);
    expect(ids).toEqual([EXPENSE, EXPENSE]);
    expect(outbox.getItems()).toEqual([]);
  });

  it("a storage permission error stops and says so plainly", async () => {
    mockUpload.mockResolvedValueOnce({ data: null as never, error: { message: "new row violates row-level security policy", status: 403 } });
    const outbox = await load();
    await outbox.add(receiptItem({ expenseId: "on-server" }));
    await outbox.process();
    expect(outbox.getItems()[0]).toMatchObject({ status: "failed", lastError: expect.stringMatching(/permission/) });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("a storage network error retries later and keeps the photo", async () => {
    mockUpload.mockResolvedValueOnce({ data: null as never, error: { message: "Network request failed" } });
    const outbox = await load();
    await outbox.add(receiptItem({ expenseId: "on-server" }));
    await outbox.process();
    expect(outbox.getItems()[0]).toMatchObject({ status: "waiting", attempts: 1 });
    expect(mockFiles.has("file:///docs/finance-outbox/r-1.jpg")).toBe(true);
  });

  it("a 403 from the API is permanent (the person decides), a 500 retries", async () => {
    mockFetch.mockResolvedValueOnce(json(403, { error: "You don't have permission to add expenses to this team" }));
    const outbox = await load();
    await outbox.add(expenseItem());
    await outbox.process();
    expect(outbox.getItems()[0].status).toBe("failed");

    mockFetch.mockResolvedValueOnce(json(500, { error: "boom" }));
    await outbox.retry(EXPENSE);
    await outbox.process();
    expect(outbox.getItems()[0]).toMatchObject({ status: "waiting", attempts: 1 });
  });

  it("only sends the signed-in person's items", async () => {
    const outbox = await load();
    await outbox.add(expenseItem({ userId: "someone-else" }));
    await outbox.process();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(USER).toBe("user-1");
  });

  it("429 with Retry-After: waits as long as the server asks, even if the connection comes back", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Slow down" }), { status: 429, headers: { "Retry-After": "120" } }));
    const outbox = await load();
    await outbox.add(expenseItem());
    const before = Date.now();
    await outbox.process();
    const item = outbox.getItems()[0];
    expect(item).toMatchObject({ status: "waiting", attempts: 1 });
    expect(item.holdUntil).toBeGreaterThanOrEqual(before + 120_000);
    expect(item.nextAttemptAt).toBeGreaterThanOrEqual(before + 120_000);
    await outbox.wake();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("a damaged queue file is copied aside and reported, never silently emptied", async () => {
    mockFiles.set("file:///docs/finance-outbox/queue.json", "{half a fi");
    const outbox = await load();
    await outbox.init();
    expect(outbox.getProblem()).toBe("corrupt");
    const copies = [...mockFiles.keys()].filter((k) => k.startsWith("file:///docs/finance-outbox/quarantine-"));
    expect(copies).toHaveLength(1);
    expect(mockFiles.get(copies[0])).toBe("{half a fi");
    // The photo next to it is not an orphan to tidy away, nor is the copy.
    expect(mockFiles.has("file:///docs/finance-outbox/r-1.jpg")).toBe(true);
  });

  it("reads the Phase 1 format (a bare array) and sends it", async () => {
    mockFiles.set("file:///docs/finance-outbox/queue.json", JSON.stringify([expenseItem({ status: "sending" })]));
    mockFetch.mockResolvedValue(json(200, savedExpense));
    const outbox = await load();
    await outbox.init();
    expect(outbox.getProblem()).toBeNull();
    expect(outbox.getItems()[0]).toMatchObject({ id: EXPENSE, status: "waiting", maybeSent: true });
    await outbox.process();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(mockFiles.get("file:///docs/finance-outbox/queue.json")))).toEqual({ version: 2, items: [] });
  });
});
