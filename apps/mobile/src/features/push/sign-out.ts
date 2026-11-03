// Called by Me's "Sign out" BEFORE the session is cleared, so the server
// stops pushing this person's notifications to this phone. Bounded: sign-out
// never waits more than a few seconds for it, and never fails because of it.

import { apiFetch } from "@/lib/api-client";

import { unregisterDevice } from "./api";
import { setAppBadge } from "./native";
import { readPushState, setRegistration } from "./store";

const SIGN_OUT_TIMEOUT_MS = 4_000;

export async function unregisterPushOnSignOut(): Promise<void> {
  try {
    const { registration } = await readPushState();
    if (registration) {
      await unregisterDevice(apiFetch, registration.token, { timeoutMs: SIGN_OUT_TIMEOUT_MS }).catch(() => {});
      await setRegistration(null);
    }
    await setAppBadge(0);
  } catch {
    // Never block sign-out.
  }
}
