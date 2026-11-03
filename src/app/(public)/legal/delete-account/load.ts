import { createClient } from "@/lib/supabase/server";
import { getOpenDeletionRequest, isMissingTableError, type DeletionRequestRow } from "@/services/account-deletion";
import { deletionContactEmail } from "@/lib/account-deletion/config";

export type DeletionRequestView = { requestedAt: string; reason: string | null };

export type DeletionPageState =
  | { signedIn: false; contactEmail: string }
  | { signedIn: true; contactEmail: string; request: DeletionRequestView | null };

// What /legal/delete-account shows. Kept out of page.tsx so it can be tested
// (the repo's vitest setup can't import .tsx files).
export async function loadDeletionPage(): Promise<DeletionPageState> {
  const contactEmail = deletionContactEmail();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { signedIn: false, contactEmail };

  const { data, error } = await getOpenDeletionRequest(supabase, user.id);
  if (error && !isMissingTableError(error)) {
    console.error("[account-deletion] page read failed", error);
  }
  const row = !error ? (data as DeletionRequestRow | null) : null;
  return {
    signedIn: true,
    contactEmail,
    request: row ? { requestedAt: row.requested_at, reason: row.reason } : null,
  };
}
