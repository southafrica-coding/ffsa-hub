/**
 * POST /api/legal/helper — the legal helper chat in Legal → Documents.
 *
 * Body: { messages: [{ role, content }], voice?: boolean }
 *   (the last message is the new question; voice = the reply is read aloud,
 *   so it is kept short). Returns { answer, drafts, tasks }.
 *
 * Only for people on legal_access. The loop (src/lib/legal/helper/run.ts)
 * runs AS the signed-in person, so RLS decides what it can read; it can
 * only write drafts, and hand bigger jobs to background tasks. The client
 * starts each returned task with POST /api/legal/helper/tasks/[id]
 * {action:"run"}, so every task gets a request — and a time budget — of
 * its own.
 *
 * Privacy: the conversation is NOT stored (unlike the Hub assistant, which
 * logs to ai_assistant_queries). Only token counts reach the server log.
 */

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { legalGate } from "@/lib/legal/api";
import { runLegalHelper, type ChatMessage } from "@/lib/legal/helper/run";
import { helperIdentity } from "@/lib/legal/helper/who";

export const maxDuration = 300;

const BUDGET_MS = 270_000;
const MAX_HISTORY = 20;
const MAX_MESSAGE_CHARS = 8_000;

function parseMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const msgs: ChatMessage[] = [];
  for (const m of raw.slice(-MAX_HISTORY)) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return null;
    if (typeof m.content !== "string" || !m.content.trim()) return null;
    msgs.push({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return null;
  return msgs;
}

export async function POST(request: Request) {
  const t0 = Date.now();
  const gate = await legalGate();
  if (gate.error) return gate.error;
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "The legal helper isn't set up (ANTHROPIC_API_KEY is missing)." }, { status: 503 });
  }
  const { supabase, userId } = gate;

  const body = await request.json().catch(() => null);
  const messages = parseMessages(body?.messages);
  if (!messages) return NextResponse.json({ error: "Invalid messages" }, { status: 400 });

  const who = await helperIdentity(supabase, userId);
  try {
    const run = await runLegalHelper({
      supabase,
      userId,
      ...who,
      messages,
      mode: body?.voice === true ? "voice" : "chat",
      budgetMs: BUDGET_MS - (Date.now() - t0),
    });
    console.info(`[legal-helper] user=${userId} in=${run.inputTokens} out=${run.outputTokens} ms=${Date.now() - t0}`);
    return NextResponse.json({ answer: run.answer, drafts: run.drafts, tasks: run.tasks });
  } catch (e) {
    const status = e instanceof Anthropic.RateLimitError ? 429 : e instanceof Anthropic.APIError ? 502 : 500;
    console.error("[legal-helper] run failed", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
    return NextResponse.json(
      {
        error:
          status === 429
            ? "The helper is busy right now. Try again in a minute."
            : status === 502
              ? "The helper is unavailable right now. Try again later."
              : "Something went wrong. Try again.",
      },
      { status }
    );
  }
}
