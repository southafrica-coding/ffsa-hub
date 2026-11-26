"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type {
  BotModeAction,
  InboxResponse,
  MessageView,
  ServingInterestView,
  ThreadBotDetail,
  ThreadResponse,
  ThreadSummary,
  WhatsAppSetup,
} from "@/lib/missio/whatsapp/types";
import { isMissioPastor } from "../access";
import { useMissioViewer } from "../viewer";
import content from "../content.module.css";
import { whatsAppClient, whatsAppThreadHref, WhatsAppApiError, type WhatsAppClient } from "./client";
import { Composer } from "./composer";
import { bubbleTime, dayLabel, listTime, sameDay, statusWord } from "./format";
import { CheckIcon, ChevronIcon, ClockIcon, DoubleCheckIcon, WarnIcon, WhatsAppGlyph } from "./icons";
import styles from "./whatsapp.module.css";

type Load<T> = { kind: "loading" } | { kind: "error"; status: number; message: string } | { kind: "ready"; data: T };

type Key = { personId: string } | { threadId: string };

const THREAD_POLL_MS = 20_000;
const INBOX_POLL_MS = 60_000;

function errorState(error: unknown): { kind: "error"; status: number; message: string } {
  if (error instanceof WhatsAppApiError) return { kind: "error", status: error.status, message: error.message };
  return { kind: "error", status: 0, message: "Something went wrong." };
}

/** Re-run `fn` every `ms` while the tab is visible. Nothing runs in the background. */
function useVisiblePoll(fn: () => void, ms: number, on: boolean) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!on) return;
    const tick = () => {
      if (document.visibilityState === "visible") saved.current();
    };
    const id = window.setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms, on]);
}

/**
 * /missio/whatsapp. Pastors only: the shell lets leaders and coaches into
 * Missio, so this page checks again, and every API refuses anyone else.
 * ?person=<id> or ?thread=<id> opens one conversation (alone on a phone,
 * beside the list from 1024px).
 */
