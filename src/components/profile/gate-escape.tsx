"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    } catch {
      // Never strand someone here because the network hiccuped: the login
      // page will bounce them back if the session somehow survived.
      router.push("/login");
    }
  }

  return (
    <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center justify-between gap-3 border-b border-[#2A2A2A] bg-black/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
      <p className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-[#9A9689]">
        Finish this to use the Hub
      </p>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={busy}
        className="flex min-h-[44px] items-center gap-2 px-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-[#9A9689] transition-colors hover:text-white disabled:opacity-50"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden />
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
