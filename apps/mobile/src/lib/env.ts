// Public, build-time configuration. Only EXPO_PUBLIC_* values belong here:
// they are inlined into the app bundle and readable by anyone with the app.
// The app holds the public Supabase URL + anon key and nothing else; every
// secret (service role, Xero, Stripe, …) stays on the web server.

import { z } from "zod";

const httpUrl = z
  .url({ protocol: /^https?$/, error: "must be a full http(s) URL" })
  .transform((u) => u.replace(/\/+$/, ""));

const envSchema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: httpUrl,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().trim().min(20, "looks too short to be an anon key"),
  EXPO_PUBLIC_API_BASE_URL: httpUrl,
});

export type Env = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiBaseUrl: string;
};

export class EnvError extends Error {
  name = "EnvError";
}

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const name = String(issue.path[0]);
      return raw[name] ? `  - ${name}: ${issue.message}` : `  - ${name}: missing`;
    });
    throw new EnvError(
      [
        "FFSA Hub app is missing configuration:",
        ...lines,
        "Copy apps/mobile/.env.example to apps/mobile/.env, fill it in, then restart `npx expo start`.",
      ].join("\n"),
    );
  }
  return {
    supabaseUrl: result.data.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: result.data.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    apiBaseUrl: result.data.EXPO_PUBLIC_API_BASE_URL,
  };
}

let cached: Env | undefined;

// Expo only inlines `process.env.EXPO_PUBLIC_*` when accessed by full static
// name, so each one is spelled out here.
export function getEnv(): Env {
  cached ??= parseEnv({
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
  });
  return cached;
}
