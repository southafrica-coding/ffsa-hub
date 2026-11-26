import type { NextLeader, NextLeaderStage, PipelineHouse } from "@/lib/missio/next-leaders";
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

export type Nomination = { contactId: string; houseId: string; trainerContactId?: string | null; note?: string };
export type Move = { stage?: NextLeaderStage; note?: string | null; trainerContactId?: string | null; remove?: true };

export type NextLeadersClient = {
  list(): Promise<{ leaders: NextLeader[]; houses: PipelineHouse[] }>;
  nominate(input: Nomination): Promise<void>;
  move(id: string, change: Move): Promise<void>;
};

export const nextLeadersClient: NextLeadersClient = {
  async list() {
    const body = await call("/api/missio/next-leaders");
    return { leaders: (body.leaders as NextLeader[]) ?? [], houses: (body.houses as PipelineHouse[]) ?? [] };
  },
  async nominate(input) {
    await call("/api/missio/next-leaders", { method: "POST", body: JSON.stringify(input) });
  },
  async move(id, change) {
    await call(`/api/missio/next-leaders/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(change) });
  },
};
