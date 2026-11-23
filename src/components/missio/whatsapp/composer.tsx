"use client";

import { useEffect, useId, useState } from "react";
import {
  fillTemplate,
  inServiceWindow,
  MAX_TEXT_LENGTH,
  MAX_VARIABLE_LENGTH,
  templateValuesProblem,
  type TemplateView,
} from "@/lib/missio/whatsapp/rules";
import type { MessageView, TemplatesResponse, ThreadResponse } from "@/lib/missio/whatsapp/types";
import { WhatsAppApiError, type WhatsAppClient } from "./client";
import { windowUntil } from "./format";
import { SendIcon } from "./icons";
import styles from "./whatsapp.module.css";

type Key = { personId: string } | { threadId: string };

export const WINDOW_EXPLAINER =
  "WhatsApp only allows a free reply for 24 hours after someone last wrote to Missio. A first message, or one after that, has to be a message WhatsApp has approved in advance.";

/** What the composer shows for this conversation. Only "free" and "template" can send. */
export function composerMode(thread: ThreadResponse, now: Date = new Date()):
  | "not_installed"
  | "not_configured"
  | "no_phone"
  | "bad_phone"
  | "opted_out"
  | "free"
  | "template" {
  if (thread.setup === "not_installed") return "not_installed";
  if (thread.blocked) return thread.blocked;
  if (thread.optedOut) return "opted_out";
  if (thread.setup === "not_configured") return "not_configured";
  return inServiceWindow(thread.lastInboundAt, now) ? "free" : "template";
}

export function Composer({
  thread,
  threadKey,
  client,
  now,
  onSent,
}: {
  thread: ThreadResponse;
  threadKey: Key;
  client: WhatsAppClient;
  now?: () => Date;
  onSent: (message: MessageView) => void;
}) {
  const at = now?.() ?? new Date();
  const mode = composerMode(thread, at);
  const [picking, setPicking] = useState(false);
  // Send to the conversation once there is one, so an unmatched number works too.
  const target = thread.thread ? { threadId: thread.thread.id } : "personId" in threadKey ? { personId: threadKey.personId } : threadKey;

  if (mode === "not_installed" || mode === "not_configured") {
    return (
      <Locked testId="composer-not-configured" title="WhatsApp isn’t switched on yet">
        {mode === "not_installed"
          ? "The Hub’s database update for WhatsApp (396) hasn’t been applied. Nothing can be sent until it is."
          : "Missio’s WhatsApp number still has to be connected on the server. Nothing can be sent until it is."}
      </Locked>
    );
  }
  if (mode === "no_phone" || mode === "bad_phone") {
    return (
      <Locked testId="composer-no-phone" title={mode === "no_phone" ? "No phone number" : "This number won’t work on WhatsApp"}>
        {mode === "no_phone"
          ? "There’s no phone number for them in People. Add one on their profile first."
          : `“${thread.person.phone ?? ""}” doesn’t look like a mobile number. Fix it on their profile first.`}
      </Locked>
    );
  }
  if (mode === "opted_out") {
    return (
      <Locked testId="composer-opted-out" title="They’ve opted out" tone="bad">
        They replied STOP, so Missio can’t message them on WhatsApp. If they send START, you can message them again. Call them if
        you need to reach them.
      </Locked>
    );
  }

  if (picking || mode === "template") {
    return (
      <TemplateComposer
        key={mode}
        mode={mode}
        target={target}
        client={client}
        canClose={mode === "free"}
        onClose={() => setPicking(false)}
        onSent={(message) => {
          setPicking(false);
          onSent(message);
        }}
      />
    );
  }

  return (
    <FreeComposer
      target={target}
      client={client}
      until={thread.windowEndsAt ? windowUntil(thread.windowEndsAt, at) : null}
      onPickTemplate={() => setPicking(true)}
      onSent={onSent}
    />
  );
}

