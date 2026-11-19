// The legal helper's work loop, shared by the chat (/api/legal/helper) and
// background tasks (/api/legal/helper/tasks). Server-only.
//
// Runs AS THE SIGNED-IN PERSON: every tool goes through their client (RLS).
// Claude Opus 5.5; strict tools; the whole assistant turn (thinking blocks
// included) is appended unchanged before tool results.

import Anthropic from "@anthropic-ai/sdk";
import { todayInSA } from "@/lib/legal/status";
import { LEGAL_HELPER_TOOLS, START_TASK_TOOL, executeLegalTool } from "./tools";
import { legalHelperPrompt } from "./prompt";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const MODEL = "claude-opus-5-5";
const MAX_TURNS = { chat: 10, voice: 10, task: 24 } as const;
const TOOL_RESULT_CAP = 40_000;

export type HelperMode = "chat" | "voice" | "task";
export type ChatMessage = { role: "user" | "assistant"; content: string };

export type HelperRun = {
  answer: string;
  drafts: Array<{ id: string; title: string }>;
  /** Background tasks this run asked for (chat/voice only). */
  tasks: Array<{ id: string; title: string }>;
  /** Why the run ended early, if it did. */
  stopped: null | "time" | "turns" | "cancelled" | "refusal" | "length";
  inputTokens: number;
  outputTokens: number;
};

const VOICE_NOTE = `This conversation is spoken. Your reply is read aloud, so answer in one to three short plain sentences: no lists, no symbols, no ids or links, and spell dates out (18 November 2026). If the full answer is long, give the gist and say the rest is on screen.`;

const TASK_NOTE = `You are running as a BACKGROUND TASK. Nobody is watching and nobody can answer questions until you finish, so don't ask any: make sensible choices, note them in notes_for_approver, and keep going. Save your work as drafts as you go. Finish with a short report for the legal officer: what you did, the drafts you saved, what is missing, and what needs the legal officer's attention.`;

/** Friendly words for what the helper is doing, for task progress. */
export function progressFor(toolNames: string[]): string {
  const n = toolNames[toolNames.length - 1];
  return (
    {
      get_overview: "Looking at what's on file",
      search_legal: "Searching the papers",
      get_document: "Reading a document",
      read_scan: "Reading a scan",
      list_drafts: "Checking the drafts",
      save_draft: "Saving a draft",
      update_draft: "Updating a draft",
    } as Record<string, string>
  )[n] ?? "Working";
}

let anthropic: Anthropic | null = null;
function claude(): Anthropic {
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

export async function runLegalHelper(args: {
  supabase: Client;
  userId: string;
  userName: string | null;
  isOwner: boolean;
  messages: ChatMessage[];
  mode: HelperMode;
  budgetMs: number;
  /** Called after each round of tools; return true to stop (e.g. cancelled). */
  onTurn?: (toolNames: string[]) => Promise<boolean | void>;
}): Promise<HelperRun> {
  const { supabase, userId, mode } = args;
  const t0 = Date.now();
  const tools = mode === "task" ? LEGAL_HELPER_TOOLS : [...LEGAL_HELPER_TOOLS, START_TASK_TOOL];
  // The stable block (tools + instructions) is cached; the mode note isn't.
  const system: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: legalHelperPrompt({ today: todayInSA(), userName: args.userName, isOwner: args.isOwner }),
      cache_control: { type: "ephemeral" },
    },
    ...(mode === "voice" ? [{ type: "text" as const, text: VOICE_NOTE }] : []),
    ...(mode === "task" ? [{ type: "text" as const, text: TASK_NOTE }] : []),
  ];
  const convo: Anthropic.MessageParam[] = args.messages.map((m) => ({ role: m.role, content: m.content }));
  const out: HelperRun = { answer: "", drafts: [], tasks: [], stopped: null, inputTokens: 0, outputTokens: 0 };
  const drafts = new Map<string, string>();
  const finish = (answer: string, stopped: HelperRun["stopped"] = null): HelperRun => ({
    ...out,
    answer,
    stopped,
    drafts: [...drafts].map(([id, title]) => ({ id, title })),
  });

  for (let turn = 0; turn < MAX_TURNS[mode]; turn++) {
    if (Date.now() - t0 > args.budgetMs) {
      return finish("I ran out of time on this one. Anything I saved is in the Drafts tab; ask me to carry on.", "time");
    }
    const res = await claude().messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: mode === "task" ? "high" : "medium" },
      system,
      tools,
      messages: convo,
    });
    out.inputTokens +=
      (res.usage?.input_tokens ?? 0) + (res.usage?.cache_creation_input_tokens ?? 0) + (res.usage?.cache_read_input_tokens ?? 0);
    out.outputTokens += res.usage?.output_tokens ?? 0;

    if (res.stop_reason === "refusal") {
      return finish("The helper declined that request. Try asking another way, or do this one by hand.", "refusal");
    }
    const toolUses = res.content.filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
    if (toolUses.length === 0 || res.stop_reason !== "tool_use") {
      const answer = res.content
        .filter((c): c is Anthropic.TextBlock => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();
      if (res.stop_reason === "max_tokens" && !answer) return finish("That answer ran too long. Ask for one document at a time.", "length");
      return finish(answer || "I couldn't find an answer to that.");
    }

    convo.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const u of toolUses) {
      try {
        if (!tools.some((t) => t.name === u.name)) throw new Error(`Tool not offered here: ${u.name}`);
        const outcome = await executeLegalTool(u.name, (u.input ?? {}) as Record<string, unknown>, supabase, userId);
        if (outcome.draft) drafts.set(outcome.draft.id, outcome.draft.title);
        if (outcome.task) out.tasks.push(outcome.task);
        const isError = !!(outcome.output && typeof outcome.output === "object" && "error" in outcome.output);
        results.push({
          type: "tool_result",
          tool_use_id: u.id,
          content: JSON.stringify(outcome.output).slice(0, TOOL_RESULT_CAP),
          ...(isError ? { is_error: true } : {}),
        });
      } catch (e) {
        console.error("[legal-helper] tool failed", u.name, e);
        results.push({ type: "tool_result", tool_use_id: u.id, content: "The lookup failed. Try again.", is_error: true });
      }
    }
    convo.push({ role: "user", content: results });
    if (await args.onTurn?.(toolUses.map((u) => u.name))) {
      return finish("Stopped, as asked. Anything saved so far is in the Drafts tab.", "cancelled");
    }
  }
  return finish("I couldn't finish that in one go. Anything I saved is in the Drafts tab; ask me to carry on.", "turns");
}
