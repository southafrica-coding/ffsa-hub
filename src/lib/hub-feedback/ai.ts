/**
 * Anthropic access for the feedback bot.
 *
 * Mirrors the model pins + lazy-client pattern from
 * src/lib/slack/assistant/run.ts. The feedback flows (clarify,
 * classify, dedup) are short and structured, so they run on Haiku;
 * callers can pass Sonnet for anything that needs deeper reasoning.
 */

import Anthropic from "@anthropic-ai/sdk";

export const HAIKU_MODEL = "claude-haiku-4-5-20251001";
export const SONNET_MODEL = "claude-sonnet-4-5-20250929";

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    client = new Anthropic({ apiKey });
  }
  return client;
}

/** Concatenate the text blocks of a message response. */
export function textOf(res: Anthropic.Message): string {
  return res.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();
}

/**
 * Pull the first JSON object/array out of a model response, tolerating
 * ```json fences and surrounding prose. Returns null if nothing parses.
 */
export function extractJson<T = unknown>(raw: string): T | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  // Find the outermost {...} or [...] span.
  const start = candidate.search(/[{[]/);
  if (start === -1) return null;
  const opener = candidate[start];
  const closer = opener === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(closer);
  if (end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/**
 * Run a single structured-JSON completion. Instructs the model to emit
 * JSON only; parses defensively. Returns null on any failure so callers
 * can fall back gracefully rather than throwing into a Slack handler.
 */
export async function completeJson<T = unknown>(args: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}): Promise<T | null> {
  try {
    const res = await getClient().messages.create({
      model: args.model ?? HAIKU_MODEL,
      max_tokens: args.maxTokens ?? 1024,
      system: args.system,
      messages: [{ role: "user", content: args.user }],
    });
    return extractJson<T>(textOf(res));
  } catch (err) {
    console.error("[hub-feedback/ai] completeJson failed", err);
    return null;
  }
}
