/**
 * Linking Hub users to their Slack accounts.
 *
 * Nothing can be DM'd until users.slack_user_id is populated, so this
 * is the gate in front of every personal notification. Two ways in:
 *
 *   • Auto-match by email (users.lookupByEmail). Free and accurate
 *     whenever someone's Hub email is the same as their Slack email,
 *     which for most of the team it is. Run in bulk from the admin
 *     page; nobody has to do anything.
 *   • Manual member id. The fallback for the rest, and the reason
 *     the profile card carries find-your-id instructions.
 *
 * Manual entry is always verified against users.info before we store
 * it — a mistyped member id is a valid-looking string that silently
 * sends someone else's notifications to a stranger, and there is no
 * way to notice after the fact.
 */

import * as slack from "@/lib/slack/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

export type LinkSource = "self" | "admin" | "email_match";

export type SlackLinkState = {
  slackUserId: string | null;
  linkedAt: string | null;
  source: LinkSource | null;
};

/** Gap between lookups. users.lookupByEmail is Tier 3 (~50/min). */
const LOOKUP_INTERVAL_MS = 1300;

/** Give up once this many consecutive-ish failures land with no successes. */
const ABORT_AFTER_FAILURES = 5;

/** Slack member ids look like U0123ABCD / W0123ABCD (Enterprise Grid). */
const MEMBER_ID_PATTERN = /^[UW][A-Z0-9]{6,}$/;

export function looksLikeMemberId(value: string): boolean {
  return MEMBER_ID_PATTERN.test(value.trim().toUpperCase());
}

// ────────────────────────────────────────────────────────────
// Reading
// ────────────────────────────────────────────────────────────

export async function getSlackLink(
  admin: AdminClient,
  userId: string
): Promise<SlackLinkState> {
  const { data } = await admin
    .from("users")
    .select("slack_user_id, slack_linked_at, slack_link_source")
    .eq("id", userId)
    .maybeSingle();

  const row = data as {
    slack_user_id: string | null;
    slack_linked_at: string | null;
    slack_link_source: LinkSource | null;
  } | null;

  return {
    slackUserId: row?.slack_user_id ?? null,
    linkedAt: row?.slack_linked_at ?? null,
    source: row?.slack_link_source ?? null,
  };
}

// ────────────────────────────────────────────────────────────
// Writing
// ────────────────────────────────────────────────────────────

export type VerifiedSlackUser = {
  id: string;
  name: string | null;
  email: string | null;
};

export type LinkOutcome =
  | { ok: true; user: VerifiedSlackUser }
  | { ok: false; error: string };

/**
 * Verify a member id against Slack and store it.
 *
 * Rejects bots and deactivated accounts, and refuses an id already
 * claimed by a different Hub user — two accounts pointing at one
 * Slack id would double-DM that person and silently starve the other.
 */
export async function linkByMemberId(
  admin: AdminClient,
  args: { userId: string; memberId: string; source: LinkSource }
): Promise<LinkOutcome> {
  const memberId = args.memberId.trim().toUpperCase();

  if (!looksLikeMemberId(memberId)) {
    return {
      ok: false,
      error:
        "That doesn't look like a Slack member ID. It should start with a U and look like U01AB2CD3EF.",
    };
  }

  if (!process.env.SLACK_BOT_TOKEN) {
    return { ok: false, error: "Slack isn't configured on this environment." };
  }

  let info;
  try {
    info = await slack.getUserInfo(memberId);
  } catch (err) {
    console.error("[slack-links] users.info threw", err);
    return { ok: false, error: "Couldn't reach Slack. Please try again." };
  }

  if (!info.ok || !info.user) {
    if (info.error === "user_not_found") {
      return {
        ok: false,
        error:
          "No one in the FFSA Slack workspace has that member ID. Please double-check you copied it from your own profile.",
      };
    }
    return { ok: false, error: `Slack rejected that ID (${info.error ?? "unknown"}).` };
  }

  if (info.user.is_bot) {
    return { ok: false, error: "That member ID belongs to an app, not a person." };
  }
  if (info.user.deleted) {
    return { ok: false, error: "That Slack account has been deactivated." };
  }

  const taken = await memberIdTakenBy(admin, memberId, args.userId);
  if (taken) {
    return {
      ok: false,
      error:
        "That Slack account is already linked to another Hub profile. Please check with an admin.",
    };
  }

  const verified: VerifiedSlackUser = {
    id: info.user.id,
    name:
      info.user.profile?.real_name ??
      info.user.profile?.display_name ??
      info.user.name ??
      null,
    email: info.user.profile?.email ?? null,
  };

  const stored = await storeLink(admin, {
    userId: args.userId,
    memberId: verified.id,
    source: args.source,
  });
  if (!stored) return { ok: false, error: "Couldn't save the link. Please try again." };

  return { ok: true, user: verified };
}

