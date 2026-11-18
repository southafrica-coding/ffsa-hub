import { describe, expect, it } from "vitest";
import { createConnectClient } from "./client";
import type { ConnectSubmitBody } from "./types";

const body: ConnectSubmitBody = {
  name: "Lerato Mokoena",
  phone: "0825550142",
  visitType: "first_time",
  wantsHouseChurch: true,
  wantsPrayer: false,
  website: "",
};

function json(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("connect card fetcher", () => {
  it("posts the card and forces the honeypot to an empty string", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createConnectClient(async (input, init) => {
      calls.push({ url: String(input), init });
      return json({ ok: true, echoedName: "Lerato Mokoena" }, 201);
    });
    const result = await client.submit({ ...body, website: "https://spam.example" as "" });
    expect(result).toEqual({ ok: true });
    expect(calls[0]?.url).toBe("/api/missio/connect");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(body);
    expect(JSON.parse(String(calls[0]?.init?.body)).website).toBe("");
  });

  it("keeps field errors and drops the server message on 400", async () => {
    const client = createConnectClient(async () =>
      json(
        {
          error: "RAW SERVER TEXT",
          code: "invalid_input",
          fieldErrors: { phone: "Use a mobile number.", extra: "ignore", name: 12 },
        },
        400
      )
    );
    await expect(client.submit(body)).rejects.toMatchObject({
      status: 400,
      code: "invalid_input",
      message: "",
      fieldErrors: { phone: "Use a mobile number." },
    });
  });

  it("reads Retry-After on 429 and treats 500 as a server error", async () => {
    const limited = createConnectClient(async () =>
      json({ error: "RAW SERVER TEXT", code: "rate_limited" }, 429, { "retry-after": "30" })
    );
    await expect(limited.submit(body)).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
      retryAfterSeconds: 30,
      message: "",
    });

    const failed = createConnectClient(async () => json({ error: "database exploded", code: "server_error" }, 500));
    await expect(failed.submit(body)).rejects.toMatchObject({ status: 500, code: "server_error", message: "" });
  });

  it("maps an unknown code without keeping the server sentence", async () => {
    const client = createConnectClient(async () => json({ error: "RAW SERVER TEXT", code: "mystery" }, 418));
    await expect(client.submit(body)).rejects.toMatchObject({ code: "mystery", message: "" });
  });
});
