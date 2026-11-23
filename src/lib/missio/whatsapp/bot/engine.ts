// ────────────────────────────────────────────────────────────
// Missio WhatsApp menu — answering one stored inbound message
// ────────────────────────────────────────────────────────────
// Server only. Runs after the webhook has verified the signature, stored
// the message (once per wamid) and moved the thread on, and after the 200
// (bot/schedule.ts). In order:
//
//   1. claim the turn for this wamid        a second delivery answers nothing
//   2. STOP / UNSUBSCRIBE                    the opt-out is already applied: send nothing
//   3. opted out (and not a START just now)  send nothing
//   4. a newer message already answered      send nothing (keeps the order)
//   5. outside the 24-hour window            send nothing — hard rule, even for a late job
//   6. bot paused or handed off              send nothing: a pastor has the chat
//   7. START / YES that lifted an opt-out    the welcome again
//   8. otherwise flow.ts decides; the serving interest, session and
//      hand-off are written, then each reply is queued in the outbox,
//      re-checked (opted out? paused? window?) and sent.
//
// Nothing here ever creates a Missio person or contact.

import type { SendConfig } from "../config";
import { sendWhatsApp, type FetchLike } from "../graph";
import { inServiceWindow, previewOf } from "../rules";
import type { ThreadRow, WhatsAppStore } from "../store";
import { FALLBACK_TEAMS } from "./copy";
import { decide, SESSION_IDLE_MS, welcome, type FlowDecision } from "./flow";
import type { Limiter } from "./limiter";
import { interactiveProblem, readableBody } from "./messages";
import { notifyLeaderByTemplate, type NotifyDeps } from "./templates";
import type { BotJob, BotMessage, BotStore, Team } from "./types";

export type BotDeps = {
  store: WhatsAppStore & BotStore;
  config: SendConfig | null;
  limiter: Limiter;
  notify: Omit<NotifyDeps, "config" | "findThread">;
  fetcher?: FetchLike;
  now?: () => Date;
};

export type BotOutcome =
  | "not_configured"
  | "duplicate"
  | "opt_out"
  | "opted_out"
  | "no_thread"
  | "stale"
  | "window_closed"
  | "paused"
  | "silent"
  | "answered";

export type BotResult = { outcome: BotOutcome; sent: number; failed: number };

/** Fallback ids are namespaced so they can never collide with a missio_teams uuid. */
export const FALLBACK_TEAM_LIST: Team[] = [...FALLBACK_TEAMS.map((t) => ({ id: `fallback-${t.id}`, name: t.name }))];

/** Live teams, or the fallback list when there are none or the read fails (closed). */
export async function teamsFor(store: BotStore, orgId: string): Promise<Team[]> {
  try {
    const live = (await store.liveTeams(orgId)).filter((t) => t.id && t.name.trim());
    if (live.length > 0) return [...live].sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    console.error("[missio-whatsapp-bot] teams read failed; using the fallback list");
  }
  return FALLBACK_TEAM_LIST;
}

