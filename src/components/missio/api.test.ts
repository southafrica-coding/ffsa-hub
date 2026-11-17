import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MissioApiError, createMissioClient, missioApi } from "./api";

const here = path.dirname(fileURLToPath(import.meta.url));

type FetchMock = (url: string, init?: RequestInit) => Promise<Response>;

function mockFetch(impl?: FetchMock) {
  return vi.fn<FetchMock>(impl ?? (async () => jsonResponse({})));
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("missio client", () => {
  it("reads the viewer from /api/missio/me and turns 403 into no pastor role", async () => {
    const fetchMock = mockFetch(async (url) => {
      expect(url).toBe(missioApi.me);
      return jsonResponse({ error: "forbidden" }, 403);
    });
    const client = createMissioClient(fetchMock as unknown as typeof fetch);
    await expect(client.getMe()).rejects.toMatchObject({ status: 403, message: "No Missio pastor role" });
  });

  it("lists people with campus, status, name search and paging", async () => {
    const fetchMock = mockFetch(async () => jsonResponse({ rows: [], total: 0 }));
    const client = createMissioClient(fetchMock as unknown as typeof fetch);
    await client.listPeople({ campus: "jhb", status: "visitor", q: "Lerato", limit: 50, offset: 0 });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url.startsWith(`${missioApi.people}?`)).toBe(true);
    expect(url).toContain("campus=jhb");
    expect(url).toContain("status=visitor");
    expect(url).toContain("q=Lerato");
    expect(url).toContain("limit=50");
    expect(url).not.toContain("/api/contacts");
  });

  it("rejects a name before calling contact search", async () => {
    const fetchMock = mockFetch();
    const client = createMissioClient(fetchMock as unknown as typeof fetch);
    await expect(client.searchContacts("Mina Osei")).rejects.toBeInstanceOf(MissioApiError);
    await expect(client.searchContacts("Mina Osei")).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("searches contacts by email on the Missio route only", async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse({
        matches: [
          {
            matchToken: "tok-1",
            maskedName: "M••• O•••",
            maskedEmail: "m•••@example.com",
            maskedPhone: "••• 4412",
            alreadyInOrg: false,
          },
        ],
      })
    );
    const client = createMissioClient(fetchMock as unknown as typeof fetch);
    const result = await client.searchContacts("mina.osei@example.com");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/missio/contacts/search");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("mina.osei");
    const init = fetchMock.mock.calls[0][1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ q: "mina.osei@example.com" });
    expect(result.matches[0].alreadyInOrg).toBe(false);
    expect(result.matches[0].matchToken).toBe("tok-1");
    expect(result.matches[0]).not.toHaveProperty("contactId");
  });

  it("posts a matched contact without a label and surfaces 409 and linkedExisting", async () => {
    const fetchMock = mockFetch()
      .mockResolvedValueOnce(jsonResponse({ person: { id: "p1" }, linkedExisting: true }, 201))
      .mockResolvedValueOnce(jsonResponse({ error: "conflict" }, 409));
    const client = createMissioClient(fetchMock as unknown as typeof fetch);
    const created = await client.createPerson({
      matchToken: "tok-1",
      matchedBy: { email: "mina.osei@example.com" },
      campus: "jhb",
    });
    expect(created.linkedExisting).toBe(true);
    const init = fetchMock.mock.calls[0][1];
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      matchToken: "tok-1",
      matchedBy: { email: "mina.osei@example.com" },
      campus: "jhb",
    });
    expect(body).not.toHaveProperty("label");
    expect(body).not.toHaveProperty("contactId");
    await expect(
      client.createPerson({ name: "Mina Osei", email: "mina.osei@example.com" })
    ).rejects.toMatchObject({ status: 409, code: "already_in_org", message: "Already in Missio" });
  });

  it("uses the 409 error text and code, and treats exists_use_search as its own case", async () => {
    const fetchMock = mockFetch()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: "This person already exists. Search by their email or phone to add them.",
            code: "exists_use_search",
          },
          409,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ error: "Already in Missio", code: "already_in_org" }, 409));
    const client = createMissioClient(fetchMock as unknown as typeof fetch);
    await expect(client.createPerson({ name: "Mina Osei", email: "mina.osei@example.com" })).rejects.toMatchObject({
      status: 409,
      code: "exists_use_search",
      message: "This person is already in FFSA's contacts. Search for them and pick Use this contact.",
    });
    await expect(
      client.createPerson({ matchToken: "tok-1", matchedBy: { email: "mina.osei@example.com" } }),
    ).rejects.toMatchObject({
      status: 409,
      code: "already_in_org",
      message: "Already in Missio",
    });
  });

  it("reads Retry-After when creating a person is rate limited", async () => {
    const fetchMock = mockFetch(async () => jsonResponse({ error: "slow down" }, 429, { "retry-after": "12" }));
    const client = createMissioClient(fetchMock as unknown as typeof fetch);
    await expect(client.createPerson({ name: "Mina Osei", email: "mina.osei@example.com" })).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 12,
      message: "Too many searches, try again in 12 seconds",
    });
  });

  it("reads Retry-After on a 429 and keeps at most five matches", async () => {
    const matches = Array.from({ length: 6 }, (_, index) => ({
      matchToken: `tok-${index}`,
      maskedName: "A•••",
      maskedEmail: null,
      maskedPhone: null,
      alreadyInOrg: false,
    }));
    const fetchMock = mockFetch()
      .mockResolvedValueOnce(jsonResponse({ error: "slow down" }, 429, { "retry-after": "20" }))
      .mockResolvedValueOnce(jsonResponse({ matches }));
    const client = createMissioClient(fetchMock as unknown as typeof fetch);
    await expect(client.searchContacts("mina.osei@example.com")).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 20,
      message: "Too many searches, try again in 20 seconds",
    });
    const result = await client.searchContacts("0825550199");
    expect(result.matches).toHaveLength(5);
  });

  it("maps a missing person on PATCH to 404", async () => {
    const fetchMock = mockFetch(async () => jsonResponse({ error: "missing" }, 404));
    const client = createMissioClient(fetchMock as unknown as typeof fetch);
    await expect(client.updatePerson("missing", { status: "inactive" })).rejects.toMatchObject({
      status: 404,
      message: "This person couldn’t be found",
    });
  });

  it("patches campus and status and never sends a delete", async () => {
    const fetchMock = mockFetch(async () => jsonResponse({ person: { id: "p1" } }));
    const client = createMissioClient(fetchMock as unknown as typeof fetch);
    await client.updatePerson("p1", { status: "inactive" });
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/missio/people/p1");
    const init = fetchMock.mock.calls[0][1];
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ status: "inactive" });
  });
});

describe("missio ui stays off the FFSA contacts API", () => {
  it("does not reference FFSA contact or label endpoints", () => {
    const roots = [here, path.resolve(here, "../../app/missio")];
    const files = roots.flatMap((root) => walk(root));
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toMatch(/\/api\/contacts\b/);
    expect(source).not.toMatch(/\/api\/labels\b/);
    expect(source).not.toMatch(/services\/contacts/);
    expect(source).toContain("/api/missio/contacts/search");
    expect(source).toContain("/api/missio/people");
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) return [full];
    return [];
  });
}
