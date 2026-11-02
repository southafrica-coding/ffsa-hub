// The app's apiFetch: src/lib/api.ts wired to the live Supabase session.
// (api.ts itself stays free of Supabase so it can be unit-tested alone.)

import { setSignOutReason } from "@/auth/sign-out-reason";

import { createApiFetch } from "./api";
import { getEnv } from "./env";
import { supabase } from "./supabase";

export const apiFetch = createApiFetch({
  baseUrl: getEnv().apiBaseUrl,
  async getAccessToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
  async onAuthFailure(reason) {
    setSignOutReason(reason);
    // Local only: the server already considers this session invalid. The
    // auth gate in app/_layout.tsx then shows the sign-in screen.
    await supabase.auth.signOut({ scope: "local" });
  },
});
