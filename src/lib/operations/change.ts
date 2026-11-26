// Operations — the one way an item changes, from the Hub, a Slack ⋯ menu
// or the meeting page. Writes the item, writes the log, then (best-effort)
// tells whoever asked and whoever was just given it.

import * as slack from "@/lib/slack/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { addUpdates, claimReminder, getItem, getUserBrief, updateItem, type UpdateRow } from "@/services/operations";
import { isClosed, isStatus, type ItemStatus, type OpsItem } from "./areas";
import { sastDate } from "./dates";
import { reminderMessage, requesterMessage, type Message } from "./messages";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

type ItemRow = Omit<OpsItem, "owner_name"> & {
  owner?: { display_name: string | null; slack_user_id: string | null } | { display_name: string | null; slack_user_id: string | null }[] | null;
};

export function toItem(row: ItemRow): OpsItem {
  const owner = Array.isArray(row.owner) ? row.owner[0] : row.owner;
  return { ...row, owner_name: owner?.display_name ?? null } as OpsItem;
}

export type Actor = { userId: string | null; name: string | null };

export type ChangeInput = {
  itemId: string;
  status?: ItemStatus;
  note?: string | null;
  /** undefined = leave; null = take it off whoever has it */
  ownerUserId?: string | null;
  /** undefined = leave; null = clear the date */
  dueOn?: string | null;
  actor: Actor;
  via: "hub" | "slack" | "meeting";
};

export type ChangeResult = { ok: true; item: OpsItem } | { ok: false; status: number; error: string };

export async function applyChange(client: Client, input: ChangeInput): Promise<ChangeResult> {
  const { data: row, error: readErr } = await getItem(client, input.itemId);
  if (readErr) return { ok: false, status: 500, error: readErr.message };
  if (!row) return { ok: false, status: 404, error: "Not found" };
  const before = toItem(row);

  if (input.status !== undefined && !isStatus(input.status)) return { ok: false, status: 400, error: "Unknown status" };
  if (input.dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) return { ok: false, status: 400, error: "Bad date" };
  const note = input.note?.trim() ? input.note.trim().slice(0, 4000) : null;

  const patch: Record<string, unknown> = {};
  const log: UpdateRow[] = [];
  const base = { item_id: before.id, author_user_id: input.actor.userId, author_name: input.actor.name, via: input.via };

  const statusChanged = input.status !== undefined && input.status !== before.status;
  if (statusChanged) {
    patch.status = input.status;
    log.push({ ...base, kind: "status", status_to: input.status, note });
  }
  const ownerChanged = input.ownerUserId !== undefined && input.ownerUserId !== before.owner_user_id;
  if (ownerChanged) {
    patch.owner_user_id = input.ownerUserId;
    log.push({ ...base, kind: "assign", owner_to: input.ownerUserId });
  }
  const dueChanged = input.dueOn !== undefined && input.dueOn !== before.due_on;
  if (dueChanged) {
    patch.due_on = input.dueOn;
    log.push({ ...base, kind: "due", due_to: input.dueOn });
  }
  // A note on its own (or one riding with an assignment) is its own line.
  if (note && !statusChanged) log.push({ ...base, kind: "note", note });

  if (log.length === 0) return { ok: true, item: before };

  if (Object.keys(patch).length) {
    const { error } = await updateItem(client, before.id, patch);
    if (error) return { ok: false, status: error.code === "42501" || /operations team/.test(error.message) ? 403 : 500, error: error.message };
  }
  const { error: logErr } = await addUpdates(client, log);
  if (logErr) return { ok: false, status: 500, error: logErr.message };

  const after: OpsItem = {
    ...before,
    status: (patch.status as ItemStatus) ?? before.status,
    owner_user_id: ownerChanged ? (input.ownerUserId ?? null) : before.owner_user_id,
    due_on: dueChanged ? (input.dueOn ?? null) : before.due_on,
  };

  // Tell people — never fails the change.
  try {
    const admin = createAdminClient();
    if (statusChanged && before.requested_by_slack_id) {
      const msg = requesterMessage(after, after.status, note, input.actor.name);
      if (msg) await dm(before.requested_by_slack_id, msg);
    }
    if ((ownerChanged || dueChanged) && after.owner_user_id && after.owner_user_id !== input.actor.userId && !isClosed(after.status)) {
      await sendAssigned(admin, after, input.actor.name);
    }
  } catch (err) {
    console.error("[operations] notify failed", err);
  }

  return { ok: true, item: after };
}

/** DM a Slack user. Best-effort: returns false when it couldn't. */
export async function dm(slackUserId: string, message: Message): Promise<boolean> {
  try {
    const open = await slack.openConversation(slackUserId);
    if (!open.ok || !open.channel?.id) return false;
    const res = await slack.postMessage({ channel: open.channel.id, ...message });
    return res.ok;
  } catch (err) {
    console.error("[operations] dm failed", err);
    return false;
  }
}

async function sendAssigned(admin: Client, item: OpsItem, givenBy: string | null) {
  const { data: user } = await getUserBrief(admin, item.owner_user_id!);
  if (!user?.slack_user_id) return;
  // Once per item, person and date: re-saving the same task stays quiet.
  const fresh = await claimReminder(admin, { item_id: item.id, kind: "assigned", due_on: item.due_on, user_id: item.owner_user_id! });
  if (!fresh) return;
  await dm(user.slack_user_id, reminderMessage("assigned", item, sastDate(), givenBy));
}

export function displayName(u: { display_name?: string | null; person?: { first_name?: string; last_name?: string } | { first_name?: string; last_name?: string }[] | null } | null): string | null {
  if (!u) return null;
  const p = Array.isArray(u.person) ? u.person[0] : u.person;
  return u.display_name || [p?.first_name, p?.last_name].filter(Boolean).join(" ") || null;
}