/** A WhatsApp profile name is only used if it looks like a first name. */
export function firstNameFromProfile(profileName: string | null | undefined): string | null {
  const first = (profileName ?? "").trim().split(/\s+/)[0] ?? "";
  return /^\p{L}[\p{L}'-]{0,29}$/u.test(first) ? first : null;
}

async function nameFor(store: BotStore, thread: ThreadRow): Promise<string | null> {
  if (thread.contact_id) {
    try {
      const name = await store.contactFirstName(thread.contact_id);
      if (name?.trim()) return name.trim().split(/\s+/)[0].slice(0, 30);
    } catch {
      // Fall through to the WhatsApp name.
    }
  }
  return firstNameFromProfile(thread.profile_name);
}

const modeOf = (thread: ThreadRow) => thread.bot_mode ?? "on";

export async function processBotJob(deps: BotDeps, job: BotJob): Promise<BotResult> {
  const { store } = deps;
  const now = () => deps.now?.() ?? new Date();
  const result: BotResult = { outcome: "silent", sent: 0, failed: 0 };
  const done = (outcome: BotOutcome) => ({ ...result, outcome });

  if (!deps.config) return done("not_configured");

  if (!(await store.claimTurn({ orgId: job.orgId, threadId: job.threadId, wamid: job.wamid, at: job.at }))) return done("duplicate");

  let turnError: { code: number | null; title: string } | undefined;
  try {
    if (job.optChange === "opt_out") {
      await store.closeSession(job.threadId, "opted_out");
      return done("opt_out");
    }
    const thread = await store.getThread(job.threadId);
    if (!thread) return done("no_thread");
    if (thread.opted_out_at) return done("opted_out");
    if (await store.newerTurnExists(job.threadId, job.at, job.wamid)) return done("stale");
    if (!inServiceWindow(job.at, now()) || !inServiceWindow(thread.last_inbound_at, now())) return done("window_closed");
    if (modeOf(thread) !== "on") return done("paused");

    let session = await store.openSession(job.threadId);
    if (session && now().getTime() - Date.parse(session.updated_at) > SESSION_IDLE_MS) {
      await store.closeSession(job.threadId, "expired");
      session = null;
    }

    const teams = await teamsFor(store, job.orgId);
    const name = await nameFor(store, thread);
    const lifted = job.optChange === "opt_in" && job.wasOptedOut;
    const decision: FlowDecision = lifted
      ? welcome()
      : decide({
          session: session ? { flow: session.flow, step: session.step, data: session.data ?? {}, failures: session.failures } : null,
          inbound: { kind: job.kind, text: job.text, replyId: job.replyId },
          teams,
          name,
        });

    // ── Writes, before anything is sent ──
    let nextSession = decision.session;
    if (decision.interest && decision.interest.teams.length > 0) {
      const saved = await store.insertServingInterest({
        orgId: job.orgId,
        threadId: job.threadId,
        // Only an existing one-person link (396 matchContact). Never a new person.
        contactId: thread.contact_id,
        teams: decision.interest.teams,
        availability: decision.interest.availability ?? null,
        experience: decision.interest.experience ?? null,
      });
      if (nextSession && "flow" in nextSession) nextSession = { ...nextSession, data: { ...nextSession.data, interestId: saved.id } };
      for (const team of decision.interest.teams) {
        try {
          await notifyLeaderByTemplate(
            { ...deps.notify, config: deps.config, findThread: (org, e164) => store.findThread(org, e164), fetcher: deps.fetcher },
            {
              orgId: job.orgId,
              template: "serve_leader_interest",
              teamId: team.id && !team.id.startsWith("fallback-") ? team.id : null,
              teamName: team.name,
              personFirstName: name,
            }
          );
        } catch {
          console.error("[missio-whatsapp-bot] leader notice failed; the Hub inbox still has it");
        }
      }
    }
    const interestId = session?.data?.interestId;
    if (decision.note && interestId) await store.setServingInterestNote(interestId, decision.note);

    if (nextSession && "close" in nextSession) await store.closeSession(job.threadId, nextSession.close);
    else if (nextSession) {
      await store.saveSession({ orgId: job.orgId, threadId: job.threadId, ...nextSession, wamid: job.wamid });
    }
    if (decision.handoff) {
      await store.setBotMode(job.threadId, { mode: "handed_off", reason: decision.handoff, by: null, at: now().toISOString() });
    }

    // ── Sends ──
    let seq = 0;
    for (const reply of decision.replies) {
      seq += 1;
      const ok = await sendOne(deps, job, reply, seq, { handoff: Boolean(decision.handoff) }, now);
      if (ok === true) result.sent += 1;
      else if (ok === false) result.failed += 1;
    }
    return done(decision.replies.length > 0 ? "answered" : "silent");
  } catch (error) {
    turnError = { code: null, title: error instanceof Error ? error.message.slice(0, 200) : "bot error" };
    throw error;
  } finally {
    await store.finishTurn(job.wamid, turnError ? "failed" : "sent", turnError).catch(() => undefined);
  }
}

/** Queue, re-check, send one reply. True sent, false failed, null not sent (guard or duplicate). */
async function sendOne(
  deps: BotDeps,
  job: BotJob,
  reply: BotMessage,
  seq: number,
  opts: { handoff: boolean },
  now: () => Date
): Promise<boolean | null> {
  const { store } = deps;
  const config = deps.config as SendConfig;
  const problem = interactiveProblem(reply);
  if (problem) {
    console.error("[missio-whatsapp-bot] refusing a malformed menu message", problem);
    return null;
  }
  const queued = await store.enqueueReply({ orgId: job.orgId, threadId: job.threadId, wamid: job.wamid, at: job.at, seq, payload: reply });
  if (!queued) return null;

  // Re-read right before sending: a STOP, a pastor's Pause or the end of
  // the 24 hours may have landed since the decision.
  const thread = await store.getThread(job.threadId);
  const mode = thread ? modeOf(thread) : null;
  const modeOk = mode === "on" || (opts.handoff && mode === "handed_off");
  const guard = !thread
    ? "no thread"
    : thread.opted_out_at
      ? "opted out"
      : !modeOk
        ? "a pastor has the chat"
        : !inServiceWindow(thread.last_inbound_at, now())
          ? "outside the 24-hour window"
          : null;
  if (guard || !thread) {
    await store.finishReply(queued.id, { status: "failed", messageId: null, error: { code: null, title: `Not sent: ${guard}` } });
    return null;
  }

  const at = now().toISOString();
  const body = readableBody(reply);
  const pending = await store.insertOutbound({
    orgId: job.orgId,
    threadId: job.threadId,
    kind: "text",
    body,
    templateName: null,
    templateLanguage: null,
    templateVars: null,
    sentBy: null,
    sentByBot: true,
    waType: reply.kind === "text" ? "text" : "interactive",
    at,
  });
  await store.bumpThread(job.threadId, { messageId: pending.id, direction: "out", at, preview: previewOf(body), optChange: null });

  const sent = await deps.limiter.run(() => sendWhatsApp(config, { ...reply, to: thread.phone_e164 }, deps.fetcher));
  if (!sent.ok) {
    await store.failOutbound(pending.id, sent.error);
    await store.finishReply(queued.id, { status: "failed", messageId: pending.id, error: sent.error });
    return false;
  }
  await store.acceptOutbound(pending.id, sent.wamid);
  await store.finishReply(queued.id, { status: "sent", messageId: pending.id });
  return true;
}
