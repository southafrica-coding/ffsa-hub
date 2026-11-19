import type { Household } from "@/lib/missio/households";
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

export type ChildInput = { firstName: string; lastName?: string; birthYear: number };

export type HouseholdsClient = {
  list(): Promise<Household[]>;
  forPerson(personId: string): Promise<Household | null>;
  forContact(contactId: string): Promise<Household | null>;
  create(personId: string): Promise<Household>;
  addAdult(householdId: string, personId: string, label?: string): Promise<Household>;
  addChild(householdId: string, child: ChildInput): Promise<Household>;
  update(householdId: string, patch: { name?: string | null; mainContactId?: string }): Promise<Household>;
  remove(householdId: string, memberId: string): Promise<Household | null>;
};

const base = "/api/missio/households";
const one = (body: Record<string, unknown>) => body.household as Household;

export const householdsClient: HouseholdsClient = {
  async list() {
    const body = await call(base);
    return (body.households as Household[]) ?? [];
  },
  async forPerson(personId) {
    const body = await call(`/api/missio/people/${encodeURIComponent(personId)}/household`);
    return (body.household as Household | null) ?? null;
  },
  async forContact(contactId) {
    const body = await call(`${base}?contactId=${encodeURIComponent(contactId)}`);
    return (body.household as Household | null) ?? null;
  },
  async create(personId) {
    return one(await call(base, { method: "POST", body: JSON.stringify({ personId }) }));
  },
  async addAdult(householdId, personId, label) {
    return one(
      await call(`${base}/${encodeURIComponent(householdId)}/members`, {
        method: "POST",
        body: JSON.stringify({ kind: "adult", personId, ...(label ? { label } : {}) }),
      })
    );
  },
  async addChild(householdId, child) {
    return one(
      await call(`${base}/${encodeURIComponent(householdId)}/members`, {
        method: "POST",
        body: JSON.stringify({ kind: "child", ...child }),
      })
    );
  },
  async update(householdId, patch) {
    return one(await call(`${base}/${encodeURIComponent(householdId)}`, { method: "PATCH", body: JSON.stringify(patch) }));
  },
  async remove(householdId, memberId) {
    const body = await call(`${base}/${encodeURIComponent(householdId)}/members/${encodeURIComponent(memberId)}`, { method: "DELETE" });
    return (body.household as Household | null) ?? null;
  },
};
