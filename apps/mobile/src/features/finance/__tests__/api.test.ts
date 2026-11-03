import { ApiError, type ApiFetch } from "@/lib/api";

import {
  classify,
  createExpense,
  deleteExpense,
  deleteReceipt,
  exchangeRateToZar,
  listReceipts,
  registerReceipt,
  updateExpense,
  userMessage,
} from "../api";
import { strings } from "../strings";
import { EXPENSE, TEAM, payload } from "../__fixtures__/fixtures";

// apiFetch is mocked: these pin the contract with the website's routes
// (path, method, body, response schema) without a network.
function mockFetch(response: unknown) {
  const fn = jest.fn(async (_path: string, init?: { schema?: { parse: (v: unknown) => unknown } }) =>
    init?.schema ? init.schema.parse(response) : response,
  );
  return fn as unknown as ApiFetch & jest.Mock;
}

const row = { id: EXPENSE, team_id: TEAM, category_id: "cat-food", expense_date: "2026-11-03", zar_amount: "120.50", description: "Bread" };

describe("expenses (always through the API, so the cash alert fires)", () => {
  it("POSTs the payload with the app's id", async () => {
    const f = mockFetch({ success: true, data: row });
    const res = await createExpense(f, EXPENSE, payload);
    expect(f).toHaveBeenCalledWith("/api/finance/outreach/expenses", expect.objectContaining({ method: "POST", body: { id: EXPENSE, ...payload } }));
    expect(res.data.zar_amount).toBe(120.5);
  });

  it("accepts the server's replay answer for a retried save", async () => {
    const res = await createExpense(mockFetch({ success: true, data: row, replayed: true }), EXPENSE, payload);
    expect(res.replayed).toBe(true);
  });

  it("PUTs an edit with the id in the body (as the website does)", async () => {
    const f = mockFetch({ success: true, data: row });
    await updateExpense(f, EXPENSE, payload);
    expect(f).toHaveBeenCalledWith("/api/finance/outreach/expenses", expect.objectContaining({ method: "PUT", body: { id: EXPENSE, ...payload } }));
  });

  it("DELETEs by id in the query string", async () => {
    const f = mockFetch({ success: true });
    await deleteExpense(f, "a b");
    expect(f).toHaveBeenCalledWith("/api/finance/outreach/expenses?id=a%20b", expect.objectContaining({ method: "DELETE" }));
  });

  it("rejects a response that isn't the website's shape", async () => {
    await expect(createExpense(mockFetch({ ok: 1 }), EXPENSE, payload)).rejects.toThrow();
  });
});

describe("receipts", () => {
  it("lists an expense's receipts with their signed URLs", async () => {
    const f = mockFetch({
      data: [{ id: "r1", expense_id: EXPENSE, file_path: "t/e/1_a.jpg", file_name: "a.jpg", file_size: 10, mime_type: "image/jpeg", uploaded_at: "2026-11-03", signed_url: "https://x" }],
    });
    const list = await listReceipts(f, EXPENSE);
    expect(f.mock.calls[0][0]).toBe(`/api/finance/outreach/receipts?expense_id=${EXPENSE}`);
    expect(list[0].signed_url).toBe("https://x");
  });

  it("treats a missing list as empty", async () => {
    expect(await listReceipts(mockFetch({ data: null }), EXPENSE)).toEqual([]);
  });

  it("registers an uploaded file with exactly the website's fields", async () => {
    const f = mockFetch({ success: true, data: {} });
    const r = { expense_id: EXPENSE, file_path: "t/e/1_a.jpg", file_name: "a.jpg", file_size: 10, mime_type: "image/jpeg" };
    await registerReceipt(f, r);
    expect(f).toHaveBeenCalledWith("/api/finance/outreach/receipts", expect.objectContaining({ method: "POST", body: r }));
  });

  it("deletes by id only (the server takes the file path from the row, never the request)", async () => {
    const f = mockFetch({ success: true });
    await deleteReceipt(f, "r1");
    expect(f.mock.calls[0][0]).toBe("/api/finance/outreach/receipts?id=r1");
  });
});

describe("exchange rate", () => {
  it("asks the website for 1 unit in rand", async () => {
    const f = mockFetch({ rate: 18.5, from: "USD", to: "ZAR" });
    expect(await exchangeRateToZar(f, "USD")).toBe(18.5);
    expect(f.mock.calls[0][0]).toBe("/api/finance/outreach/exchange-rate?from=USD&to=ZAR");
  });
});

describe("classify / userMessage", () => {
  it("retries network trouble, timeouts and 5xx by itself", () => {
    expect(classify(new ApiError("network", "x")).permanent).toBe(false);
    expect(classify(new ApiError("timeout", "x")).permanent).toBe(false);
    expect(classify(new ApiError("http", "x", 502)).permanent).toBe(false);
    expect(classify(new TypeError("Network request failed")).permanent).toBe(false);
  });

  it("stops on permission and bad-data answers", () => {
    expect(classify(new ApiError("forbidden", "x", 403)).permanent).toBe(true);
    expect(classify(new ApiError("http", "x", 400)).permanent).toBe(true);
    expect(classify(new ApiError("invalid_response", "x", 200)).permanent).toBe(true);
  });

  it("waits out a sign-out rather than giving up", () => {
    expect(classify(new ApiError("unauthenticated", "x", 401)).permanent).toBe(false);
  });

  it("explains a 403 as access, with a next step", () => {
    expect(userMessage(new ApiError("forbidden", "You don't have access to this.", 403))).toBe(strings.common.forbidden);
  });

  it("says what to do about a 400", () => {
    expect(userMessage(new ApiError("http", "x", 400))).toMatch(/Check the form/);
  });
});
