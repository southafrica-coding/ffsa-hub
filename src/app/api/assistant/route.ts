/**
 * POST /api/assistant — the in-app chat bubble.
 *
 * Body: {
 *   messages: [{ role: "user" | "assistant", content: string }],  // last turn = the new question
 *   pathname: string,           // page the user is on
 *   visibleText?: string        // text currently shown on screen (truncated client-side)
 * }
 *
 * Runs a short Claude tool-use loop AS the signed-in user: tools are
 * limited to modules they can open and query through their own
 * Supabase client (RLS). Read-only. Logged to ai_assistant_queries.
 *
 * Cost controls:
 *   - Haiku by default; Sonnet for open-ended questions, or when a Haiku
 *     run needs more than two rounds of lookups.
 *   - Prompt caching on the stable part of the prompt (tools + rules).
 *   - Per-user token budget over a rolling 24h (AI_ASSISTANT_DAILY_TOKENS).
 *   - Per-question caps: MAX_TURNS lookups, max_tokens, wall-clock budget.
 */

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { getAssistantAccess, assistantEnabledFor } from "@/lib/ai/assistant/access";
import { toolsFor, executeAssistantTool } from "@/lib/ai/assistant/tools";
import { describePage } from "@/lib/ai/assistant/page-context";
import { buildAssistantPrompt } from "@/lib/ai/assistant/prompt";
import { sumAssistantTokensSince, logAssistantQuery } from "@/services/ai-assistant";

export const maxDuration = 60;

const FAST_MODEL = process.env.AI_ASSISTANT_MODEL_FAST || "claude-haiku-5-5";
const SMART_MODEL = process.env.AI_ASSISTANT_MODEL_SMART || "claude-sonnet-5-5";
const DEFAULT_DAILY_TOKENS = 300_000;

const MAX_TURNS = 6;
const ESCALATE_AFTER_TURNS = 2; // Haiku still looking things up after 2 rounds → hand to Sonnet
const BUDGET_MS = 50_000;
const TOOL_RESULT_CAP = 8_000; // chars of tool output fed back to the model
const MAX_HISTORY = 12; // messages kept from the conversation
const MAX_MESSAGE_CHARS = 4_000;
const MAX_VISIBLE_TEXT = 6_000;

// Open-ended or writing questions start on Sonnet.
const OPEN_ENDED =
  /\b(why|compare|comparison|trend|breakdown|analy[sz]e|summari[sz]e|summary|explain|across|average|growth|recommend|suggest|plan|draft|write|improve)\b/i;

let anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

type ChatMessage = { role: "user" | "assistant"; content: string };

function parseMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const msgs: ChatMessage[] = [];
  for (const m of raw.slice(-MAX_HISTORY)) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return null;
    if (typeof m.content !== "string" || !m.content.trim()) return null;
    msgs.push({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) });
  }
  // The API needs the conversation to start with the user and end with the new question.
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return null;
  return msgs;
}

export async function POST(request: Request) {
  const t0 = Date.now();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const messages = parseMessages(body?.messages);
  const pathname =
    typeof body?.pathname === "string" ? body.pathname.slice(0, 300) : "/dashboard";
  const visibleText =
    typeof body?.visibleText === "string" && body.visibleText.trim()
      ? body.visibleText.slice(0, MAX_VISIBLE_TEXT)
      : null;
  if (!messages) {
    return NextResponse.json({ error: "Invalid messages" }, { status: 400 });
  }

  const access = await getAssistantAccess(supabase, user.id);
  if (!assistantEnabledFor(access.roles)) {
    return NextResponse.json({ error: "The assistant isn't switched on for you." }, { status: 403 });
  }

  // Rolling 24h token budget per person. If the log can't be read, don't block.
  const dailyTokens = Number(process.env.AI_ASSISTANT_DAILY_TOKENS) || DEFAULT_DAILY_TOKENS;
  const used = await sumAssistantTokensSince(
    supabase,
    user.id,
    new Date(Date.now() - 24 * 60 * 60 * 1000)
  );
  if (!used.error && used.tokens >= dailyTokens) {
    return NextResponse.json(
      {
        error:
          "You've reached today's assistant limit. It resets over the next 24 hours — ask an admin if you need more.",
      },
      { status: 429 }
    );
  }

  const { data: profile } = await supabase
    .from("users")
    .select("first_name, last_name")
    .eq("id", user.id)
    .maybeSingle();
  const userName = profile
    ? `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() || null
    : null;

  const tools = toolsFor(access);
  const prompt = buildAssistantPrompt({
    access,
    userName,
    pageDescription: await describePage(supabase, pathname, access),
    visibleText,
    toolNames: tools.map((t) => t.name),
  });
  // Cache breakpoint after the stable block: tools + rules are re-read at a
  // tenth of the price on follow-up questions. The page block changes each time.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: prompt.stable, cache_control: { type: "ephemeral" } },
    { type: "text", text: prompt.page },
  ];

  const question = messages[messages.length - 1].content;
  let model = OPEN_ENDED.test(question) ? SMART_MODEL : FAST_MODEL;
  const convo: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const toolCalls: Array<{ name: string; input: unknown }> = [];
  let inputTokens = 0;
  let outputTokens = 0;

  const finish = async (answer: string | null) => {
    await logAssistantQuery(supabase, {
      user_id: user.id,
      page_path: pathname,
      question,
      tool_calls: toolCalls,
      answer,
      model_used: model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: Date.now() - t0,
    }).then(
      ({ error }: { error: { message: string } | null }) =>
        error && console.error("[assistant] log failed", error.message),
      (err: unknown) => console.error("[assistant] log failed", err)
    );
    return answer
      ? NextResponse.json({ answer })
      : NextResponse.json({ error: "Something went wrong — please try again." }, { status: 500 });
  };

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (Date.now() - t0 > BUDGET_MS) {
        return finish("That took longer than expected — try a more specific question.");
      }
      if (turn >= ESCALATE_AFTER_TURNS) model = SMART_MODEL;

      const res = await getAnthropic().messages.create({
        model,
        max_tokens: 1500,
        system,
        ...(tools.length ? { tools } : {}),
        messages: convo,
      });
      // Count everything the request read (fresh + cache writes + cache reads)
      // so the daily budget reflects real usage.
      inputTokens +=
        (res.usage?.input_tokens ?? 0) +
        (res.usage?.cache_creation_input_tokens ?? 0) +
        (res.usage?.cache_read_input_tokens ?? 0);
      outputTokens += res.usage?.output_tokens ?? 0;

      const toolUses = res.content.filter(
        (c): c is Anthropic.ToolUseBlock => c.type === "tool_use"
      );

      if (toolUses.length === 0) {
        const answer = res.content
          .filter((c): c is Anthropic.TextBlock => c.type === "text")
          .map((c) => c.text)
          .join("\n")
          .trim();
        return finish(answer || "I couldn't find an answer to that.");
      }

      convo.push({ role: "assistant", content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const u of toolUses) {
        const input = (u.input ?? {}) as Record<string, unknown>;
        toolCalls.push({ name: u.name, input });
        const output = await executeAssistantTool(u.name, input, supabase, access);
        results.push({
          type: "tool_result",
          tool_use_id: u.id,
          content: JSON.stringify(output).slice(0, TOOL_RESULT_CAP),
        });
      }
      convo.push({ role: "user", content: results });
    }
    return finish("I couldn't wrap that up — try asking something more specific.");
  } catch (err) {
    console.error("[assistant] run failed", err);
    return finish(null);
  }
}
