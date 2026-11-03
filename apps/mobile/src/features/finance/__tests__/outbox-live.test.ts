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

const mockFetch = jest.fn();
jest.mock("@/lib/api-client", () => {
  const { createApiFetch } = jest.requireActual("@/lib/api");
  return {
    apiFetch: createApiFetch({
      baseUrl: "https://hub.example.test",
      getAccessToken: async () => "header.payload.sig",
      onAuthFailure: () => {},
      fetchImpl: (...args: unknown[]) => mockFetch(...args),
    }),
  };
});

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

function load() {
  // A fresh singleton per test.
  return (require("../outbox/live") as typeof import("../outbox/live")).getOutbox();
}

describe("outbox, wired to the network", () => {
  it("POSTs the expense with its id and bearer token, uploads the photo the website's way, then registers it", async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url.endsWith("/api/finance/outreach/expenses") ? json(200, savedExpense) : json(200, { success: true, data: { id: "rec-1" } }),
    );
    const outbox = load();
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
    expect(JSON.parse(String(mockFiles.get("file:///docs/finance-outbox/queue.json")))).toEqual([]);
  });

  it("offline: sends nothing and keeps everything on disk", async () => {
    mockNet.isConnected = false;
    const outbox = load();
    await outbox.add(expenseItem(), receiptItem());
    await outbox.process();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    const onDisk = JSON.parse(String(mockFiles.get("file:///docs/finance-outbox/queue.json")));
    expect(onDisk.map((i: { id: string }) => i.id)).toEqual([EXPENSE, "r-1"]);
    expect(mockFiles.has("file:///docs/finance-outbox/r-1.jpg")).toBe(true);
  });

  it("a lost response is retried with the same id; the server's replay answer finishes it (one expense)", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Network request failed")).mockResolvedValueOnce(json(200, { ...savedExpense, replayed: true }));
    const outbox = load();
    await outbox.add(expenseItem());
    await outbox.process();
    expect(outbox.getItems()[0]).toMatchObject({ status: "waiting", attempts: 1 });

    await outbox.wake();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const ids = mockFetch.mock.calls.map(([, init]) => JSON.parse(init.body).id);
    expect(ids).toEqual([EXPENSE, EXPENSE]);
    expect(outbox.getItems()).toEqual([]);
  });

  it("a storage permission error stops and says so plainly", async () => {
    mockUpload.mockResolvedValueOnce({ data: null as never, error: { message: "new row violates row-level security policy", status: 403 } });
    const outbox = load();
    await outbox.add(receiptItem({ expenseId: "on-server" }));
    await outbox.process();
    expect(outbox.getItems()[0]).toMatchObject({ status: "failed", lastError: expect.stringMatching(/permission/) });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("a storage network error retries later and keeps the photo", async () => {
    mockUpload.mockResolvedValueOnce({ data: null as never, error: { message: "Network request failed" } });
    const outbox = load();
    await outbox.add(receiptItem({ expenseId: "on-server" }));
    await outbox.process();
    expect(outbox.getItems()[0]).toMatchObject({ status: "waiting", attempts: 1 });
    expect(mockFiles.has("file:///docs/finance-outbox/r-1.jpg")).toBe(true);
  });

  it("a 403 from the API is permanent (the person decides), a 500 retries", async () => {
    mockFetch.mockResolvedValueOnce(json(403, { error: "You don't have permission to add expenses to this team" }));
    const outbox = load();
    await outbox.add(expenseItem());
    await outbox.process();
    expect(outbox.getItems()[0].status).toBe("failed");

    mockFetch.mockResolvedValueOnce(json(500, { error: "boom" }));
    await outbox.retry(EXPENSE);
    await outbox.process();
    expect(outbox.getItems()[0]).toMatchObject({ status: "waiting", attempts: 1 });
  });

  it("only sends the signed-in person's items", async () => {
    const outbox = load();
    await outbox.add(expenseItem({ userId: "someone-else" }));
    await outbox.process();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(USER).toBe("user-1");
  });
});
