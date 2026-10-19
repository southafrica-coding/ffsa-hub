"use client";

/**
 * Floating "Ask the Hub" chat bubble, mounted in the (admin) and (portal)
 * layouts. Sends the conversation, the current path and the text visible
 * in <main> to /api/assistant, which answers as the signed-in user.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles, X, Send, RotateCcw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type ChatMessage = { role: "user" | "assistant"; content: string; error?: boolean };

const STORAGE_KEY = "ffsa-assistant-chat";
const MAX_VISIBLE_TEXT = 6000;

function loadStored(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function saveStored(messages: ChatMessage[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)));
  } catch {
    /* storage unavailable — chat still works in memory */
  }
}

// ── Tiny renderer: paragraphs, "- " bullets, **bold**, and /hub/paths as links ──

function renderInline(text: string, onNavigate: () => void): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|(?<![\w/])\/(?:[a-z0-9-]+)(?:\/[A-Za-z0-9-]+)*)/g);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (/^\/[a-z0-9-]+/.test(part)) {
      return (
        <Link key={i} href={part} onClick={onNavigate} className="underline underline-offset-2 hover:text-primary">
          {part}
        </Link>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function AnswerText({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{renderInline(para.join(" "), onNavigate)}</p>);
    para = [];
  };
  const flushList = () => {
    if (list.length)
      blocks.push(
        <ul key={blocks.length} className="list-disc pl-5 space-y-0.5">
          {list.map((item, i) => (
            <li key={i}>{renderInline(item, onNavigate)}</li>
          ))}
        </ul>
      );
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      flushPara();
      list.push(bullet[1]);
    } else if (!line) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.replace(/^#+\s*/, ""));
    }
  }
  flushPara();
  flushList();
  return <div className="space-y-2">{blocks}</div>;
}

function suggestionsFor(pathname: string): string[] {
  if (/^\/events\/[0-9a-f-]{36}/.test(pathname))
    return ["How is this event selling?", "How many people checked in today?"];
  if (/^\/contacts\/[0-9a-f-]{36}/.test(pathname))
    return ["Summarise this contact", "What should I follow up on?"];
  if (pathname.startsWith("/schools")) return ["How many DTS applications do we have?", "Summarise this page"];
  if (pathname.startsWith("/events")) return ["What events are coming up?", "Ticket sales this week"];
  return ["What can you help me with?", "Summarise this page"];
}

export function AssistantBubble() {
  const pathname = usePathname() ?? "/dashboard";
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setMessages(loadStored()), []);
  useEffect(() => saveStored(messages), [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || loading) return;
      const history = [...messages.filter((m) => !m.error), { role: "user" as const, content: question }];
      setMessages((prev) => [...prev, { role: "user", content: question }]);
      setInput("");
      setLoading(true);

      const visibleText =
        (document.querySelector("main") as HTMLElement | null)?.innerText?.slice(0, MAX_VISIBLE_TEXT) ?? "";

      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.map(({ role, content }) => ({ role, content })),
            pathname,
            visibleText,
          }),
        });
        const data = await res.json().catch(() => ({}));
        setMessages((prev) => [
          ...prev,
          res.ok && data.answer
            ? { role: "assistant", content: data.answer }
            : { role: "assistant", content: data.error ?? "Something went wrong — please try again.", error: true },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Couldn't reach the Hub — check your connection.", error: true },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [messages, loading, pathname]
  );

  const close = () => setOpen(false);

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ask the Hub assistant"
          className="fixed bottom-24 right-4 z-50 flex md:bottom-5 md:right-5 h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Sparkles className="h-5 w-5" />
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Hub assistant"
          // Phones: a bottom sheet above the mobile tab bar (z-[60] > tab bar's z-50).
          // Desktop (md+, where the tab bar is hidden): a floating panel.
          className="fixed inset-x-0 bottom-0 z-[60] flex h-[85dvh] flex-col rounded-t-xl border bg-card text-card-foreground shadow-2xl md:inset-x-auto md:bottom-5 md:right-5 md:h-[600px] md:max-h-[calc(100dvh-2.5rem)] md:w-[400px] md:rounded-xl"
        >
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Sparkles className="h-4 w-4 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-semibold leading-none">Hub assistant</p>
              <p className="mt-1 text-[11px] text-muted-foreground">Sees this page · only what you can access</p>
            </div>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => setMessages([])}
                aria-label="Start a new chat"
                title="New chat"
                className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={close}
              aria-label="Close assistant"
              className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm">
            {messages.length === 0 && (
              <div className="space-y-3 pt-2">
                <p className="text-muted-foreground">
                  Ask about events, contacts, applications or whatever is on this page.
                </p>
                <div className="flex flex-wrap gap-2">
                  {suggestionsFor(pathname).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-full border px-3 py-1.5 text-xs hover:bg-muted"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-primary-foreground">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div
                  key={i}
                  className={cn(
                    "max-w-[92%] rounded-2xl rounded-bl-sm px-3 py-2 leading-relaxed",
                    m.error ? "bg-destructive/10 text-destructive" : "bg-muted"
                  )}
                >
                  <AnswerText
                    text={m.content}
                    onNavigate={() => {
                      // On phones the panel covers the page — close it when following a link.
                      if (window.matchMedia("(max-width: 767px)").matches) setOpen(false);
                    }}
                  />
                </div>
              )
            )}

            {loading && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-xs">Looking that up…</span>
              </div>
            )}
          </div>

          <form
            className="flex items-end gap-2 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              maxLength={4000}
              placeholder="Ask anything…"
              className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              aria-label="Send"
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
