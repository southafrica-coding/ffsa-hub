/**
 * The Slack Q&A agent loop.
 *
 * Mirrors the Anthropic tool-use pattern from src/lib/ai/campaign-ai.ts,
 * but as a MULTI-TURN loop: Claude may call a tool, see the result, then
 * call another or answer. Runs in the background via after() from the
 * inbound route, so it can take longer than Slack's 3s ack window.
 *
 * v2a: curated tools only. Haiku by default; escalate to Sonnet for
 * open-ended questions (and, in v2c, whenever the read-only SQL tool is
 * used). The final answer is posted back into the Slack thread and one
 * audit row is written to slack_bot_queries.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import * as slack from "@/lib/slack/client";
import { CURATED_TOOLS, executeTool } from "./tools";
import { buildSystemPrompt } from "./prompt";
import {
  executeOutreachTool,
  OUTREACH_TOOLS,
  OUTREACH_TOOL_NAMES,
  sastDate,
  type OutreachScope,
} from "./outreach";
import { logSlackBotQuery, resolveHubUserBySlackId } from "@/services/slack-bot";

const HAIKU_MODEL = "claude-haiku-4-5-20251001"; // current Haiku (3.5-latest is EOL)
const SONNET_MODEL = "claude-sonnet-4-5-20250929"; // same pin as campaign-ai.ts

const MAX_TURNS = 6;
const BUDGET_MS = 45_000; // wall-clock cap; Slack route maxDuration is 60s
const TOOL_RESULT_CAP = 6_000; // chars of tool output fed back to the model

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    client = new Anthropic({ apiKey });
  }
  return client;
}

// Open-ended signals → start on Sonnet (better at multi-step reasoning).
const OPEN_ENDED = /\b(why|compare|trend|breakdown|across|average|growth|list everyone|each|per )\b/i;
function chooseInitialModel(text: string): string {
  return OPEN_ENDED.test(text) ? SONNET_MODEL : HAIKU_MODEL;
}

function modelLabel(model: string): string {
  return model === SONNET_MODEL ? "sonnet" : "haiku";
}

export type AssistantContext = {
  slackUserId: string;
  channelId: string;
  isDM: boolean;
  threadTs?: string;
  text: string;
  eventId?: string | null;
  /** The staff Q&A tools (allowlisted users in the admin channel / DMs). */
  admin: boolean;
  /** Set when this is an outreach team conversation (see outreach.ts). */
  outreach: OutreachScope | null;
};

export async function runAssistant(ctx: AssistantContext): Promise<void> {
  const t0 = Date.now();
  const admin = createAdminClient();
  const sqlEnabled = process.env.SLACK_ENABLE_SQL_TOOL === "true";

  // v2c adds run_readonly_query behind the flag
  const tools = [...(ctx.admin ? CURATED_TOOLS : []), ...(ctx.outreach ? OUTREACH_TOOLS : [])];
  const outreachPrompt = ctx.outreach
    ? {
        teams: ctx.outreach.teams,
        defaultTeam: ctx.outreach.teams.find((t) => t.id === ctx.outreach?.defaultTeamId)?.team_name ?? null,
        inTeamChannel: ctx.outreach.inTeamChannel,
        today: sastDate(new Date()),
      }
    : null;
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: ctx.text }];
  const toolCalls: Array<{ name: string; input: unknown }> = [];
  let sqlText: string | null = null;
  let model = chooseInitialModel(ctx.text);

  const post = (text: string) =>
    slack.postMessage({ channel: ctx.channelId, text, thread_ts: ctx.threadTs });

  const log = (answer: string | null) =>
    resolveHubUserBySlackId(admin, ctx.slackUserId)
      .then((hubUserId) =>
        logSlackBotQuery(admin, {
          slack_user_id: ctx.slackUserId,
          hub_user_id: hubUserId,
          channel_id: ctx.channelId,
          slack_event_id: ctx.eventId ?? null,
          question: ctx.text,
          tool_calls: toolCalls,
          sql_text: sqlText,
          answer,
          model_used: modelLabel(model),
          latency_ms: Date.now() - t0,
        })
      )
      .catch((err) => console.error("[slack/assistant] log failed", err));

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (Date.now() - t0 > BUDGET_MS) {
        const msg = "That's taking longer than expected — try narrowing the question.";
        await post(msg);
        await log(msg);
        return;
      }

      const res = await getClient().messages.create({
        model,
        max_tokens: 1500,
        system: buildSystemPrompt({ withSqlTool: sqlEnabled, admin: ctx.admin, outreach: outreachPrompt }),
        tools,
        messages,
      });

      const toolUses = res.content.filter(
        (c): c is Anthropic.ToolUseBlock => c.type === "tool_use"
      );

      if (toolUses.length === 0) {
        const textBlock = res.content.find(
          (c): c is Anthropic.TextBlock => c.type === "text"
        );
        const answer = textBlock?.text?.trim() || "I couldn't find an answer to that.";
        await post(answer);
        await log(answer);
        return;
      }

      // Escalate to Sonnet the moment the model reaches for SQL (v2c).
      if (toolUses.some((u) => u.name === "run_readonly_query")) model = SONNET_MODEL;

      messages.push({ role: "assistant", content: res.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const u of toolUses) {
        const input = (u.input ?? {}) as Record<string, unknown>;
        toolCalls.push({ name: u.name, input });
        if (u.name === "run_readonly_query" && typeof input.sql === "string") {
          sqlText = input.sql;
        }
        // Outreach tools run inside the asker's team scope; staff tools only
        // when this conversation is allowed them. A tool outside the set
        // the model was given is refused rather than run.
        const output = OUTREACH_TOOL_NAMES.has(u.name)
          ? ctx.outreach
            ? await executeOutreachTool(admin, ctx.outreach, u.name, input)
            : { error: "Not available here" }
          : ctx.admin
            ? await executeTool(u.name, input)
            : { error: "Not available here" };
        toolResults.push({
          type: "tool_result",
          tool_use_id: u.id,
          content: JSON.stringify(output).slice(0, TOOL_RESULT_CAP),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    // Ran out of turns without a final answer.
    const msg = "I wasn't able to wrap that up — try asking a more specific question.";
    await post(msg);
    await log(msg);
  } catch (err) {
    console.error("[slack/assistant] run failed", err);
    try {
      await post("Something went wrong answering that — the team has been notified.");
    } catch {
      /* swallow */
    }
    await log(null);
  }
}
