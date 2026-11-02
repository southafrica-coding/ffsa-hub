import "react-native-url-polyfill/auto";

import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

import type { Database } from "@/types/database";

import { getEnv } from "./env";
import { largeSecureStore } from "./secure-storage";

const env = getEnv();

// Same Supabase project and RLS as the website, signed in as the user. The
// anon key is public by design; the app never holds a service-role key.
export const supabase = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: largeSecureStore,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refresh tokens only while the app is in the foreground (supabase-js can't
// tell on native). Registered once, for the app's lifetime.
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
