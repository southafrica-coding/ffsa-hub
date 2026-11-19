"use client";

// Where a draft inspection lives while it's being done: on the device (localStorage,
// written continuously, so it survives closing the page and having no signal in the
// yard) and, debounced, on the server (so it can be finished on another device).

import { draftKey, loadDraft, type Draft } from "@/lib/fleet/inspection";

const url = (vehicleId: string) => `/api/vehicles/fleet/drafts/${vehicleId}`;

export function readLocalDraft(vehicleId: string): Draft | null {
  try {
    const s = localStorage.getItem(draftKey(vehicleId));
    return s ? loadDraft(JSON.parse(s), vehicleId) : null;
  } catch {
    return null;
  }
}

export function writeLocalDraft(d: Draft) {
  try {
    localStorage.setItem(draftKey(d.vehicleId), JSON.stringify(d));
  } catch {
    // Storage full or blocked: the server copy still has it when there's signal.
  }
}

export function removeLocalDraft(vehicleId: string) {
  try {
    localStorage.removeItem(draftKey(vehicleId));
  } catch {
    // nothing to do
  }
}

/** The server copy, or null when there is none or no signal (gives up after `ms`). */
export async function fetchServerDraft(vehicleId: string, ms = 2500): Promise<Draft | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url(vehicleId), { signal: ctl.signal, cache: "no-store" });
    if (!res.ok) return null;
    const out = (await res.json()) as { draft?: unknown; updatedAt?: string | null };
    const d = loadDraft(out.draft, vehicleId);
    if (d && !d.savedAt && out.updatedAt) d.savedAt = Date.parse(out.updatedAt) || 0;
    return d;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Best effort: a failed write is tried again with the next change. */
export async function putServerDraft(d: Draft, keepalive = false) {
  try {
    await fetch(url(d.vehicleId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(d),
      keepalive,
    });
  } catch {
    // no signal: the device copy has it
  }
}

export async function deleteServerDraft(vehicleId: string) {
  try {
    await fetch(url(vehicleId), { method: "DELETE" });
  } catch {
    // no signal
  }
}
