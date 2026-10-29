// ────────────────────────────────────────────────────────────
// SIGNING THE REQUIRED AGREEMENTS (privacy, child protection, NDA)
// ────────────────────────────────────────────────────────────
// Browser-side save handlers shared by the onboarding wizard's consent step
// and the profile-completion gate's agreements panel.
//
// Why this exists: both screens used to `await fetch(...)` with no time
// limit and, on success, leave their button on "Saving…" while waiting for
// a navigation / router.refresh() to replace the component. When that
// request or navigation stalled, nothing ever cleared the state — the
// person was left on "Saving…" with no idea whether they had signed.
//
// Every call here resolves to a SaveOutcome — never hangs, never throws —
// so the caller can always end the saving state and either confirm or show
// a plain error with a way to retry. Signing is idempotent on the server
// (POST /api/consent returns the existing signature), so retrying is safe.

export type AgreementToSign = {
  kind: string;
  version: string;
  title: string;
};

export type SaveOutcome =
  | { ok: true }
  | { ok: false; error: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type SaveOptions = {
  fetchImpl?: FetchLike;
  // Per-request limit. Generous: a cold serverless start plus a slow phone
  // connection can take a while, but never "forever".
  timeoutMs?: number;
};

export const SAVE_TIMEOUT_MS = 25_000;

export const NETWORK_ERROR =
  "We couldn't reach the Hub. Check your connection and try again.";
export const TIMEOUT_ERROR =
  "This is taking longer than it should, so we stopped waiting. Nothing is lost — please try again.";

class TimeoutError extends Error {}

// POST JSON with a hard time limit. Resolves to the HTTP status and parsed
// body (an empty object when the body isn't JSON, e.g. a gateway error page).
async function postJson(
  url: string,
  body: unknown,
  { fetchImpl = fetch, timeoutMs = SAVE_TIMEOUT_MS }: SaveOptions
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject first so the race settles as a timeout, not as the fetch's
      // own AbortError; then abort to free the connection.
      reject(new TimeoutError());
      controller?.abort();
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([
      fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller?.signal,
      }),
      timeout,
    ]);
    const data = (await Promise.race([
      res.json().catch(() => ({})),
      timeout,
    ])) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, data: data ?? {} };
  } finally {
    clearTimeout(timer);
  }
}

function describeFailure(err: unknown): string {
  return err instanceof TimeoutError ? TIMEOUT_ERROR : NETWORK_ERROR;
}

function serverMessage(
  status: number,
  data: Record<string, unknown>,
  fallback: string
): string {
  if (status === 401) {
    return "Your session has expired. Please sign in again to finish.";
  }
  const msg = typeof data.error === "string" ? data.error.trim() : "";
  return msg || fallback;
}

// Record each agreement in turn. Stops at the first failure and names the
// policy it couldn't save; ones already recorded stay recorded.
export async function recordAgreements(
  agreements: AgreementToSign[],
  opts: SaveOptions = {}
): Promise<SaveOutcome> {
  for (const a of agreements) {
    try {
      const res = await postJson(
        "/api/consent",
        { kind: a.kind, agreement_version: a.version, source: "onboarding" },
        opts
      );
      if (!res.ok) {
        return {
          ok: false,
          error: serverMessage(
            res.status,
            res.data,
            `We couldn't save your signature on the ${a.title}. Please try again.`
          ),
        };
      }
    } catch (err) {
      return { ok: false, error: describeFailure(err) };
    }
  }
  return { ok: true };
}

// Mark the account as set up (POST /api/onboarding/complete).
export async function completeOnboardingRequest(
  opts: SaveOptions = {}
): Promise<SaveOutcome> {
  try {
    const res = await postJson("/api/onboarding/complete", undefined, opts);
    if (!res.ok) {
      return {
        ok: false,
        error: serverMessage(
          res.status,
          res.data,
          "We couldn't finish setting up your account. Please try again."
        ),
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describeFailure(err) };
  }
}

// Bound any other promise (e.g. the browser Supabase profile update) by the
// same time limit, as a SaveOutcome.
export async function withTimeout<T>(
  work: PromiseLike<T>,
  timeoutMs: number = SAVE_TIMEOUT_MS
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError()), timeoutMs);
      }),
    ]);
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: describeFailure(err) };
  } finally {
    clearTimeout(timer);
  }
}
