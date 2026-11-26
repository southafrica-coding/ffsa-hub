import type { Household } from "@/lib/missio/households";
import type { HouseholdSuggestion } from "@/lib/missio/household-suggestions";
import { MissioApiError } from "../api";

export type { HouseholdSuggestion };

/** Link went through, or one of them already has a household and the pastor must confirm. */
export type AcceptOutcome =
  | { kind: "linked"; household: Household | null }
  | { kind: "confirm"; householdTitle: string; joiningPersonId: string };

export type SuggestionsClient = {
  list(): Promise<HouseholdSuggestion[]>;
  forPerson(personId: string): Promise<HouseholdSuggestion[]>;
  accept(id: string, options?: { addToExisting?: boolean }): Promise<AcceptOutcome>;
  dismiss(id: string): Promise<void>;
};

const base = "/api/missio/household-suggestions";

async function call(url: string, init?: RequestInit): Promise<{ status: number; ok: boolean; body: Record<string, unknown> }> {
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
  return { status: res.status, ok: res.ok, body };
}

function failure(status: number, body: Record<string, unknown>): MissioApiError {
  const code = typeof body.code === "string" ? body.code : "server_error";
  return new MissioApiError(status, "", null, code);
}

async function read(url: string): Promise<HouseholdSuggestion[]> {
  const res = await call(url);
  if (!res.ok) throw failure(res.status, res.body);
  return (res.body.suggestions as HouseholdSuggestion[]) ?? [];
}

export const suggestionsClient: SuggestionsClient = {
  list: () => read(base),
  forPerson: (personId) => read(`${base}?personId=${encodeURIComponent(personId)}`),
  async accept(id, options) {
    const res = await call(`${base}/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ action: "accept", ...(options?.addToExisting ? { addToExisting: true } : {}) }),
    });
    const existing = res.body.existing as { householdTitle?: string; joiningPersonId?: string } | undefined;
    if (res.status === 409 && res.body.code === "household_exists" && existing?.householdTitle && existing.joiningPersonId) {
      return { kind: "confirm", householdTitle: existing.householdTitle, joiningPersonId: existing.joiningPersonId };
    }
    if (!res.ok) throw failure(res.status, res.body);
    return { kind: "linked", household: (res.body.household as Household | null) ?? null };
  },
  async dismiss(id) {
    const res = await call(`${base}/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ action: "dismiss" }) });
    if (!res.ok) throw failure(res.status, res.body);
  },
};
