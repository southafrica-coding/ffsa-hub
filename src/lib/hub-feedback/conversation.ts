/**
 * The DM intake conversation engine.
 *
 * Given an active session and a new inbound DM message, Claude decides
 * whether to ask another clarifying question, answer a how-to directly,
 * or finalize the report. On finalize we classify, dedup, persist, and
 * post a brief to #hub-triage — all in the background via after().
 */

import * as slack from "@/lib/slack/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveHubUserBySlackId } from "@/services/slack-bot";
import { getClient, extractJson, textOf, HAIKU_MODEL } from "./ai";
import { classify } from "./triage";
import { findDuplicate } from "./dedup";
import { renderIssueBrief, duplicateNote, ackNew, ackDuplicate } from "./brief";
import * as store from "./store";
import type Anthropic from "@anthropic-ai/sdk";
import type {
  CollectedInfo,
  IntakeSession,
  MediaRef,
  TranscriptTurn,
} from "./types";

const MAX_CLARIFYING_TURNS = 4;

export const OPENER =
  "Hi! 👋 I'll help get this sorted and make sure the right people see it. " +
  "In a sentence or two — what went wrong, or what would you like changed? " +
  "A screenshot helps if you have one.";

type Decision = {
  action: "ask" | "answer" | "finalize";
  message: string;
  collected?: CollectedInfo;
  report_text?: string;
};

function buildSystem(hasMedia: boolean, userTurns: number): string {
  return `You are the FFSA Hub feedback assistant, chatting 1:1 with a staff member in Slack DM.
Your job: understand their bug/idea well enough to log it, in as FEW questions as possible.

Respond with a JSON object ONLY:
{ "action": "ask" | "answer" | "finalize",
  "message": "<what to send the user>",
  "collected": { "title": "", "summary": "", "area": "", "type": "bug|idea|question", "expected": "", "actual": "" },
  "report_text": "<only for finalize: a clear 2-4 sentence description of the issue>" }

Guidance:
- "ask": send ONE short, friendly clarifying question. Ask only what you still need (which screen? expected vs actual? steps?). ${hasMedia ? "They have already attached a screenshot — do NOT ask for one." : "If a screenshot would help and none is attached, you may ask for one."}
- Before finalizing, CONFIRM your understanding once ("So, to confirm: … — is that right?") as an "ask".
- "finalize": once they've confirmed (or it's already unambiguous), set report_text and a filled "collected". Keep message brief; the system sends its own confirmation, so message can be empty.
- "answer": if it's just a how-to question you can answer directly (no change needed), put the answer in message and we'll close it out.
- Keep every message under ~350 characters, warm and plain. You have asked ${userTurns} question(s) already${
    userTurns >= MAX_CLARIFYING_TURNS
      ? " — you have asked enough, FINALIZE now with your best understanding."
      : "."
  }`;
}

function toAnthropicMessages(transcript: TranscriptTurn[]): Anthropic.MessageParam[] {
  return transcript.map((t) => ({
    role: t.role === "user" ? "user" : "assistant",
    content: t.text,
  }));
}

async function decide(
  transcript: TranscriptTurn[],
  hasMedia: boolean
): Promise<Decision> {
  const userTurns = transcript.filter((t) => t.role === "user").length;
  try {
    const res = await getClient().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 900,
      system: buildSystem(hasMedia, userTurns),
      messages: toAnthropicMessages(transcript),
    });
    const parsed = extractJson<Decision>(textOf(res));
    if (parsed && parsed.action) return parsed;
  } catch (err) {
    console.error("[hub-feedback/conversation] decide failed", err);
  }
  // Fallback: keep the conversation alive with a gentle nudge.
  return {
    action: "ask",
    message:
      "Got it — can you tell me a little more about what you expected to happen versus what actually happened?",
  };
}

/**
 * Handle one inbound DM turn for an active session. Runs in the
 * background (after()) — safe to take several seconds.
 */
