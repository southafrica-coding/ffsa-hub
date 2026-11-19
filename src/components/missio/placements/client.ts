import type { PlacementView } from "@/lib/missio/placements";
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

export type PlacementsClient = {
  list(): Promise<{ placements: PlacementView[]; canPlace: boolean }>;
  create(contactId: string, houseId: string): Promise<PlacementView>;
  step(id: string, step: "said_hi" | "first_visit" | "joined" | "cancel"): Promise<PlacementView>;
};

export const placementsClient: PlacementsClient = {
  async list() {
    const body = await call("/api/missio/placements");
    return { placements: (body.placements as PlacementView[]) ?? [], canPlace: body.canPlace === true };
  },
  async create(contactId, houseId) {
    const body = await call("/api/missio/placements", { method: "POST", body: JSON.stringify({ contactId, houseId }) });
    return body.placement as PlacementView;
  },
  async step(id, step) {
    const body = await call(`/api/missio/placements/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ step }) });
    return body.placement as PlacementView;
  },
};