/** Clear a link. Used by "this isn't me" on the profile card. */
export async function unlinkSlack(
  admin: AdminClient,
  userId: string
): Promise<boolean> {
  const { error } = await admin
    .from("users")
    .update({
      slack_user_id: null,
      slack_linked_at: null,
      slack_link_source: null,
    })
    .eq("id", userId);
  if (error) {
    console.error("[slack-links] unlink failed", error);
    return false;
  }
  return true;
}

// ────────────────────────────────────────────────────────────
// Bulk email auto-match
// ────────────────────────────────────────────────────────────

export type AutoMatchResult = {
  attempted: number;
  matched: number;
  notFound: number;
  failed: number;
  /**
   * Slack error codes seen, with counts — e.g. { missing_scope: 165 }.
   * Surfaced to the admin UI because "165 failed" with no reason is
   * unactionable: missing_scope, ratelimited and invalid_auth all
   * look identical from the outside but need different fixes.
   */
  errors: Record<string, number>;
};

/**
 * Try to link every unlinked active user by their Hub email.
 *
 * Only fills gaps — an existing link is never overwritten, so running
 * this repeatedly is safe and is the intended way to pick up new
 * staff. `users_not_found` is the ordinary case (their Slack email
 * differs), not an error; those people fall through to manual entry.
 */
export async function autoMatchByEmail(
  admin: AdminClient
): Promise<AutoMatchResult> {
  const result: AutoMatchResult = {
    attempted: 0,
    matched: 0,
    notFound: 0,
    failed: 0,
    errors: {},
  };

  const note = (code: string) => {
    result.errors[code] = (result.errors[code] ?? 0) + 1;
  };

  if (!process.env.SLACK_BOT_TOKEN) {
    note("no_bot_token");
    return result;
  }

  const { data, error } = await admin
    .from("users")
    .select("id, email")
    .is("slack_user_id", null)
    .neq("is_active", false);
  if (error) {
    console.error("[slack-links] unlinked user read failed", error);
    return result;
  }

  const rows = ((data ?? []) as Array<{ id: string; email: string | null }>)
    .filter((u) => !!u.email);

  for (const user of rows) {
    result.attempted += 1;
    // users.lookupByEmail is Tier 3: ~50 requests/minute. 1.3s between
    // calls keeps us just under that. The original 150ms was ~8x over
    // the limit and would have started returning `ratelimited` partway
    // through a run of this size.
    await new Promise((r) => setTimeout(r, LOOKUP_INTERVAL_MS));

    try {
      const res = await slack.lookupUserByEmail(user.email as string);
      if (!res.ok || !res.user) {
        if (res.error === "users_not_found") {
          result.notFound += 1;
        } else {
          result.failed += 1;
          note(res.error ?? "unknown");
        }
        continue;
      }
      if (await memberIdTakenBy(admin, res.user.id, user.id)) {
        result.failed += 1;
        note("already_linked_to_another_user");
        continue;
      }
      const stored = await storeLink(admin, {
        userId: user.id,
        memberId: res.user.id,
        source: "email_match",
      });
      if (stored) {
        result.matched += 1;
      } else {
        result.failed += 1;
        note("db_write_failed");
      }
    } catch (err) {
      console.error("[slack-links] lookup threw", err);
      result.failed += 1;
      note(err instanceof Error ? err.message : "threw");
    }

    // A wall of identical errors means the run is broken, not that
    // individual people are missing — stop rather than spend minutes
    // repeating a call that cannot succeed.
    if (result.failed >= ABORT_AFTER_FAILURES && result.matched === 0) {
      note("aborted_after_repeated_failures");
      break;
    }
  }

  return result;
}

// ────────────────────────────────────────────────────────────
// Internal
// ────────────────────────────────────────────────────────────

async function storeLink(
  admin: AdminClient,
  args: { userId: string; memberId: string; source: LinkSource }
): Promise<boolean> {
  const { error } = await admin
    .from("users")
    .update({
      slack_user_id: args.memberId,
      slack_linked_at: new Date().toISOString(),
      slack_link_source: args.source,
    })
    .eq("id", args.userId);
  if (error) {
    console.error("[slack-links] store failed", error);
    return false;
  }
  return true;
}

/** True when another Hub user already holds this Slack member id. */
async function memberIdTakenBy(
  admin: AdminClient,
  memberId: string,
  exceptUserId: string
): Promise<boolean> {
  const { data } = await admin
    .from("users")
    .select("id")
    .eq("slack_user_id", memberId)
    .neq("id", exceptUserId)
    .limit(1);
  return ((data ?? []) as unknown[]).length > 0;
}