export async function handleTurn(args: {
  session: IntakeSession;
  text: string;
  newMedia: MediaRef[];
  eventId: string | null;
}): Promise<void> {
  const { session, text, newMedia, eventId } = args;

  // Idempotency: Slack can redeliver; don't double-process an event.
  if (eventId && session.last_event_id === eventId) return;

  const transcript: TranscriptTurn[] = [
    ...session.transcript,
    { role: "user", text, ts: new Date().toISOString() },
  ];
  const media = [...session.media, ...newMedia];

  const decision = await decide(transcript, media.length > 0);
  const collected = { ...session.collected, ...(decision.collected ?? {}) };

  const post = (message: string) =>
    slack.postMessage({ channel: session.dm_channel_id, text: message });

  if (decision.action === "ask") {
    const message = decision.message?.trim() || OPENER;
    await post(message);
    transcript.push({ role: "bot", text: message, ts: new Date().toISOString() });
    await store.updateSession(session.id, {
      transcript,
      collected,
      media,
      last_event_id: eventId,
    });
    return;
  }

  if (decision.action === "answer") {
    const message =
      decision.message?.trim() ||
      "Hope that helps! Message me again any time something comes up. 🙏";
    await post(message);
    transcript.push({ role: "bot", text: message, ts: new Date().toISOString() });
    await store.updateSession(session.id, {
      transcript,
      collected,
      media,
      status: "completed",
      last_event_id: eventId,
    });
    return;
  }

  // action === "finalize"
  const reportText =
    decision.report_text?.trim() ||
    collected.summary ||
    transcript
      .filter((t) => t.role === "user")
      .map((t) => t.text)
      .join(" ")
      .slice(0, 500);

  await finalize({ session, transcript, collected, media, reportText, eventId });
}

async function finalize(args: {
  session: IntakeSession;
  transcript: TranscriptTurn[];
  collected: CollectedInfo;
  media: MediaRef[];
  reportText: string;
  eventId: string | null;
}): Promise<void> {
  const { session, transcript, collected, media, reportText, eventId } = args;

  const classification = await classify(collected, reportText);

  // Resolve who's reporting, for labels + linkage.
  const admin = createAdminClient();
  const hubUserId = await resolveHubUserBySlackId(admin, session.slack_user_id).catch(
    () => null
  );
  let name: string | null = null;
  let email: string | null = null;
  try {
    const info = await slack.usersInfo(session.slack_user_id);
    if (info.ok && info.user) {
      name = info.user.profile?.real_name || info.user.real_name || null;
      email = info.user.profile?.email || null;
    }
  } catch {
    /* labels are best-effort */
  }

  // Dedup against open issues in the same area.
  const candidates = await store.getOpenIssuesByArea(classification.area);
  const dup = await findDuplicate(classification, reportText, candidates);

  const triageChannel = process.env.SLACK_TRIAGE_CHANNEL_ID;

  if (dup) {
    const count = await store.registerDuplicateReport(dup, media);
    await store.addReport({
      issueId: dup.id,
      reporterSlackId: session.slack_user_id,
      reporterHubUserId: hubUserId,
      reporterName: name,
      reporterEmail: email,
      reportText,
      transcript,
      media,
    });
    if (triageChannel && dup.triage_channel_ts) {
      await slack
        .postMessage({
          channel: triageChannel,
          text: duplicateNote(count, name),
          thread_ts: dup.triage_channel_ts,
        })
        .catch((e) => console.error("[hub-feedback] dup note failed", e));
    }
    await slack.postMessage({
      channel: session.dm_channel_id,
      text: ackDuplicate(dup.title),
    });
    await store.updateSession(session.id, {
      transcript,
      collected,
      media,
      status: "completed",
      last_event_id: eventId,
    });
    return;
  }

  const issue = await store.createIssue({ classification, media });
  if (issue) {
    await store.addReport({
      issueId: issue.id,
      reporterSlackId: session.slack_user_id,
      reporterHubUserId: hubUserId,
      reporterName: name,
      reporterEmail: email,
      reportText,
      transcript,
      media,
    });
    if (triageChannel) {
      const brief = renderIssueBrief(issue, classification, name);
      const res = await slack
        .postMessage({ channel: triageChannel, text: brief.text, blocks: brief.blocks })
        .catch((e) => {
          console.error("[hub-feedback] brief post failed", e);
          return null;
        });
      if (res && res.ok && res.ts) await store.setTriageTs(issue.id, res.ts);
    } else {
      console.warn("[hub-feedback] SLACK_TRIAGE_CHANNEL_ID not set — brief skipped");
    }
    await slack.postMessage({
      channel: session.dm_channel_id,
      text: ackNew(issue.type, issue.title),
    });
  }

  await store.updateSession(session.id, {
    transcript,
    collected,
    media,
    status: "completed",
    last_event_id: eventId,
  });
}
