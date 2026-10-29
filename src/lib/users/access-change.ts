// Confirm-before-save for anything that changes what someone can see or do:
// membership role, job titles, admin tiers, permission grants.
//
// The flow every one of those controls follows:
//   request  → a confirmation dialog opens; the control still shows the saved value
//   cancel   → dialog closes, nothing is sent, the control never moved
//   confirm  → the request goes out; the control shows the new value
//   succeed  → success toast; the control keeps the new value until the
//              refreshed server data catches up
//   fail     → error toast; the control falls back to the saved value
//
// Kept free of React so the state machine can be unit-tested on its own.

export type AccessChangeState<T> =
  | { status: "idle" }
  | {
      status: "confirming" | "saving" | "saved" | "failed";
      /** Which control this is about (e.g. the user id of a table row). */
      key: string;
      from: T;
      to: T;
      error?: string;
    };

export type AccessChangeEvent<T> =
  | { type: "request"; key: string; from: T; to: T }
  | { type: "cancel" }
  | { type: "confirm" }
  | { type: "succeed" }
  | { type: "fail"; error: string };

export const IDLE: AccessChangeState<never> = { status: "idle" };

export function accessChangeReducer<T>(
  state: AccessChangeState<T>,
  event: AccessChangeEvent<T>
): AccessChangeState<T> {
  switch (event.type) {
    case "request":
      // One change at a time — a second request while one is in flight is dropped.
      if (state.status === "saving") return state;
      // Re-picking the value it already has is not a change.
      if (Object.is(event.from, event.to)) return { status: "idle" };
      return { status: "confirming", key: event.key, from: event.from, to: event.to };
    case "cancel":
      // Too late to cancel once the request is out.
      if (state.status === "saving") return state;
      return { status: "idle" };
    case "confirm":
      if (state.status !== "confirming") return state;
      return { ...state, status: "saving" };
    case "succeed":
      if (state.status !== "saving") return state;
      return { ...state, status: "saved" };
    case "fail":
      if (state.status !== "saving") return state;
      return { ...state, status: "failed", error: event.error };
  }
}

/**
 * What the control for `key` should display, given the value the server last
 * reported. Only a confirmed (saving / saved) change moves it off `saved`:
 * a change awaiting confirmation, a cancelled one and a failed one all show
 * the saved value.
 */
export function shownValue<T>(state: AccessChangeState<T>, key: string, saved: T): T {
  if (state.status === "idle" || state.key !== key) return saved;
  if (state.status === "saving" || state.status === "saved") return state.to;
  return saved;
}

/** True while the dialog for a change should be open. */
export function isConfirming<T>(state: AccessChangeState<T>): boolean {
  return state.status === "confirming" || state.status === "saving";
}

// ───────── Sending ─────────

export type AccessChangeResult = { ok: true } | { ok: false; error: string };

/**
 * POST an access change and fold every way it can go wrong (HTTP error,
 * unreadable body, network failure) into one `{ ok, error }` result, so the
 * caller only has to decide which toast to show.
 */
export async function postAccessChange(
  url: string,
  body: unknown,
  fallbackError: string,
  fetchImpl: typeof fetch = fetch
): Promise<AccessChangeResult> {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    return {
      ok: false,
      error: typeof data.error === "string" && data.error ? data.error : fallbackError,
    };
  } catch {
    return { ok: false, error: `${fallbackError} — check your connection and try again.` };
  }
}

// ───────── Wording ─────────

/** "Jane Doe's" — the possessive used in every confirmation title. */
export function possessive(name: string): string {
  const n = name.trim() || "This person";
  return `${n}'s`;
}

export function membershipChangeTitle(name: string, fromLabel: string, toLabel: string): string {
  return `Change ${possessive(name)} membership role from ${fromLabel} to ${toLabel}?`;
}

// ───────── Permission grid diff ─────────

export type GrantRef = {
  permission_id: string;
  scope_type: string | null;
  scope_id: string | null;
};

/**
 * Compare the saved grants with the ticked ones, over only the keys the
 * caller may touch. Anything outside `editable` is ignored, so a narrowed
 * editor can never emit a change to a permission it doesn't show.
 */
export function diffGrants(
  editable: Map<string, GrantRef>,
  saved: ReadonlySet<string>,
  ticked: ReadonlySet<string>
): { toGrant: GrantRef[]; toRevoke: GrantRef[] } {
  const toGrant: GrantRef[] = [];
  const toRevoke: GrantRef[] = [];
  for (const [key, ref] of editable) {
    const was = saved.has(key);
    const is = ticked.has(key);
    if (is && !was) toGrant.push(ref);
    if (!is && was) toRevoke.push(ref);
  }
  return { toGrant, toRevoke };
}