function Locked({ title, children, testId, tone }: { title: string; children: React.ReactNode; testId: string; tone?: "bad" }) {
  return (
    <section className={`${styles.composer} ${styles.locked} ${tone === "bad" ? styles.lockedBad : ""}`} data-testid={testId} role="status">
      <h3 className={styles.lockedTitle}>{title}</h3>
      <p>{children}</p>
    </section>
  );
}

function sendError(error: unknown): string {
  if (error instanceof WhatsAppApiError) {
    if (error.code === "rate_limited") return "That’s a lot of messages in a minute. Wait a moment and try again.";
    return error.message;
  }
  return "Something went wrong. Nothing was sent.";
}

/** A failed send still comes back with the message, so it shows in the thread with its reason. */
function failedMessage(error: unknown): MessageView | null {
  if (!(error instanceof WhatsAppApiError) || error.code !== "send_failed") return null;
  const body = error.body as { message?: MessageView } | null;
  return body?.message ?? null;
}

function FreeComposer({
  target,
  client,
  until,
  onPickTemplate,
  onSent,
}: {
  target: Key;
  client: WhatsAppClient;
  until: string | null;
  onPickTemplate: () => void;
  onSent: (message: MessageView) => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const trimmed = text.trim();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await client.send({ ...target, text: trimmed });
      setText("");
      onSent(res.message);
    } catch (err) {
      const failed = failedMessage(err);
      if (failed) onSent(failed);
      setError(sendError(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <form className={styles.composer} onSubmit={submit} data-testid="composer-free">
      <p className={styles.windowLine}>
        <span className={styles.windowDot} aria-hidden="true" />
        <span>
          <b>Free reply open</b>
          {until ? ` ${until}` : ""}. They wrote in the last 24 hours.
        </span>
      </p>
      <label htmlFor={id} className={styles.visuallyHidden}>
        Message
      </label>
      <div className={styles.inputRow}>
        <textarea
          id={id}
          className={styles.textarea}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Write a message"
          rows={2}
          maxLength={MAX_TEXT_LENGTH}
          disabled={sending}
        />
        <button type="submit" className={styles.sendButton} disabled={!trimmed || sending} aria-label={sending ? "Sending" : "Send"}>
          <SendIcon />
        </button>
      </div>
      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" className={styles.linkButton} onClick={onPickTemplate}>
        Use an approved message instead
      </button>
    </form>
  );
}

type TemplatesState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: TemplatesResponse };

function TemplateComposer({
  mode,
  target,
  client,
  canClose,
  onClose,
  onSent,
}: {
  mode: "free" | "template";
  target: Key;
  client: WhatsAppClient;
  canClose: boolean;
  onClose: () => void;
  onSent: (message: MessageView) => void;
}) {
  const [state, setState] = useState<TemplatesState>({ kind: "loading" });
  const [chosen, setChosen] = useState<TemplateView | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const baseId = useId();

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    client.templates(attempt > 0).then(
      (data) => live && setState({ kind: "ready", data }),
      (err: unknown) => live && setState({ kind: "error", message: err instanceof WhatsAppApiError ? err.message : "Something went wrong." })
    );
    return () => {
      live = false;
    };
  }, [client, attempt]);

  const problem = chosen ? templateValuesProblem(chosen, values) : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!chosen || problem || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await client.send({ ...target, template: { name: chosen.name, language: chosen.language, values } });
      onSent(res.message);
    } catch (err) {
      const failed = failedMessage(err);
      if (failed) onSent(failed);
      setError(sendError(err));
    } finally {
      setSending(false);
    }
  }

  const templates = state.kind === "ready" && state.data.state === "ok" ? state.data.templates : [];

  return (
    <section className={`${styles.composer} ${styles.sheet}`} data-testid="composer-template" aria-label="Send an approved message">
      <div className={styles.sheetHead}>
        <h3 className={styles.sheetTitle}>{mode === "template" ? "Send an approved message" : "Approved messages"}</h3>
        {canClose ? (
          <button type="button" className={styles.linkButton} onClick={onClose}>
            Back to free reply
          </button>
        ) : null}
      </div>
      {mode === "template" ? <p className={styles.explainer}>{WINDOW_EXPLAINER}</p> : null}

      {state.kind === "loading" ? (
        <p className={styles.quiet} role="status">
          Loading approved messages…
        </p>
      ) : state.kind === "error" || (state.kind === "ready" && state.data.state !== "ok") ? (
        <div className={styles.inlineError} role="alert">
          <p>
            {state.kind === "error"
              ? "Approved messages didn’t load."
              : state.data.state === "not_configured"
                ? "WhatsApp isn’t switched on yet, so there are no approved messages to pick from."
                : "Approved messages didn’t load from WhatsApp."}
          </p>
          <button type="button" className={styles.secondary} onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : templates.length === 0 ? (
        <div className={styles.noTemplates} data-testid="composer-no-templates">
          <p>
            <b>No approved messages yet.</b> Before Missio can send someone a first message, a message has to be written and approved
            for Missio’s number in Meta’s WhatsApp Manager. Approval usually takes minutes to a day.
          </p>
          <button type="button" className={styles.secondary} onClick={() => setAttempt((n) => n + 1)}>
            Check again
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className={styles.templateForm}>
          <fieldset className={styles.choices}>
            <legend className={styles.visuallyHidden}>Choose a message</legend>
            {templates.map((t) => {
              const value = `${t.name}|${t.language}`;
              const on = chosen ? `${chosen.name}|${chosen.language}` === value : false;
              return (
                <label key={value} className={`${styles.choice} ${on ? styles.choiceOn : ""} ${t.blockedReason ? styles.choiceOff : ""}`}>
                  <input
                    type="radio"
                    name={`${baseId}-template`}
                    value={value}
                    checked={on}
                    disabled={Boolean(t.blockedReason) || sending}
                    onChange={() => {
                      setChosen(t);
                      setValues({});
                      setError(null);
                    }}
                  />
                  <span className={styles.choiceText}>
                    <span className={styles.choiceName}>
                      {t.name.replace(/_/g, " ")} <span className={styles.choiceLang}>{t.language}</span>
                    </span>
                    <span className={styles.choiceBody}>{t.body}</span>
                    {t.blockedReason ? <span className={styles.choiceWhy}>Can’t send from the Hub: {t.blockedReason}</span> : null}
                  </span>
                </label>
              );
            })}
          </fieldset>

          {chosen ? (
            <>
              {chosen.variables.length > 0 ? (
                <div className={styles.blanks}>
                  {chosen.variables.map((v) => {
                    const key = `${v.part}:${v.key}`;
                    const fieldId = `${baseId}-${key}`;
                    return (
                      <div key={key} className={styles.blank}>
                        <label htmlFor={fieldId}>
                          {v.part === "header" ? "Heading blank" : "Blank"} {v.key.replace(/_/g, " ")}
                        </label>
                        <input
                          id={fieldId}
                          className={styles.input}
                          value={values[key] ?? ""}
                          maxLength={MAX_VARIABLE_LENGTH}
                          disabled={sending}
                          onChange={(event) => setValues((prev) => ({ ...prev, [key]: event.target.value }))}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <div className={styles.preview} aria-live="polite">
                <span className={styles.previewLabel}>They’ll get</span>
                <p>{fillTemplate(chosen, values)}</p>
                {chosen.footer ? <p className={styles.previewFoot}>{chosen.footer}</p> : null}
              </div>
            </>
          ) : null}

          {error ? (
            <p className={styles.formError} role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className={styles.primary} disabled={!chosen || Boolean(problem) || sending}>
            {sending ? "Sending…" : chosen && problem ? problem : "Send"}
          </button>
        </form>
      )}
    </section>
  );
}