export function MissioWhatsApp({ client = whatsAppClient, now }: { client?: WhatsAppClient; now?: () => Date }) {
  const me = useMissioViewer();
  const pastor = me ? isMissioPastor(me) : false;
  const params = useSearchParams();
  const person = params.get("person");
  const thread = params.get("thread");
  const key: Key | null = person ? { personId: person } : thread ? { threadId: thread } : null;

  const [inbox, setInbox] = useState<Load<InboxResponse>>({ kind: "loading" });
  const loadInbox = useCallback(
    () =>
      client.inbox().then(
        (data) => setInbox({ kind: "ready", data }),
        (error: unknown) => setInbox((prev) => (prev.kind === "ready" ? prev : errorState(error)))
      ),
    [client]
  );

  useEffect(() => {
    if (pastor) void loadInbox();
  }, [pastor, loadInbox]);
  useVisiblePoll(() => void loadInbox(), INBOX_POLL_MS, pastor);

  if (!pastor) {
    return (
      <div className={`${content.page} ${styles.page}`} data-testid="missio-whatsapp-denied">
        <section className={styles.notice}>
          <h1 className={styles.noticeTitle}>For pastors</h1>
          <p>Messages from Missio’s WhatsApp number are open to the church’s pastors.</p>
        </section>
      </div>
    );
  }

  const markedRead = (threadId: string) =>
    setInbox((prev) =>
      prev.kind === "ready"
        ? { ...prev, data: { ...prev.data, threads: prev.data.threads.map((t) => (t.id === threadId ? { ...t, unread: 0 } : t)) } }
        : prev
    );

  const selectedThreadId = thread ?? null;
  return (
    <div className={`${content.page} ${styles.page}`} data-testid="missio-whatsapp" data-open={key ? "thread" : "inbox"}>
      <div className={styles.split}>
        <section className={styles.listPane} aria-label="Conversations">
          <header className={styles.head}>
            <p className={styles.eyebrow}>Missio’s number · +27 82 360 7000</p>
            <h1 className={styles.title}>WhatsApp</h1>
          </header>
          <InboxList state={inbox} selectedId={selectedThreadId} onRetry={() => void loadInbox()} now={now} />
        </section>
        <section className={styles.threadPane} aria-label="Conversation">
          {key ? (
            <ThreadPanel
              key={"personId" in key ? `p:${key.personId}` : `t:${key.threadId}`}
              threadKey={key}
              client={client}
              now={now}
              onRead={markedRead}
              onSent={() => void loadInbox()}
            />
          ) : (
            <div className={styles.pickOne}>
              <WhatsAppGlyph />
              <p>Pick a conversation, or open someone in People and tap WhatsApp.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Inbox ─────────────────────────────────────────────────

function SetupNotice({ setup }: { setup: WhatsAppSetup }) {
  if (setup === "ready") return null;
  return (
    <div className={styles.setup} role="status" data-testid="whatsapp-setup" data-setup={setup}>
      <b>WhatsApp isn’t switched on yet.</b>{" "}
      {setup === "not_installed"
        ? "The Hub’s database update for it (396) hasn’t been applied, so there’s nothing to show and nothing can be sent."
        : "Missio’s number still has to be connected on the server. You can read conversations, but nothing can be sent."}
    </div>
  );
}

export function InboxList({
  state,
  selectedId,
  onRetry,
  now,
}: {
  state: Load<InboxResponse>;
  selectedId: string | null;
  onRetry: () => void;
  now?: () => Date;
}) {
  if (state.kind === "loading") {
    return (
      <div className={content.skeleton} aria-busy="true" aria-label="Loading conversations">
        <span />
        <span />
        <span />
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <section className={styles.notice} role="alert">
        <h2 className={styles.noticeTitle}>{state.status === 403 ? "For pastors" : "Conversations didn’t load"}</h2>
        <p>{state.status === 403 ? "Messages from Missio’s WhatsApp number are open to the church’s pastors." : "Nothing was changed. Try again in a moment."}</p>
        {state.status !== 403 ? (
          <button type="button" className={styles.secondary} onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </section>
    );
  }
  const { setup, threads } = state.data;
  const at = now?.() ?? new Date();
  return (
    <>
      <SetupNotice setup={setup} />
      {threads.length === 0 ? (
        <section className={styles.empty} data-testid="whatsapp-empty">
          <h2 className={styles.noticeTitle}>No conversations yet</h2>
          <p>
            When someone writes to Missio’s number, or a pastor messages someone from their page in People, the conversation shows
            up here.
          </p>
          <Link href="/missio/people" className={styles.secondary}>
            Go to People
          </Link>
        </section>
      ) : (
        <ul className={styles.list} data-testid="whatsapp-threads">
          {threads.map((t) => (
            <ThreadRow key={t.id} thread={t} on={t.id === selectedId} now={at} />
          ))}
        </ul>
      )}
    </>
  );
}

function ThreadRow({ thread, on, now }: { thread: ThreadSummary; on: boolean; now: Date }) {
  const title = thread.name || thread.phone;
  const unread = thread.unread > 0;
  return (
    <li>
      <Link
        href={whatsAppThreadHref({ threadId: thread.id })}
        className={`${styles.row} ${on ? styles.rowOn : ""} ${unread ? styles.rowUnread : ""}`}
        aria-current={on ? "true" : undefined}
        data-testid="whatsapp-thread-row"
      >
        <span className={styles.avatar} aria-hidden="true">
          {initialsOf(thread.name) ?? <WhatsAppGlyph />}
        </span>
        <span className={styles.rowText}>
          <span className={styles.rowTop}>
            <span className={styles.rowName}>{title}</span>
            <span className={styles.rowTime}>{listTime(thread.lastAt, now)}</span>
          </span>
          <span className={styles.rowBottom}>
            <span className={styles.rowPreview}>
              {thread.lastDirection === "out" ? <span className={styles.you}>You: </span> : null}
              {thread.lastPreview || "No messages yet"}
            </span>
            {unread ? (
              <span className={styles.badge} aria-label={`${thread.unread} unread`}>
                {thread.unread > 99 ? "99+" : thread.unread}
              </span>
            ) : null}
          </span>
          <span className={styles.rowFlags}>
            {thread.lastDirection === "out" && thread.lastStatus ? <StatusChip status={thread.lastStatus} /> : null}
            {thread.lastDirection === "in" ? <span className={styles.flag}>They wrote</span> : null}
            {!thread.name ? <span className={styles.flag}>Not in People yet</span> : null}
            {thread.optedOut ? <span className={`${styles.flag} ${styles.flagBad}`}>Opted out</span> : null}
            <BotFlags thread={thread} />
          </span>
        </span>
      </Link>
    </li>
  );
}

/** Who has the chat, in words: Bot / Handed off / Bot paused, and Serve for a new serving interest. */
function BotFlags({ thread }: { thread: ThreadSummary }) {
  const bot = thread.bot;
  return (
    <>
      {bot?.mode === "on" && bot.active ? (
        <span className={`${styles.flag} ${styles.flagBot}`} data-testid="flag-bot">
          Bot
        </span>
      ) : null}
      {bot?.mode === "handed_off" ? (
        <span className={`${styles.flag} ${styles.flagHandoff}`} data-testid="flag-handed-off">
          Handed off
        </span>
      ) : null}
      {bot?.mode === "paused" ? (
        <span className={styles.flag} data-testid="flag-paused">
          {bot.reason === "pastor" ? "Pastor has it" : "Bot paused"}
        </span>
      ) : null}
      {(thread.serving ?? 0) > 0 ? (
        <span className={`${styles.flag} ${styles.flagServe}`} data-testid="flag-serve">
          Serve
        </span>
      ) : null}
    </>
  );
}

function initialsOf(name: string | null): string | null {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0].slice(0, 2)).toUpperCase();
}

export function StatusChip({ status }: { status: MessageView["status"] }) {
  const icon =
    status === "pending" ? (
      <ClockIcon />
    ) : status === "failed" ? (
      <WarnIcon />
    ) : status === "delivered" || status === "read" ? (
      <DoubleCheckIcon />
    ) : (
      <CheckIcon />
    );
  return (
    <span className={styles.status} data-status={status}>
      {icon}
      {statusWord(status)}
    </span>
  );
}

// ── One conversation ──────────────────────────────────────

function ThreadPanel({
  threadKey,
  client,
  now,
  onRead,
  onSent,
}: {
  threadKey: Key;
  client: WhatsAppClient;
  now?: () => Date;
  onRead: (threadId: string) => void;
  onSent: () => void;
}) {
  const [state, setState] = useState<Load<ThreadResponse>>({ kind: "loading" });
  const markedFor = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const load = useCallback(
    () =>
      client.thread(threadKey).then(
        (data) => setState({ kind: "ready", data }),
        (error: unknown) => setState((prev) => (prev.kind === "ready" ? prev : errorState(error)))
      ),
    [client, threadKey]
  );

  useEffect(() => {
    void load();
  }, [load]);
  useVisiblePoll(() => void load(), THREAD_POLL_MS, state.kind === "ready" && state.data.thread !== null);

  // Opening a conversation reads it.
  const threadId = state.kind === "ready" ? state.data.thread?.id : undefined;
  const unread = state.kind === "ready" ? (state.data.thread?.unread ?? 0) : 0;
  useEffect(() => {
    if (!threadId || unread === 0 || markedFor.current === `${threadId}:${unread}`) return;
    markedFor.current = `${threadId}:${unread}`;
    client.markRead(threadId).then(
      () => onRead(threadId),
      () => undefined
    );
  }, [client, threadId, unread, onRead]);

  const count = state.kind === "ready" ? state.data.messages.length : 0;
  useEffect(() => {
    if (count !== lastCount.current) {
      lastCount.current = count;
      bottom.current?.scrollIntoView?.({ block: "end" });
    }
  }, [count]);

  if (state.kind === "loading") {
    return (
      <div className={styles.thread}>
        <BackToInbox />
        <div className={content.skeleton} aria-busy="true" aria-label="Loading the conversation">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className={styles.thread}>
        <BackToInbox />
        <section className={styles.notice} role="alert">
          <h2 className={styles.noticeTitle}>
            {state.status === 404 ? "Not found" : state.status === 403 ? "For pastors" : "This conversation didn’t load"}
          </h2>
          <p>{state.status === 404 ? "This person or conversation isn’t in Missio." : state.message}</p>
          {state.status !== 404 && state.status !== 403 ? (
            <button type="button" className={styles.secondary} onClick={() => void load()}>
              Try again
            </button>
          ) : null}
        </section>
      </div>
    );
  }

  const data = state.data;
  const title = data.person.name || data.person.phone || "Unknown number";
  const at = now?.() ?? new Date();
  return (
    <div className={styles.thread} data-testid="whatsapp-thread">
      <BackToInbox />
      <header className={styles.threadHead}>
        <span className={styles.avatar} aria-hidden="true">
          {initialsOf(data.person.name) ?? <WhatsAppGlyph />}
        </span>
        <div className={styles.threadWho}>
          <h2 className={styles.threadName}>{title}</h2>
          <p className={styles.threadMeta}>
            {data.person.name && data.person.phone ? <span>{data.person.phone}</span> : null}
            {data.person.profileName && data.person.profileName !== data.person.name ? (
              <span>On WhatsApp as {data.person.profileName}</span>
            ) : null}
            {!data.person.id ? <span className={styles.flag}>Not in People yet</span> : null}
          </p>
        </div>
        {data.person.id ? (
          <Link href={`/missio/people/${encodeURIComponent(data.person.id)}`} className={styles.profileLink}>
            Profile
            <ChevronIcon />
          </Link>
        ) : null}
      </header>

      {data.serving && data.serving.length > 0 ? <ServingCard interests={data.serving} /> : null}

      <ol className={styles.messages} aria-label="Messages" data-testid="whatsapp-messages">
        {data.messages.length === 0 ? (
          <li className={styles.noMessages}>No messages with them yet.</li>
        ) : (
          data.messages.map((message, index) => {
            const prev = data.messages[index - 1];
            return (
              <MessageItem key={message.id} message={message} dayBreak={!prev || !sameDay(prev.at, message.at) ? dayLabel(message.at, at) : null} />
            );
          })
        )}
      </ol>

      {/* Beside the composer, where the pastor is: who has the chat, Take over / Pause / Resume. */}
      {data.bot && data.thread ? (
        <BotBar
          threadId={data.thread.id}
          bot={data.bot}
          client={client}
          onChanged={(bot) => {
            setState((prev) => (prev.kind === "ready" ? { ...prev, data: { ...prev.data, bot } } : prev));
            void load();
            onSent();
          }}
        />
      ) : null}
      <Composer
        thread={data}
        threadKey={threadKey}
        client={client}
        now={now}
        onSent={(message) => {
          setState((prev) =>
            prev.kind === "ready" ? { ...prev, data: { ...prev.data, messages: [...prev.data.messages, message] } } : prev
          );
          void load();
          onSent();
        }}
      />
      {/* Scrolled to on open and on each new message, so the newest message and the composer are in view. */}
      <div ref={bottom} className={styles.end} aria-hidden="true" />
    </div>
  );
}

const BOT_ACTION_WORD: Record<BotModeAction, string> = { take_over: "Take over", pause: "Pause bot", resume: "Resume bot" };

/**
 * The slim line under the header: who has the chat, and the buttons to
 * change it. Take over sends nothing — the pastor writes in the composer.
 */
function BotBar({
  threadId,
  bot,
  client,
  onChanged,
}: {
  threadId: string;
  bot: ThreadBotDetail;
  client: WhatsAppClient;
  onChanged: (bot: ThreadBotDetail) => void;
}) {
  const [busy, setBusy] = useState<BotModeAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actions: BotModeAction[] = bot.mode === "on" ? ["take_over", "pause"] : ["resume"];

  const run = (action: BotModeAction) => {
    setBusy(action);
    setError(null);
    client.botMode(threadId, action).then(
      (res) => {
        setBusy(null);
        const pastorHas = res.bot.mode === "paused" && res.bot.reason === "pastor";
        onChanged({
          ...bot,
          mode: res.bot.mode,
          reason: res.bot.reason,
          pausedAt: res.bot.pausedAt,
          active: false,
          flow: null,
          statusLine:
            res.bot.mode === "on"
              ? "Bot is on. It answers new messages with the menu."
              : pastorHas
                ? "A pastor has this chat. The bot is quiet."
                : "Bot is paused. It stays quiet until a pastor resumes it.",
        });
      },
      (err: unknown) => {
        setBusy(null);
        setError(err instanceof WhatsAppApiError ? err.message : "Something went wrong. Nothing was changed.");
      }
    );
  };

  return (
    <section className={styles.botBar} aria-label="WhatsApp menu" data-testid="whatsapp-bot-bar" data-mode={bot.mode}>
      <p className={styles.botLine} role="status" data-testid="whatsapp-bot-status">
        <span className={styles.botTag}>{bot.mode === "on" ? "Menu on" : bot.mode === "handed_off" ? "Handed off" : "Menu paused"}</span>
        <span>{bot.statusLine}</span>
      </p>
      <div className={styles.botActions}>
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            className={styles.secondary}
            disabled={busy !== null}
            onClick={() => run(action)}
            data-testid={`bot-${action}`}
          >
            {busy === action ? "Saving…" : BOT_ACTION_WORD[action]}
          </button>
        ))}
      </div>
      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** What they told the menu about serving. Pastors pass it on; leaders don't see the inbox. */
function ServingCard({ interests }: { interests: ServingInterestView[] }) {
  const latest = interests[0];
  return (
    <section className={styles.serving} aria-label="Wants to serve" data-testid="whatsapp-serving">
      <p className={styles.servingTitle}>
        Wants to serve{latest.status !== "new" ? ` · ${latest.status}` : ""}
        {interests.length > 1 ? ` · ${interests.length} times` : ""}
      </p>
      <dl className={styles.servingList}>
        <div>
          <dt>Teams</dt>
          <dd>{latest.teams.join(", ") || "—"}</dd>
        </div>
        {latest.availability ? (
          <div>
            <dt>How often</dt>
            <dd>{latest.availability}</dd>
          </div>
        ) : null}
        {latest.experience ? (
          <div>
            <dt>Served before</dt>
            <dd>{latest.experience}</dd>
          </div>
        ) : null}
        {latest.note ? (
          <div>
            <dt>Note</dt>
            <dd>{latest.note}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function BackToInbox() {
  return (
    <Link href="/missio/whatsapp" className={styles.backLink}>
      <span aria-hidden="true">←</span> Inbox
    </Link>
  );
}

function MessageItem({ message, dayBreak }: { message: MessageView; dayBreak: string | null }) {
  const out = message.direction === "out";
  return (
    <>
      {dayBreak ? (
        <li className={styles.dayBreak}>
          <span>{dayBreak}</span>
        </li>
      ) : null}
      <li className={`${styles.message} ${out ? styles.out : styles.in}`} data-direction={message.direction} data-status={message.status}>
        <span className={styles.visuallyHidden}>{message.bot ? "The Missio menu sent:" : out ? "You sent:" : "They wrote:"}</span>
        {message.bot ? <span className={styles.templateTag}>Missio menu</span> : null}
        {message.kind === "template" ? (
          <span className={styles.templateTag}>Approved message{message.templateName ? ` · ${message.templateName.replace(/_/g, " ")}` : ""}</span>
        ) : null}
        <p className={`${styles.body} ${message.kind === "placeholder" ? styles.placeholder : ""}`}>{message.body}</p>
        <span className={styles.meta}>
          <time dateTime={message.at}>{bubbleTime(message.at)}</time>
          {out ? <StatusChip status={message.status} /> : null}
        </span>
        {message.error ? (
          <span className={styles.error} role="note">
            {message.error}
          </span>
        ) : null}
      </li>
      {message.optChange ? (
        <li className={styles.system} data-testid="whatsapp-opt-note" data-opt={message.optChange}>
          {message.optChange === "opt_out"
            ? "They opted out. Missio can’t message them on WhatsApp until they send START."
            : "They opted back in. Missio can message them again."}
        </li>
      ) : null}
    </>
  );
}
