"use client";

import { LogOut } from "lucide-react";

/**
 * The way out of a blocking gate.
 *
 * Every gate is a full-screen overlay with no navigation behind it, so
 * without this a person who cannot finish the form is stuck in the app
 * with no way to leave — not even to sign out. That is a real position to
 * be in on a first visit: the profile gate asks for a passport number and
 * an insurance policy number, and people frequently do not have either to
 * hand when they first sign in.
 *
 * Deliberately sticky rather than placed at the foot of the panel. The
 * profile gate runs to roughly 1900px on a phone, and an escape you can
 * only reach by scrolling past the thing you are stuck on is not an
 * escape.
 */
export function GateEscape() {
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center justify-between gap-3 border-b border-[#2A2A2A] bg-black/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
      <p className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-[color:var(--text-quiet)]">
        Finish this to use the Hub
      </p>
      <form action="/auth/sign-out" method="post">
        <button
          type="submit"
          className="flex min-h-[44px] items-center gap-2 px-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-[color:var(--text-quiet)] transition-colors hover:text-white"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          Sign out
        </button>
      </form>
    </div>
  );
}
