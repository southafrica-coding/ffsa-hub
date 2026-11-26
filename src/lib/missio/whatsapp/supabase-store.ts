// ────────────────────────────────────────────────────────────
// Missio WhatsApp — the store on Supabase (service role)
// ────────────────────────────────────────────────────────────
// Server only. Used by the webhook (no session) and by the send route after
// the pastor check. Tables from migration 396; the menu bot's from 397
// (bot/types.ts BotStore). See store.ts for the rules.

import { MISSIO_SLUG } from "@/lib/missio/access";
import type { BotStore, SessionRow, Team } from "./bot/types";
import type { Leader } from "./bot/templates";
import { whatsAppE164 } from "./phone";
import { furthestStatus, statusesThatCanBecome, type OutboundStatus } from "./rules";
import {
  isMissingRelation,
  WhatsAppNotInstalledError,
  type MessageRow,
  type ThreadRow,
  type WhatsAppStore,
} from "./store";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const THREADS = "missio_whatsapp_threads";
const MESSAGES = "missio_whatsapp_messages";
const STATUS_EVENTS = "missio_whatsapp_status_events";
const SESSIONS = "missio_whatsapp_bot_sessions";
const OUTBOX = "missio_whatsapp_bot_outbox";
const INTERESTS = "missio_serving_interests";

/** Postgres unique violation: the row was already there. */
const isDuplicate = (error: { code?: string } | null | undefined) => error?.code === "23505";

function check<T>(result: { data: T; error: { code?: string; message?: string } | null }, what: string): T {
  if (result.error) {
    if (isMissingRelation(result.error)) throw new WhatsAppNotInstalledError();
    throw new Error(`[missio-whatsapp] ${what} failed: ${result.error.code ?? "db error"}`);
  }
  return result.data;
}

