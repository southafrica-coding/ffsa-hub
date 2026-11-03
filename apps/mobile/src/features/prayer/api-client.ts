// The live Prayer Room apiFetch: createPrayerFetch (./server-message) wired
// exactly like src/lib/api-client.ts (same session token, same sign-out on
// 401 / deactivated).

import { setSignOutReason } from "@/auth/sign-out-reason";
import { getEnv } from "@/lib/env";
import { supabase } from "@/lib/supabase";

import { createPrayerFetch } from "./server-message";

export const prayerFetch = createPrayerFetch({
  baseUrl: getEnv().apiBaseUrl,
  async getAccessToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
  async onAuthFailure(reason) {
    setSignOutReason(reason);
    await supabase.auth.signOut({ scope: "local" });
  },
});
