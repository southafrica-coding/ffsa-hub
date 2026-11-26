"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EVENT_EMAILS,
  MERGE_TAGS,
  MESSAGE_MAX,
  SUBJECT_MAX,
  unknownTags,
  type EventEmailKey,
  type EventEmailWording,
} from "@/lib/email/event-email-wording";

// Per email: the event's own subject and message, with a live preview of
// exactly what a buyer gets (this event's sender, logo and design, on sample
// data) and "send me a test" (migration 242).

type Preview = {
  subject: string;
  html: string;
  from: { name: string; email: string; replyTo: string | null };
  note: string | null;
};

const KEYS = Object.keys(EVENT_EMAILS) as EventEmailKey[];

export function EmailWordingEditor({
  eventId,
  saved,
  onSaved,
}: {
  eventId: string;
  saved: EventEmailWording;
  onSaved: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState<EventEmailKey | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState<"save" | "reset" | "test" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);
  const subjectRef = useRef<HTMLInputElement | null>(null);
  const lastFocus = useRef<"subject" | "message">("message");

  const startEdit = (key: EventEmailKey) => {
    setOpen(key);
    setSubject(saved[key]?.subject ?? "");
    setMessage(saved[key]?.message ?? "");
    setErr(null);
    setHint(null);
    setPreview(null);
  };

  const loadPreview = useCallback(
    async (key: EventEmailKey, s: string, m: string) => {
      setPreviewing(true);
      const res = await fetch(`/api/events/${eventId}/email-settings/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, wording: { subject: s, message: m } }),
      });
      const data = await res.json().catch(() => ({}));
      setPreviewing(false);
      if (!res.ok) {
        setErr(data.error ?? "Couldn't build the preview");
        return;
      }
      setPreview(data as Preview);
    },
    [eventId]
  );

  // Live preview, a moment after typing stops.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void loadPreview(open, subject, message), 450);
    return () => clearTimeout(t);
  }, [open, subject, message, loadPreview]);

  async function save(key: EventEmailKey, s: string, m: string, kind: "save" | "reset") {
    setBusy(kind);
    setErr(null);
    setHint(null);
    const res = await fetch(`/api/events/${eventId}/email-settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email_wording: { [key]: { subject: s, message: m } } }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setErr(data.error ?? "Couldn't save");
      return;
    }
    if (kind === "reset") {
      setSubject("");
      setMessage("");
    }
    setHint(kind === "reset" ? "Back to the standard wording." : "Saved — this email now goes out with your wording.");
    await onSaved();
  }

  async function sendTest(key: EventEmailKey) {
    setBusy("test");
    setErr(null);
    setHint(null);
    const res = await fetch(`/api/events/${eventId}/email-settings/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, wording: { subject, message }, send: true }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) setErr(data.error ?? "Couldn't send the test");
    else setHint(`Test sent to ${data.sentTo}.`);
  }

  function insertTag(tag: string) {
    const which = lastFocus.current;
    const el = which === "subject" ? subjectRef.current : messageRef.current;
    const value = which === "subject" ? subject : message;
    const set = which === "subject" ? setSubject : setMessage;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    set(value.slice(0, start) + tag + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + tag.length, start + tag.length);
    });
  }

  const unknown = open ? unknownTags(`${subject}\n${message}`) : [];
  const dirty = !!open && (subject.trim() !== (saved[open]?.subject ?? "") || message.trim() !== (saved[open]?.message ?? ""));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Wording</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Give any email its own subject line and a message of your own. Your message sits inside the email&apos;s
          normal design — the tickets, amounts and links are always there. Leave both empty for the standard email.
        </p>

        <div className="divide-y divide-border border border-border">
          {KEYS.map((key) => {
            const w = saved[key];
            const custom = [w?.subject && "subject", w?.message && "message"].filter(Boolean).join(" + ");
            const isOpen = open === key;
            return (
              <div key={key}>
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div>
                    <p className="font-semibold">{EVENT_EMAILS[key].name}</p>
                    <p className="text-xs text-muted-foreground">
                      {custom ? `Your ${custom}` : "Standard wording"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => (isOpen ? setOpen(null) : startEdit(key))}
                    className="px-2.5 py-1 border border-border text-xs hover:bg-muted"
                  >
                    {isOpen ? "Close" : "Edit + preview"}
                  </button>
                </div>

                {isOpen && (
                  <div className="grid gap-4 border-t border-border bg-muted/30 p-3 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
                    <div className="space-y-3">
                      <label className="block">
                        <span className="mb-1 block text-xs text-muted-foreground">Subject</span>
                        <input
                          ref={subjectRef}
                          value={subject}
                          maxLength={SUBJECT_MAX}
                          onFocus={() => (lastFocus.current = "subject")}
                          onChange={(e) => setSubject(e.target.value)}
                          placeholder="Leave empty for the standard subject"
                          className="w-full border px-2 py-1.5 text-sm"
                        />
                      </label>
                      {EVENT_EMAILS[key].message ? (
                        <label className="block">
                          <span className="mb-1 block text-xs text-muted-foreground">Your message</span>
                          <textarea
                            ref={messageRef}
                            value={message}
                            maxLength={MESSAGE_MAX}
                            rows={7}
                            onFocus={() => (lastFocus.current = "message")}
                            onChange={(e) => setMessage(e.target.value)}
                            placeholder="e.g. Doors open at 18:00 — parking is behind the hall. Bring a jacket, it gets cold!"
                            className="w-full border px-2 py-1.5 text-sm"
                          />
                          <span className="block text-[11px] text-muted-foreground">
                            A blank line starts a new paragraph. {message.length}/{MESSAGE_MAX}
                          </span>
                        </label>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          This email&apos;s message is the cancellation reason you write when you cancel the event.
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="text-muted-foreground">Insert:</span>
                        {MERGE_TAGS.map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => insertTag(t)}
                            className="border border-border bg-white px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted"
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                      {unknown.length > 0 && (
                        <p className="text-xs text-amber">
                          {unknown.join(", ")} won&apos;t be filled in — only {MERGE_TAGS.join(" and ")} are.
                        </p>
                      )}

                      {err && <p className="text-xs text-destructive">{err}</p>}
                      {hint && <p className="text-xs text-grass-text">{hint}</p>}

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy !== null || !dirty}
                          onClick={() => save(key, subject, message, "save")}
                          className="px-3 py-1.5 bg-ink text-white text-xs hover:bg-[var(--ink-bg-hover)] disabled:opacity-50"
                        >
                          {busy === "save" ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => sendTest(key)}
                          className="px-3 py-1.5 border border-border text-xs hover:bg-muted disabled:opacity-50"
                        >
                          {busy === "test" ? "Sending…" : "Send me a test"}
                        </button>
                        {(saved[key]?.subject || saved[key]?.message) && (
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => save(key, "", "", "reset")}
                            className="px-3 py-1.5 text-xs text-muted-foreground underline disabled:opacity-50"
                          >
                            Reset to standard
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="min-w-0">
                      {preview ? (
                        <div className="border border-border bg-white">
                          <div className="space-y-0.5 border-b border-border px-3 py-2 text-xs">
                            <p>
                              <span className="text-muted-foreground">From:</span> {preview.from.name} &lt;
                              {preview.from.email}&gt;
                            </p>
                            {preview.from.replyTo && (
                              <p>
                                <span className="text-muted-foreground">Replies to:</span> {preview.from.replyTo}
                              </p>
                            )}
                            <p>
                              <span className="text-muted-foreground">Subject:</span>{" "}
                              <span className="font-semibold">{preview.subject}</span>
                            </p>
                            {preview.note && <p className="text-muted-foreground">{preview.note}</p>}
                          </div>
                          <iframe
                            title={`${EVENT_EMAILS[key].name} preview`}
                            srcDoc={preview.html}
                            sandbox=""
                            className={`h-[640px] w-full ${previewing ? "opacity-60" : ""}`}
                          />
                        </div>
                      ) : (
                        <p className="py-10 text-center text-xs text-muted-foreground">
                          {previewing ? "Building the preview…" : "Preview appears here."}
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Sample data: you as the buyer, this event&apos;s first ticket tier.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
