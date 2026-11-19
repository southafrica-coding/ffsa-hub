"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, Square, Volume2, VolumeX } from "lucide-react";
import { StatusPill } from "@/components/ffsa";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils/cn";
import { plainForSpeech, spokenCommand } from "@/lib/legal/speech";
import { TASK_STATE_LABEL, canRerun, taskState, type TaskRow } from "@/lib/legal/helper/task-state";
import { Button, ErrorLine, TEXT_RESET, callApi } from "./legal-ui";
import { useListener, type useSpeaker } from "./use-voice";

export type HelperMessage = {
  role: "user" | "assistant";
  content: string;
  drafts?: Array<{ id: string; title: string }>;
  tasks?: Array<{ id: string; title: string }>;
};

const STARTERS = [
  "What needs my attention this month?",
  "When does our PBO approval expire, and what does renewing it need?",
  "Fill in the blank form I scanned into FFSA legal today.",
  "Prepare everything for the tax compliance PIN renewal, in the background.",
];

const RESET_BUTTON = "!font-sans !font-normal normal-case tracking-normal";

// ────────────────────────────────────────────────────────────
// BACKGROUND TASKS
// ────────────────────────────────────────────────────────────

export function TaskList({
  tasks,
  onOpenDraft,
  compact,
}: {
  tasks: TaskRow[];
  onOpenDraft: (id: string) => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const now = Date.now();

  async function act(id: string, run: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await run();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const shown = compact
    ? tasks.filter((t) => {
        const s = taskState(t, now);
        // In the chat: what's in hand, and what finished in the last day.
        return s === "working" || s === "waiting" || s === "not_started" || s === "stalled" ||
          (t.finished_at && now - Date.parse(t.finished_at) < 24 * 3600 * 1000);
      }).slice(0, 4)
    : tasks;
  if (shown.length === 0) return null;

  return (
    <div className="space-y-2">
      <ErrorLine message={error} />
      <ul className="border-t border-rule">
        {shown.map((t) => {
          const s = taskState(t, now);
          const tone = s === "done" ? "good" : s === "failed" || s === "stalled" ? "bad" : s === "cancelled" ? "quiet" : "warn";
          return (
            <li key={t.id} className="border-b border-rule py-3">
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setOpen(open === t.id ? null : t.id)}
                  className={cn("min-h-11 min-w-0 flex-1 text-left", RESET_BUTTON)}
                >
                  <span className="block truncate text-[14px] font-semibold text-ink">{t.title}</span>
                  <span className="block font-mono text-[10px] tracking-[0.06em] text-[color:var(--text-tertiary)]">
                    {s === "working" ? `${t.progress ?? "Working"}…` : s === "done" ? `${t.draft_ids.length} ${t.draft_ids.length === 1 ? "draft" : "drafts"} saved` : TASK_STATE_LABEL[s]}
                  </span>
                </button>
                <StatusPill tone={tone}>{TASK_STATE_LABEL[s]}</StatusPill>
              </div>
              {open === t.id && (
                <div className="mt-2 space-y-2 text-[13.5px]">
                  {t.result && (
                    <div className="border-l-2 border-ink pl-3">
                      <Markdown source={t.result} />
                    </div>
                  )}
                  {t.error && <p className="text-destructive">{t.error}</p>}
                  {!t.result && !t.error && <p className="whitespace-pre-wrap text-[color:var(--text-secondary)]">{t.request}</p>}
                </div>
              )}
              <div className="mt-1 flex flex-wrap gap-2">
                {t.draft_ids.map((id, i) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onOpenDraft(id)}
                    className="inline-flex min-h-11 items-center border border-ink bg-white px-3 text-[9.5px] hover:bg-bone"
                  >
                    Draft {i + 1}
                  </button>
                ))}
                {(s === "working" || s === "waiting") && (
                  <button
                    type="button"
                    disabled={busy === t.id}
                    onClick={() => act(t.id, () => callApi("POST", `/api/legal/helper/tasks/${t.id}`, { action: "cancel" }))}
                    className="inline-flex min-h-11 items-center border border-rule-strong px-3 text-[9.5px] hover:bg-bone"
                  >
                    Stop
                  </button>
                )}
                {canRerun(s) && (
                  <button
                    type="button"
                    disabled={busy === t.id}
                    onClick={() => act(t.id, () => callApi("POST", `/api/legal/helper/tasks/${t.id}`, { action: "run" }))}
                    className="inline-flex min-h-11 items-center border border-ink px-3 text-[9.5px] hover:bg-bone"
                  >
                    {s === "not_started" ? "Start" : "Run again"}
                  </button>
                )}
                {!compact && (s === "done" || s === "failed" || s === "cancelled") && (
                  <button
                    type="button"
                    disabled={busy === t.id}
                    onClick={() => act(t.id, () => callApi("DELETE", `/api/legal/helper/tasks/${t.id}`))}
                    className="inline-flex min-h-11 items-center px-3 text-[9.5px] text-[color:var(--text-tertiary)] hover:text-destructive"
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// THE HELPER — chat, voice, hand-offs
// ────────────────────────────────────────────────────────────

export function HelperPanel({
  messages,
  setMessages,
  tasks,
  onOpenDraft,
  speaker,
  readAloud,
  setReadAloud,
}: {
  messages: HelperMessage[];
  setMessages: React.Dispatch<React.SetStateAction<HelperMessage[]>>;
  tasks: TaskRow[];
  onOpenDraft: (id: string) => void;
  speaker: ReturnType<typeof useSpeaker>;
  readAloud: boolean;
  setReadAloud: (v: boolean) => void;
}) {
  const router = useRouter();
  const listener = useListener("en-ZA");
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  // Hands-free survives the async gap between hearing and answering.
  const handsFreeRef = useRef(false);
  handsFreeRef.current = handsFree;

  // Follow the conversation, but open at the top while there is none.
  useEffect(() => {
    if (messages.length > 0 || thinking) end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, thinking]);

  // Leaving the panel: stop listening and talking.
  useEffect(() => {
    const { cancel } = listener;
    const { stop } = speaker;
    return () => {
      cancel();
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function say(text: string, then?: () => void) {
    if (readAloud && speaker.supported) speaker.speak(plainForSpeech(text), then);
    else then?.();
  }

  function listen() {
    speaker.stop();
    listener.start(heard);
  }

  function heard(text: string) {
    const cmd = spokenCommand(text);
    if (cmd === "stop") {
      setHandsFree(false);
      say("Okay.");
      return;
    }
    if (cmd === "background") {
      background(text.replace(/\s*in the background[.!?]?$/i, ""), true);
      return;
    }
    ask(text, true);
  }

  /** After a spoken answer in hands-free mode, listen again. */
  const next = () => {
    if (handsFreeRef.current) listen();
  };

  async function startTasks(list: Array<{ id: string }> | undefined) {
    for (const t of list ?? []) {
      await callApi("POST", `/api/legal/helper/tasks/${t.id}`, { action: "run" }).catch(() => undefined);
    }
    if (list?.length) router.refresh();
  }

  async function ask(text: string, byVoice = false) {
    const q = text.trim();
    if (!q || thinking) return;
    const nextMessages = [...messages, { role: "user" as const, content: q }];
    setMessages(nextMessages);
    setInput("");
    setThinking(true);
    setError(null);
    try {
      const res = await fetch("/api/legal/helper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
          voice: byVoice && readAloud,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        answer?: string;
        error?: string;
        drafts?: HelperMessage["drafts"];
        tasks?: HelperMessage["tasks"];
      };
      if (json.drafts?.length) router.refresh();
      startTasks(json.tasks);
      if (!res.ok || !json.answer) {
        const msg = json.error ?? "The helper didn't answer. Try again.";
        setError(msg);
        say(msg, next);
        return;
      }
      setMessages((m) => [...m, { role: "assistant", content: json.answer!, drafts: json.drafts, tasks: json.tasks }]);
      say(json.answer, next);
    } catch {
      setError("The helper couldn't be reached. Try again.");
    } finally {
      setThinking(false);
    }
  }

  async function background(text: string, byVoice = false) {
    const q = text.trim();
    if (!q) return;
    setInput("");
    setError(null);
    try {
      await callApi("POST", "/api/legal/helper/tasks", { request: q, title: q.slice(0, 80) });
      setMessages((m) => [
        ...m,
        { role: "user", content: q },
        { role: "assistant", content: "I'm working on that in the background. You can carry on; it shows under **Working on** and in the Drafts tab when it's done." },
      ]);
      router.refresh();
      say(byVoice ? "I'm working on that in the background. I'll let you know when it's done." : "", next);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-ink bg-bone px-5 py-5 sm:px-6">
        <div className="mono-label mb-2">Legal helper</div>
        <h2 className="font-display text-[28px] font-black uppercase leading-[0.95]">Ask, find, draft</h2>
        <p className={cn("mt-3 text-[13px] text-[color:var(--text-secondary)]", TEXT_RESET)}>
          Type or talk. It reads the papers in Documents, fills out forms and drafts letters from what is held there,
          and saves each one as a draft. Bigger jobs it works on in the background. Nothing is final until the legal
          officer approves it. Uses Claude, Anthropic&apos;s AI; this chat isn&apos;t saved.
        </p>

        {/* Voice controls */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {listener.supported ? (
            <button
              type="button"
              onClick={() => (listener.listening ? listener.stop() : listen())}
              disabled={thinking}
              aria-pressed={listener.listening}
              aria-label={listener.listening ? "Stop listening" : "Talk to the helper"}
              className={cn(
                "inline-flex h-14 min-w-14 items-center justify-center gap-2 border px-4 text-[10px] disabled:opacity-50",
                listener.listening ? "border-destructive bg-destructive text-white" : "border-ink bg-ink text-white"
              )}
            >
              {listener.listening ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              {listener.listening ? "Listening" : "Talk"}
            </button>
          ) : null}
          {speaker.supported && (
            <button
              type="button"
              onClick={() => {
                if (readAloud) speaker.stop();
                setReadAloud(!readAloud);
              }}
              aria-pressed={readAloud}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 border px-3 text-[9.5px]",
                readAloud ? "border-ink bg-white text-ink" : "border-rule-strong text-[color:var(--text-secondary)]"
              )}
            >
              {readAloud ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              {readAloud ? "Reading aloud" : "Silent"}
            </button>
          )}
          {listener.supported && (
            <button
              type="button"
              onClick={() => {
                const on = !handsFree;
                setHandsFree(on);
                if (on) {
                  setReadAloud(true);
                  if (!listener.listening && !thinking) listen();
                } else listener.cancel();
              }}
              aria-pressed={handsFree}
              className={cn(
                "inline-flex min-h-11 items-center border px-3 text-[9.5px]",
                handsFree ? "border-ink bg-yellow text-ink" : "border-rule-strong text-[color:var(--text-secondary)]"
              )}
            >
              {handsFree ? "Hands-free on" : "Hands-free"}
            </button>
          )}
          {speaker.speaking && (
            <button type="button" onClick={speaker.stop} className="inline-flex min-h-11 items-center px-2 text-[9.5px] underline">
              Stop talking
            </button>
          )}
        </div>
        {listener.listening && (
          <p className={cn("mt-3 min-h-[1.5em] text-[15px] text-ink", TEXT_RESET)}>{listener.interim || "Listening…"}</p>
        )}
        {listener.error && <p className="mt-2 text-[12.5px] text-destructive">{listener.error}</p>}
        <p className={cn("mt-2 text-[11.5px] text-[color:var(--text-tertiary)]", TEXT_RESET)}>
          {listener.supported
            ? "Speech is turned into text by your browser (Google in Chrome, Apple in Safari). Say “in the background” at the end to hand a job off; “that’s all” ends hands-free."
            : "This browser can't listen. Use Chrome, Edge or Safari to talk to the helper; typing works everywhere."}
        </p>
      </div>

      {tasks.length > 0 && (
        <div className="border-b border-rule px-5 py-4 sm:px-6">
          <div className="mono-label mb-1">Working on</div>
          <TaskList tasks={tasks} onOpenDraft={onOpenDraft} compact />
        </div>
      )}

      <div className="flex-1 space-y-4 px-5 py-5 sm:px-6">
        {messages.length === 0 && (
          <div className="space-y-2">
            <div className="mono-label">Try</div>
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => (/in the background\.?$/.test(s) ? background(s.replace(/,? in the background\.?$/, ".")) : ask(s))}
                className={cn("block min-h-11 w-full border border-rule px-3 py-2 text-left text-[14px] hover:bg-bone", RESET_BUTTON)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "ml-8 bg-ink px-4 py-3 text-[14px] text-white" : "mr-2 border-l-2 border-ink px-4 py-1 text-[14px]"}>
            {m.role === "user" ? <p className="whitespace-pre-wrap">{m.content}</p> : <Markdown source={m.content} />}
            {m.drafts?.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => onOpenDraft(d.id)}
                className="mr-2 mt-2 inline-flex min-h-11 items-center border border-ink bg-white px-3 text-[9.5px] hover:bg-bone"
              >
                Open draft: {d.title}
              </button>
            ))}
            {m.tasks?.map((t) => (
              <p key={t.id} className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-tertiary)]">
                Working in the background: {t.title}
              </p>
            ))}
          </div>
        ))}
        {thinking && (
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-tertiary)]">
            Working… reading the papers can take a minute
          </p>
        )}
        <ErrorLine message={error} />
        {/* Clear of the sticky message box when scrolled to. */}
        <div ref={end} className="scroll-mb-40" />
      </div>

      <form
        className="sticky bottom-0 border-t border-ink bg-white px-5 py-3 sm:px-6"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            rows={2}
            placeholder="Ask about a paper, or ask for a draft"
            aria-label="Message the legal helper"
            className={cn("block min-h-11 min-w-0 flex-1 resize-none", TEXT_RESET)}
          />
          <Button type="submit" disabled={thinking || !input.trim()}>
            Send
          </Button>
        </div>
        <button
          type="button"
          disabled={!input.trim()}
          onClick={() => background(input)}
          className="mt-2 min-h-11 text-[9.5px] underline disabled:opacity-40"
        >
          Work on this in the background
        </button>
      </form>
    </div>
  );
}
