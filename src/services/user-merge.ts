// FFSA Hub — merging two duplicate people into one account.
//
// The work happens in the `merge_users` SQL function (migration 210), not
// here. That is deliberate: PostgREST gives us no transaction, and a merge
// that repoints an enrolment, a billing plan, consent records and roles over
// a dozen round-trips can fail halfway and leave a student with billing on
// one account and an enrolment on another. A function body is one
// transaction, so the merge is all-or-nothing.
//
// This module is the thin wrapper: it calls the function, and translates its
// two interesting failure modes into something an API route can use.

import type { SupabaseClient } from "@supabase/supabase-js";

export type MergeReport = {
  winner: string;
  loser: string;
  loser_email: string | null;
  /** rows moved, keyed "table.column" */
  moved: Record<string, number>;
  collisions: Array<Record<string, unknown>>;
  leftovers: Array<{ ref: string; rows: number }>;
  dry_run: boolean;
};

export type MergePreview = {
  /** rows currently sitting on the losing account, keyed "table.column" */
  loser_rows: Record<string, number>;
  /** programs BOTH accounts are enrolled in — the collision cases */
  shared_programs: Array<{
    program_id: string;
    program: string;
    winner_status: string;
    loser_status: string;
  }>;
};

/** Migration 210 hasn't been applied to this database yet. */
const MISSING_FUNCTION = "PGRST202";
/** The sentinel merge_users raises to roll a dry run back. */
const DRY_RUN = "FFSA1";

const NOT_APPLIED =
  "The merge function isn't installed on this database yet. " +
  "Apply supabase/migrations/210_merge_users.sql in the Supabase SQL editor first.";

/**
 * Cheap "what would move" counts. Cannot catch constraint violations — use
 * `dryRunMerge` for that before offering a confirm button.
 */
export async function previewUserMerge(
  admin: SupabaseClient,
  winnerId: string,
  loserId: string
): Promise<{ preview?: MergePreview; error?: string }> {
  const { data, error } = await admin.rpc("preview_merge_users", {
    p_winner: winnerId,
    p_loser: loserId,
  });

  if (error) {
    if (error.code === MISSING_FUNCTION) return { error: NOT_APPLIED };
    return { error: error.message };
  }
  return { preview: data as unknown as MergePreview };
}

/**
 * Runs the *entire* merge and rolls it back.
 *
 * Stronger than counting rows: it exercises every unique constraint against
 * real data, so a merge that would fail on `enrollments (user_id,
 * program_id)` fails here instead of halfway through the real thing.
 */
export async function dryRunMerge(
  admin: SupabaseClient,
  winnerId: string,
  loserId: string,
  actorId: string
): Promise<{ report?: MergeReport; error?: string }> {
  const { error } = await admin.rpc("merge_users", {
    p_winner: winnerId,
    p_loser: loserId,
    p_actor: actorId,
    p_dry_run: true,
    p_strict: true,
  });

  if (!error) {
    // merge_users always raises on a dry run. Reaching here means the
    // function on this database is an older build that doesn't.
    return {
      error:
        "Dry run did not roll back as expected — check which version of " +
        "merge_users is installed before merging for real.",
    };
  }

  if (error.code === MISSING_FUNCTION) return { error: NOT_APPLIED };

  if (error.code === DRY_RUN) {
    // The report rides out in the exception DETAIL.
    try {
      return { report: JSON.parse(error.details ?? "") as MergeReport };
    } catch {
      return { error: "Dry run succeeded but its report could not be read." };
    }
  }

  // A genuine failure — a constraint violation, or the strict-mode guard
  // reporting a table missing from the allow-list. This is the useful one.
  return { error: error.message };
}

/**
 * The real thing. Only call after `dryRunMerge` has come back clean.
 */
export async function mergeUsers(
  admin: SupabaseClient,
  winnerId: string,
  loserId: string,
  actorId: string
): Promise<{ report?: MergeReport; error?: string }> {
  const { data, error } = await admin.rpc("merge_users", {
    p_winner: winnerId,
    p_loser: loserId,
    p_actor: actorId,
    p_dry_run: false,
    p_strict: true,
  });

  if (error) {
    if (error.code === MISSING_FUNCTION) return { error: NOT_APPLIED };
    return { error: error.message };
  }
  return { report: data as unknown as MergeReport };
}

/**
 * Stops the retired account being used to sign in.
 *
 * Runs AFTER the merge commits, so it can fail on its own. That is reported
 * as a warning rather than failing the merge — the records have already
 * moved correctly, and this is re-runnable.
 *
 * Rewriting the email is the point as much as the ban: it stops the student
 * requesting a reset for the old address and landing in an empty account,
 * and it frees that address should you ever want it on the surviving one.
 */
export async function retireLoserAuthUser(
  admin: SupabaseClient,
  loserId: string,
  winnerId: string
): Promise<{ ok: boolean; warning?: string }> {
  const { error } = await admin.auth.admin.updateUserById(loserId, {
    // Supabase has no "forever"; ~100 years is the idiom.
    ban_duration: "876000h",
    email: `merged+${loserId}@ffsa.invalid`,
    user_metadata: { merged_into: winnerId, merged_at: new Date().toISOString() },
  });

  if (error) {
    return {
      ok: false,
      warning:
        "The merge completed, but the old account could not be locked: " +
        error.message +
        " It can still be signed into — retry the lock from the merge page.",
    };
  }
  return { ok: true };
}
