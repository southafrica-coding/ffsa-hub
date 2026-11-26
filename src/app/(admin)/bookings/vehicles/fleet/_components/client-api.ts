"use client";

// Calls to the Fleet routes from client components. Errors come back as an Error whose
// message is the route's plain-language `error`, ready for a toast.

export class ClashError extends Error {}

export async function fleetFetch<T = Record<string, unknown>>(
  url: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method || (init?.body === undefined ? "GET" : "POST"),
      headers: init?.body === undefined || init.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : init.body instanceof FormData ? init.body : JSON.stringify(init.body),
    });
  } catch {
    throw new Error("The Hub can't be reached. Check your connection and try again.");
  }
  const out = await res.json().catch(() => ({}));
  if (res.status === 409 && out.clash) throw new ClashError(out.clash);
  if (!res.ok) throw new Error(out.error || (res.status === 403 ? "You don't have access to change Fleet." : `Something went wrong (${res.status}).`));
  return out as T;
}

/** Upload a photo or PDF; returns its id. */
export async function uploadFleetFile(file: File, owner?: { type: string; id?: string }) {
  const fd = new FormData();
  fd.append("file", file);
  if (owner) {
    fd.append("owner_type", owner.type);
    if (owner.id) fd.append("owner_id", owner.id);
  }
  return fleetFetch<{ id: string; url: string; contentType: string }>("/api/vehicles/fleet/files", { body: fd });
}

/** Minutes a dialog was open, 1–15 (the Fleet app's modalMins). */
export const minsSince = (openedAt: number) => Math.min(15, Math.max(1, Math.round((Date.now() - openedAt) / 60000)));
