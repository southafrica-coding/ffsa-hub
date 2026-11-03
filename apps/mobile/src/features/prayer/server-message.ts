// The Prayer Room's apiFetch, pure part (./api-client wires it live): the
// app's shared client (createApiFetch: same bearer token, same 401 /
// deactivated handling) plus one thing it doesn't do yet: keep the server's
// own error sentence.
//
// The prayer room's rules live in the database (exclusion constraints, the
// practice trigger, RLS), and the routes pass its verdict through as
// {"error": "..."}: "You're already serving in another set that overlaps this
// time.", "Someone already has that station then." The shared client turns
// every 4xx/5xx into a generic message, so this wrapper reads the body first
// and attaches the sentence to the ApiError it throws. Kept in this slice
// (not src/lib) so the shared client isn't edited by parallel branches.

import { ApiError, createApiFetch, type ApiDeps, type ApiFetch } from "@/lib/api";

/** An ApiError that also carries the server's {"error": "..."} sentence. */
export class ServerMessageError extends ApiError {
  constructor(
    base: ApiError,
    readonly serverMessage: string,
  ) {
    super(base.kind, base.message, base.status);
  }
}

function errorField(text: string): string | null {
  try {
    const body = JSON.parse(text) as unknown;
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      return body.error.trim() || null;
    }
  } catch {
    // Not JSON: nothing to keep.
  }
  return null;
}

/** createApiFetch, with the server's error sentence kept on failures. Pure (deps in). */
export function createPrayerFetch(deps: ApiDeps): ApiFetch {
  const baseFetch = deps.fetchImpl ?? fetch;
  return async function prayerFetch(path, init) {
    let serverMessage: string | null = null;
    const fetchImpl: typeof fetch = async (input, reqInit) => {
      const res = await baseFetch(input, reqInit);
      // 401s are the shared client's business (sign out); leave them alone.
      if (res.ok || res.status === 401) return res;
      const text = await res.text();
      serverMessage = errorField(text);
      // The body has been read; hand the shared client an identical copy.
      return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
    };
    try {
      return await createApiFetch({ ...deps, fetchImpl })(path, init);
    } catch (err) {
      // "deactivated" also arrives as a 403 with an error field; it must stay
      // the shared client's sign-out, never a message on a button.
      if (err instanceof ApiError && (err.kind === "http" || err.kind === "forbidden") && serverMessage) {
        throw new ServerMessageError(err, serverMessage);
      }
      throw err;
    }
  };
}
