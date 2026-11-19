// Sign out of this phone: the one cleanup used by Me › Sign out and the lock
// screen's "Sign out instead", so both do exactly the same.

import { clearFeedCaches } from "@/features/home/feed-cache";
import { unregisterPushOnSignOut } from "@/features/push";
import { supabase } from "@/lib/supabase";

export async function signOutOfThisPhone(): Promise<void> {
  // Stop pushes to this phone while the session can still say so (bounded).
  await unregisterPushOnSignOut();
  // Saved Home items belong to this person: don't leave them on the phone.
  await clearFeedCaches();
  // This device only: signing out on the phone shouldn't end web sessions.
  // The Face ID lock choice is forgotten by LockProvider once signed out.
  await supabase.auth.signOut({ scope: "local" });
}