export function supabaseWhatsAppStore(admin: Client): WhatsAppStore & BotStore {
  let orgId: string | null | undefined;

  async function findThread(org: string, e164: string): Promise<ThreadRow | null> {
    return check(
      await admin.from(THREADS).select("*").eq("org_id", org).eq("phone_e164", e164).maybeSingle(),
      "thread read"
    ) as ThreadRow | null;
  }

  return {
    async missioOrgId() {
      if (orgId !== undefined) return orgId;
      const row = check(await admin.from("organisations").select("id").eq("slug", MISSIO_SLUG).maybeSingle(), "org lookup") as {
        id?: string;
      } | null;
      orgId = row?.id ?? null;
      return orgId;
    },

    async matchContact(org, e164) {
      const phones = check(
        await admin.from("contact_phones").select("contact_id").eq("phone_normalized", e164).limit(20),
        "phone match"
      ) as Array<{ contact_id: string }> | null;
      const ids = [...new Set((phones ?? []).map((row) => row.contact_id))];
      if (ids.length === 0) return null;
      const people = check(
        await admin.from("org_people").select("contact_id").eq("org_id", org).in("contact_id", ids),
        "person match"
      ) as Array<{ contact_id: string }> | null;
      const inMissio = [...new Set((people ?? []).map((row) => row.contact_id))];
      // A number shared by two people (a household phone) stays unlinked rather than guessing.
      return inMissio.length === 1 ? inMissio[0] : null;
    },

    findThread,

    async ensureThread({ orgId: org, e164, waId, contactId, profileName }) {
      check(
        await admin
          .from(THREADS)
          .upsert(
            { org_id: org, phone_e164: e164, wa_id: waId, contact_id: contactId, profile_name: profileName },
            { onConflict: "org_id,phone_e164", ignoreDuplicates: true }
          ),
        "thread create"
      );
      let thread = await findThread(org, e164);
      if (!thread) throw new Error("[missio-whatsapp] thread missing after create");
      const patch: Record<string, unknown> = {};
      if (!thread.contact_id && contactId) patch.contact_id = contactId;
      if (profileName && profileName !== thread.profile_name) patch.profile_name = profileName;
      if (Object.keys(patch).length > 0) {
        thread = check(
          await admin.from(THREADS).update(patch).eq("id", thread.id).select("*").single(),
          "thread link"
        ) as ThreadRow;
      }
      return thread;
    },

    async insertInbound(input) {
      const rows = check(
        await admin
          .from(MESSAGES)
          .upsert(
            {
              org_id: input.orgId,
              thread_id: input.threadId,
              direction: "in",
              kind: input.kind,
              wa_type: input.waType,
              body: input.body,
              wamid: input.wamid,
              status: "received",
              opt_change: input.optChange,
              sent_at: input.at,
              // 397 column: only sent when there is one, so text keeps working before 397 is applied.
              ...(input.replyId ? { wa_reply_id: input.replyId } : {}),
            },
            { onConflict: "wamid", ignoreDuplicates: true }
          )
          .select("id"),
        "inbound insert"
      ) as Array<{ id: string }> | null;
      const id = rows?.[0]?.id ?? null;
      return { inserted: Boolean(id), id };
    },

    async insertOutbound(input) {
      return check(
        await admin
          .from(MESSAGES)
          .insert({
            org_id: input.orgId,
            thread_id: input.threadId,
            direction: "out",
            kind: input.kind,
            wa_type: input.waType ?? input.kind,
            body: input.body,
            template_name: input.templateName,
            template_language: input.templateLanguage,
            template_vars: input.templateVars,
            status: "pending",
            sent_by: input.sentBy,
            sent_at: input.at,
            ...(input.sentByBot ? { sent_by_bot: true } : {}),
          })
          .select("*")
          .single(),
        "outbound insert"
      ) as MessageRow;
    },

    async bumpThread(threadId, input) {
      check(
        await admin.rpc("missio_whatsapp_bump_thread", {
          p_thread_id: threadId,
          p_message_id: input.messageId,
          p_direction: input.direction,
          p_at: input.at,
          p_preview: input.preview,
          p_opt_change: input.optChange,
        }),
        "thread bump"
      );
    },

    async acceptOutbound(messageId, wamid) {
      check(
        await admin.from(MESSAGES).update({ wamid, status: "accepted", status_at: new Date().toISOString() }).eq("id", messageId).eq("status", "pending"),
        "outbound accept"
      );
      // A webhook status can beat us here; it waited in the status log.
      const early = check(
        await admin.from(STATUS_EVENTS).select("status, at, error_code, error_title").eq("wamid", wamid),
        "status log read"
      ) as Array<{ status: OutboundStatus; at: string; error_code: number | null; error_title: string | null }> | null;
      const best = furthestStatus((early ?? []).map((row) => row.status));
      if (best) {
        const event = (early ?? []).find((row) => row.status === best);
        check(
          await admin
            .from(MESSAGES)
            .update({ status: best, status_at: event?.at ?? null, error_code: event?.error_code ?? null, error_title: event?.error_title ?? null })
            .eq("id", messageId)
            .in("status", statusesThatCanBecome(best)),
          "early status apply"
        );
      }
      return check(await admin.from(MESSAGES).select("*").eq("id", messageId).single(), "outbound read") as MessageRow;
    },

    async failOutbound(messageId, error) {
      return check(
        await admin
          .from(MESSAGES)
          .update({ status: "failed", error_code: error.code, error_title: error.title.slice(0, 300), status_at: new Date().toISOString() })
          .eq("id", messageId)
          .select("*")
          .single(),
        "outbound fail"
      ) as MessageRow;
    },

    async recordStatus(input) {
      check(
        await admin.from(STATUS_EVENTS).upsert(
          {
            org_id: input.orgId,
            wamid: input.wamid,
            status: input.status,
            at: input.at,
            error_code: input.errorCode,
            error_title: input.errorTitle,
          },
          { onConflict: "wamid,status", ignoreDuplicates: true }
        ),
        "status log"
      );
      const patch: Record<string, unknown> = { status: input.status, status_at: input.at };
      if (input.status === "failed") {
        patch.error_code = input.errorCode;
        patch.error_title = input.errorTitle;
      }
      check(
        await admin
          .from(MESSAGES)
          .update(patch)
          .eq("wamid", input.wamid)
          .eq("org_id", input.orgId)
          .eq("direction", "out")
          .in("status", statusesThatCanBecome(input.status)),
        "status apply"
      );
    },

    // ── Menu bot (397) ──────────────────────────────────────

    async claimTurn({ orgId: org, threadId, wamid, at }) {
      const res = await admin
        .from(OUTBOX)
        .insert({ org_id: org, thread_id: threadId, inbound_wamid: wamid, inbound_at: at, purpose: "turn", seq: 0, status: "pending" })
        .select("id");
      if (isDuplicate(res.error)) return false;
      const rows = check(res, "bot turn claim") as Array<{ id: string }> | null;
      return Boolean(rows?.[0]?.id);
    },

    async finishTurn(wamid, status, error) {
      check(
        await admin
          .from(OUTBOX)
          .update({ status, error_code: error?.code ?? null, error_title: error?.title?.slice(0, 300) ?? null })
          .eq("inbound_wamid", wamid)
          .eq("purpose", "turn")
          .eq("seq", 0),
        "bot turn finish"
      );
    },

    async newerTurnExists(threadId, at, wamid) {
      const rows = check(
        await admin.from(OUTBOX).select("id").eq("thread_id", threadId).eq("purpose", "turn").gt("inbound_at", at).neq("inbound_wamid", wamid).limit(1),
        "bot order check"
      ) as Array<{ id: string }> | null;
      return (rows ?? []).length > 0;
    },

    async getThread(threadId) {
      return check(await admin.from(THREADS).select("*").eq("id", threadId).maybeSingle(), "thread read") as ThreadRow | null;
    },

    async openSession(threadId) {
      return check(
        await admin.from(SESSIONS).select("*").eq("thread_id", threadId).is("closed_at", null).maybeSingle(),
        "bot session read"
      ) as SessionRow | null;
    },

    async saveSession(input) {
      const row = { flow: input.flow, step: input.step, data: input.data, failures: input.failures, last_inbound_wamid: input.wamid };
      const updated = check(
        await admin.from(SESSIONS).update(row).eq("thread_id", input.threadId).is("closed_at", null).select("id"),
        "bot session update"
      ) as Array<{ id: string }> | null;
      if ((updated ?? []).length > 0) return;
      check(await admin.from(SESSIONS).insert({ org_id: input.orgId, thread_id: input.threadId, ...row }), "bot session insert");
    },

    async closeSession(threadId, reason) {
      check(
        await admin
          .from(SESSIONS)
          .update({ closed_at: new Date().toISOString(), closed_reason: reason })
          .eq("thread_id", threadId)
          .is("closed_at", null),
        "bot session close"
      );
    },

    async setBotMode(threadId, input) {
      const on = input.mode === "on";
      check(
        await admin
          .from(THREADS)
          .update({
            bot_mode: input.mode,
            bot_handoff_reason: on ? null : input.reason,
            bot_paused_at: on ? null : input.at,
            bot_paused_by: on ? null : input.by,
          })
          .eq("id", threadId),
        "bot mode"
      );
    },

    async enqueueReply(input) {
      const res = await admin
        .from(OUTBOX)
        .insert({
          org_id: input.orgId,
          thread_id: input.threadId,
          inbound_wamid: input.wamid,
          inbound_at: input.at,
          purpose: "reply",
          seq: input.seq,
          payload: input.payload,
          status: "pending",
        })
        .select("id");
      if (isDuplicate(res.error)) return null;
      const rows = check(res, "bot reply queue") as Array<{ id: string }> | null;
      return rows?.[0]?.id ? { id: rows[0].id } : null;
    },

    async finishReply(id, input) {
      check(
        await admin
          .from(OUTBOX)
          .update({
            status: input.status,
            message_id: input.messageId,
            error_code: input.error?.code ?? null,
            error_title: input.error?.title?.slice(0, 300) ?? null,
          })
          .eq("id", id),
        "bot reply finish"
      );
    },

    async insertServingInterest(input) {
      const row = check(
        await admin
          .from(INTERESTS)
          .insert({
            org_id: input.orgId,
            thread_id: input.threadId,
            contact_id: input.contactId,
            teams: input.teams,
            availability: input.availability,
            experience: input.experience,
          })
          .select("id")
          .single(),
        "serving interest insert"
      ) as { id: string };
      return { id: row.id };
    },

    async setServingInterestNote(id, note) {
      check(await admin.from(INTERESTS).update({ note: note.slice(0, 1000) }).eq("id", id), "serving interest note");
    },

    async liveTeams(org) {
      const rows = check(await admin.from("missio_teams").select("id, name").eq("org_id", org).order("name"), "teams read") as Team[] | null;
      return rows ?? [];
    },

    async contactFirstName(contactId) {
      const row = check(
        await admin.from("contacts").select("first_name, preferred_name").eq("id", contactId).maybeSingle(),
        "contact name"
      ) as { first_name?: string | null; preferred_name?: string | null } | null;
      return row?.preferred_name?.trim() || row?.first_name?.trim() || null;
    },
  };
}

/**
 * Leaders of a Missio team (333 missio_team_leaders → contacts), for the
 * leader notice. Only read when LEADER_NOTIFY_TEMPLATES_ENABLED is on —
 * never in this PR. Phones go to Graph only, never to a log or the browser.
 */
export function supabaseLeadersFor(admin: Client): (teamId: string) => Promise<Leader[]> {
  return async (teamId) => {
    const leaders = check(
      await admin.from("missio_team_leaders").select("contact_id").eq("team_id", teamId).limit(10),
      "team leaders"
    ) as Array<{ contact_id: string }> | null;
    const ids = (leaders ?? []).map((row) => row.contact_id);
    if (ids.length === 0) return [];
    const contacts = check(
      await admin.from("contacts").select("id, first_name, preferred_name, phone").in("id", ids),
      "leader contacts"
    ) as Array<{ id: string; first_name?: string | null; preferred_name?: string | null; phone?: string | null }> | null;
    return (contacts ?? []).map((c) => ({
      contactId: c.id,
      firstName: c.preferred_name?.trim() || c.first_name?.trim() || null,
      e164: whatsAppE164(c.phone ?? null),
    }));
  };
}
