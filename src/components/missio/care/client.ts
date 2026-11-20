import type { CareNeed, CarePrivacy, CareRequest } from "@/lib/missio/care";
import { MissioApiError } from "../api";

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}) },
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (!res.ok) {
    const code = typeof body.code === "string" ? body.code : "server_error";
    throw new MissioApiError(res.status, "", null, code as never);
  }
  return body;
}

export type CareLog = { name?: string; phone?: string; needs: CareNeed[]; body: string; privacy: CarePrivacy; urgent: boolean };

export type CareClient = {
  list(): Promise<{ requests: CareRequest[]; me: string }>;
  step(id: string, action: "take" | "done" | "reopen" | "checked_in", note?: string): Promise<void>;
  log(input: CareLog): Promise<void>;
};

export const careClient: CareClient = {
  async list() {
    const body = await call("/api/missio/care");
    return { requests: (body.requests as CareRequest[]) ?? [], me: typeof body.me === "string" ? body.me : "" };
  },
  async step(id, action, note) {
    await call(`/api/missio/care/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ action, ...(note ? { note } : {}) }) });
  },
  async log(input) {
    await call("/api/missio/care", { method: "POST", body: JSON.stringify(input) });
  },
};
