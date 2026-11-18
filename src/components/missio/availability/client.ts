import { peopleSearchParams } from "@/components/missio/access";
import type { CreateRequestInput } from "@/lib/missio/availability/schema";
import type { VolunteersSnapshot } from "@/lib/missio/availability/service";

export type PeopleHit = { contactId: string; name: string };

export type NudgeDraft = { whatsapp: string; email: string; count: number; needsNewLink: string[] };

export type VolunteersClient = {
  load(requestId?: string): Promise<VolunteersSnapshot>;
  createRequest(input: CreateRequestInput): Promise<{ id: string }>;
  createTeam(name: string): Promise<void>;
  renameTeam(id: string, name: string): Promise<void>;
  deleteTeam(id: string): Promise<void>;
  addMember(teamId: string, contactId: string): Promise<void>;
  removeMember(teamId: string, contactId: string): Promise<void>;
  addLeader(teamId: string, contactId: string): Promise<void>;
  removeLeader(teamId: string, contactId: string): Promise<void>;
  copyLink(requestId: string, contactId: string): Promise<{ url: string; replaced?: boolean }>;
  resetLink(requestId: string, contactId: string): Promise<{ url: string }>;
  nudge(requestId: string): Promise<NudgeDraft>;
  searchPeople(q: string): Promise<PeopleHit[]>;
};

async function send(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error || "Volunteers didn't load.");
  return body;
}

export const volunteersClient: VolunteersClient = {
  async load(requestId) {
    const params = new URLSearchParams();
    if (requestId) params.set("requestId", requestId);
    const query = params.toString();
    return (await send(`/api/missio/volunteers${query ? `?${query}` : ""}`)) as VolunteersSnapshot;
  },
  async createRequest(input) {
    return (await send("/api/missio/volunteers/requests", { method: "POST", body: JSON.stringify(input) })) as {
      id: string;
    };
  },
  async createTeam(name) {
    await send("/api/missio/volunteers/teams", { method: "POST", body: JSON.stringify({ name }) });
  },
  async renameTeam(id, name) {
    await send(`/api/missio/volunteers/teams/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
  },
  async deleteTeam(id) {
    await send(`/api/missio/volunteers/teams/${id}`, { method: "DELETE" });
  },
  async addMember(teamId, contactId) {
    await send(`/api/missio/volunteers/teams/${teamId}/members`, {
      method: "POST",
      body: JSON.stringify({ contactId }),
    });
  },
  async removeMember(teamId, contactId) {
    await send(`/api/missio/volunteers/teams/${teamId}/members/${contactId}`, { method: "DELETE" });
  },
  async addLeader(teamId, contactId) {
    await send(`/api/missio/volunteers/teams/${teamId}/leaders`, {
      method: "POST",
      body: JSON.stringify({ contactId }),
    });
  },
  async removeLeader(teamId, contactId) {
    await send(`/api/missio/volunteers/teams/${teamId}/leaders/${contactId}`, { method: "DELETE" });
  },
  async copyLink(requestId, contactId) {
    return (await send(`/api/missio/volunteers/requests/${requestId}/link`, {
      method: "POST",
      body: JSON.stringify({ contactId }),
    })) as { url: string; replaced?: boolean };
  },
  async resetLink(requestId, contactId) {
    return (await send(`/api/missio/volunteers/requests/${requestId}/link/reset`, {
      method: "POST",
      body: JSON.stringify({ contactId }),
    })) as { url: string };
  },
  async nudge(requestId) {
    return (await send(`/api/missio/volunteers/requests/${requestId}/nudge`, { method: "POST" })) as NudgeDraft;
  },
  async searchPeople(q) {
    const params = peopleSearchParams({ q, limit: 20, offset: 0 });
    const body = (await send(`/api/missio/people?${params.toString()}`)) as {
      rows?: { contactId?: string; name?: string }[];
    };
    return (body.rows ?? [])
      .filter((row) => row.contactId && row.name)
      .map((row) => ({ contactId: row.contactId as string, name: row.name as string }));
  },
};
