"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/ffsa";

export type RosterPerson = { name: string; email: string; role: string };
export type SendRow = {
  id: string;
  to_email: string;
  to_name: string | null;
  kind: "invite" | "reminder";
  status: "sent" | "failed" | "suppressed";
  error: string | null;
  sent_at: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Sharing is deliberately link-first: one URL and a QR, because that is
// how a team actually gets asked (WhatsApp group, the stage screen at
// pack-down). Email is the convenience path on top, not the mechanism —
// there are no per-person tokens to keep straight.
export function SharePanel({
  eventId,
  formId,
  slug,
  formTitle,
  status,
  isAnonymous,
  roster,
  sends,
  respondentEmails,
}: {
  eventId: string;
  formId: string;
  slug: string;
  formTitle: string;
  status: "draft" | "open" | "closed";
  isAnonymous: boolean;
  roster: RosterPerson[];
  sends: SendRow[];
  respondentEmails: string[];
}) {
  const router = useRouter();
  const [origin, setOrigin] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState("");
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<"invite" | "reminder">("invite");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Built in the browser so the link is right on every deploy target
  // (preview URLs included) without threading an env var through.
  const url = origin ? `${origin}/fb/${slug}` : `/fb/${slug}`;

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!origin) return;
    QRCode.toDataURL(url, { width: 720, margin: 2, errorCorrectionLevel: "M" })
      .then(setQr)
      .catch(() => setQr(null));
  }, [url, origin]);

  const answered = useMemo(
    () => new Set(respondentEmails.map((e) => e.toLowerCase())),
    [respondentEmails]
  );
  const askedEmails = useMemo(
    () => [...new Set(sends.filter((s) => s.status === "sent").map((s) => s.to_email))],
    [sends]
  );
  // Only meaningful on a named form: an anonymous response carries no
  // address to match against, so nobody can be marked as "still owing".
  const outstanding = isAnonymous
    ? []
    : askedEmails.filter((e) => !answered.has(e.toLowerCase()));

  function toggle(email: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  function copyLink() {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function downloadQr() {
    if (!qr) return;
    const a = document.createElement("a");
    a.href = qr;
    a.download = `${slug}-feedback-qr.png`;
    a.click();
  }

  function selectOutstanding() {
    setPicked(new Set(outstanding));
    setKind("reminder");
  }

  async function send() {
    const typed = extra
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const byEmail = new Map<string, string | null>();
    for (const email of picked) {
      byEmail.set(email, roster.find((r) => r.email === email)?.name ?? null);
    }
    for (const email of typed) {
      if (!byEmail.has(email)) {
        byEmail.set(email, roster.find((r) => r.email === email)?.name ?? null);
      }
    }

    const recipients = [...byEmail.entries()].map(([email, name]) => ({ email, name }));
    if (!recipients.length) {
      setErr("Pick someone from the roster, or type an email address.");
      return;
    }
    const bad = recipients.filter((r) => !EMAIL_RE.test(r.email));
    if (bad.length) {
      setErr(`Not a valid email address: ${bad.map((b) => b.email).join(", ")}`);
      return;
    }

    setBusy(true);
    setErr(null);
    setMsg(null);
    const res = await fetch(`/api/events/${eventId}/feedback/${formId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipients, kind, note: note.trim() || null }),
    });
    setBusy(false);

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(data.error ?? "Failed to send");
      return;
    }
    const result = (await res.json()) as { sent: number; failed: number };
    setMsg(
      result.failed
        ? `Sent to ${result.sent}. ${result.failed} could not be delivered — see the send log below.`
        : `Sent to ${result.sent} ${result.sent === 1 ? "person" : "people"}.`
    );
    setPicked(new Set());
    setExtra("");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* ── the link ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Share the form</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {status !== "open" && (
            <p className="border border-amber-border px-3 py-2 text-sm text-amber">
              This form is {status === "draft" ? "still a draft" : "closed"} — the
              link shows a notice instead of the questions. Use{" "}
              <strong>Save &amp; open form</strong> above when you&rsquo;re ready
              to collect.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <code className="border px-2 py-1.5 text-xs font-mono break-all flex-1 min-w-[240px]">
              {url}
            </code>
            <button
              type="button"
              onClick={copyLink}
              className="px-3 py-1.5 border text-xs hover:bg-[color:var(--surface-2)]"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 border text-xs hover:bg-[color:var(--surface-2)]"
            >
              Open ↗
            </a>
          </div>

          <div className="flex items-center gap-4">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="Feedback form QR code" className="w-32 h-32 border bg-white" />
            ) : (
              <div className="w-32 h-32 border bg-[color:var(--surface-2)]" />
            )}
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground max-w-sm">
                Put the QR on the screen at pack-down, while everyone is still in
                the room. It is the single highest-response moment you will get.
              </p>
              <button
                type="button"
                onClick={downloadQr}
                disabled={!qr}
                className="px-3 py-1.5 border text-sm hover:bg-[color:var(--surface-2)] disabled:opacity-50"
              >
                Download QR
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── email the link ───────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Email the link</CardTitle>
          {outstanding.length > 0 && (
            <button
              type="button"
              onClick={selectOutstanding}
              className="text-xs text-ink hover:underline"
            >
              Select {outstanding.length} who haven&rsquo;t answered
            </button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {roster.length > 0 ? (
            <div>
              <p className="mono-label mb-2">From the event roster</p>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {roster.map((p) => {
                  const hasAnswered = !isAnonymous && answered.has(p.email.toLowerCase());
                  const wasAsked = askedEmails.includes(p.email);
                  return (
                    <li key={p.email}>
                      <label className="flex items-start gap-2 border p-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={picked.has(p.email)}
                          onChange={() => toggle(p.email)}
                          className="mt-1"
                        />
                        <span className="min-w-0">
                          <span className="block truncate">{p.name}</span>
                          <span className="block text-xs text-muted-foreground truncate">
                            {p.role} · {p.email}
                          </span>
                          {hasAnswered ? (
                            <span className="mt-1 inline-block">
                              <StatusPill tone="good">Answered</StatusPill>
                            </span>
                          ) : wasAsked ? (
                            <span className="mt-1 inline-block">
                              <StatusPill tone="quiet">Asked</StatusPill>
                            </span>
                          ) : null}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nobody on the event roster has an email address on file. Add people
              under <strong>Details &amp; Roles</strong>, or type addresses below.
            </p>
          )}

          <div>
            <label className="mono-label block mb-1">Other email addresses</label>
            <textarea
              rows={2}
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="volunteer@example.com, another@example.com"
              className="w-full border px-2 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="mono-label block mb-1">Add a line of your own (optional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="We're planning the next one on the 14th — your notes shape it."
              className="w-full border px-2 py-1.5 text-sm"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "invite" | "reminder")}
              className="border px-2 py-1.5 text-xs"
            >
              <option value="invite">First ask</option>
              <option value="reminder">Reminder</option>
            </select>
            <button
              type="button"
              onClick={send}
              disabled={busy || status !== "open"}
              className="px-4 py-1.5 bg-ink text-white text-xs hover:bg-[#262622] disabled:bg-[color:var(--surface-4)]"
              title={status !== "open" ? "Open the form before sending" : undefined}
            >
              {busy ? "Sending…" : kind === "reminder" ? "Send reminder" : "Send the link"}
            </button>
            <span className="text-xs text-muted-foreground">
              {picked.size > 0 ? `${picked.size} selected` : "Nobody selected yet"}
            </span>
          </div>

          {(msg || err) && (
            <p className={`text-sm ${err ? "text-destructive" : "text-grass-text"}`}>
              {err ?? msg}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── send log ─────────────────────────────────────── */}
      {sends.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Send log</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Who has been asked, and when. {formTitle} keeps this so a reminder
              never turns into a fourth email to the same person.
            </p>
            <ul className="divide-y">
              {sends.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm truncate">{s.to_name || s.to_email}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {s.to_name ? `${s.to_email} · ` : ""}
                      {s.kind === "reminder" ? "Reminder" : "First ask"} ·{" "}
                      {new Date(s.sent_at).toLocaleString()}
                      {s.error ? ` · ${s.error}` : ""}
                    </p>
                  </div>
                  <StatusPill
                    tone={
                      s.status === "sent"
                        ? "good"
                        : s.status === "suppressed"
                          ? "warn"
                          : "bad"
                    }
                  >
                    {s.status === "sent"
                      ? "Sent"
                      : s.status === "suppressed"
                        ? "Suppressed"
                        : "Failed"}
                  </StatusPill>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
