// bookingsFetch wired to the live session, the same way src/lib/api-client.ts
// wires apiFetch (kept apart so http.ts stays testable without Supabase).

import { setSignOutReason } from "@/auth/sign-out-reason";
import { getEnv } from "@/lib/env";
import { supabase } from "@/lib/supabase";

import { createBookingsFetch } from "./http";

export const bookingsFetch = createBookingsFetch({
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
