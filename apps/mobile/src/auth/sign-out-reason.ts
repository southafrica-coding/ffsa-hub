// Why the app signed the user out, so the sign-in screen can say so.
// Set just before a forced sign-out (401/403 from the API); the sign-in
// screen reads it once.

import { useSyncExternalStore } from "react";

import type { AuthFailure } from "@/lib/api";

let reason: AuthFailure | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setSignOutReason(next: AuthFailure | null) {
  reason = next;
  emit();
}

export function clearSignOutReason() {
  setSignOutReason(null);
}

export function useSignOutReason() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => reason,
  );
}
