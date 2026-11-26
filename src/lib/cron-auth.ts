// Vercel cron routes: allow a call only with `Authorization: Bearer <CRON_SECRET>`.
// With no CRON_SECRET set, every call is refused (fail closed), and the compare is
// timing-safe so the secret can't be guessed a character at a time.

import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s).digest();

export function cronAuthorized(request: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const given = request.headers.get("authorization") ?? "";
  // Hashing first makes both sides the same length, as timingSafeEqual needs.
  return timingSafeEqual(digest(given), digest(`Bearer ${secret}`));
}
