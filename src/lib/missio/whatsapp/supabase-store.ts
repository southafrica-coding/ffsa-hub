// ────────────────────────────────────────────────────────────
// Missio WhatsApp — the store on Supabase (service role)
// ────────────────────────────────────────────────────────────
// Server only. Used by the webhook (no session) and by the send route after
// the pastor check. Tables from migration 396. See store.ts for the rules.

import { MISSIO_SLUG } from "@/lib/missio/access";
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

function check<T>(result: { data: T; error: { code?: string; message?: string } | null }, what: string): T {
  if (result.error) {
    if (isMissingRelation(result.error)) throw new WhatsAppNotInstalledError();
    throw new Error(`[missio-whatsapp] ${what} failed: ${result.error.code ?? "db error"}`);
  }
  return result.data;
}

export function supabaseWhatsAppStore(admin: Client): WhatsAppStore {
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
            wa_type: input.kind,
            body: input.body,
            template_name: input.templateName,
            template_language: input.templateLanguage,
            template_vars: input.templateVars,
            status: "pending",
            sent_by: input.sentBy,
            sent_at: input.at,
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
  };
}
