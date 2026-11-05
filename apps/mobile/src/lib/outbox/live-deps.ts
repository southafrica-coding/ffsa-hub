// The live session for an outbox's own request helper. Identical to
// src/lib/api-client.ts (bearer token from the Supabase session; 401/403
// "deactivated" sign out locally with the reason), except that `fetch` is
// wrapped so a server's Retry-After reaches the outbox (see retry-after.ts).

import { setSignOutReason } from "@/auth/sign-out-reason";
import type { ApiDeps } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { supabase } from "@/lib/supabase";

export function liveApiDeps(fetchImpl: typeof fetch): ApiDeps {
  return {
    baseUrl: getEnv().apiBaseUrl,
    async getAccessToken() {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
    async onAuthFailure(reason) {
      setSignOutReason(reason);
      await supabase.auth.signOut({ scope: "local" });
    },
    fetchImpl,
  };
}

/** The signed-in person's id (outbox items only send for their owner). */
export async function sessionUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}
