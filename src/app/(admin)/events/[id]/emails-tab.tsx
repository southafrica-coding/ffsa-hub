"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EventEmailWording } from "@/lib/email/event-email-wording";
import { EmailWordingEditor } from "./email-wording-editor";

// The event's Emails tab (migration 241): who every email this event sends
// comes from, where replies go, and whether the event's own logo heads them.
// One setting, used by the ticket confirmation, pay-later invoice, refund,
// cancellation notice, feedback invites and (unless a step picks its own)
// workflow emails.

type Identity = {
  id: string | null;
  slug?: string;
  display_name: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  forward_to: string[];
};

type Settings = {
  event: {
    title: string;
    brand: string;
    logo_url: string | null;
    email_show_event_logo: boolean;
    sending_identity_id: string | null;
    email_wording: EventEmailWording;
  };
  brand_sender: Identity;
  current: Identity | null;
  current_editable: boolean;
  identities: Identity[];
  domains: string[];
  default_forward: string[];
  hub_inbox_domain: string;
};

const BRAND = "__brand__";
const NEW = "__new__";

const USES = [
  ["Ticket confirmation", "The email with their QR tickets."],
  ["Pay-later invoice", "From this sender's name and address; replies still go to finance@ffsouthafrica.com."],
  ["Refund", "Full and partial refunds."],
  ["Cancellation notice", "When the event is cancelled."],
  ["Feedback invites + reminders", "From the Feedback tab."],
  ["Workflow emails", "Unless a workflow step picks its own sender."],
] as const;

const splitAddress = (email: string) => {
  const at = email.lastIndexOf("@");
  return at < 0 ? { local: email, domain: "" } : { local: email.slice(0, at), domain: email.slice(at + 1) };
};

const inputCls = "border px-2 py-1.5 text-sm w-full disabled:opacity-60";

export function EmailsTab({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [s, setS] = useState<Settings | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [choice, setChoice] = useState<string>(BRAND);
  const [form, setForm] = useState({ name: "", local: "", domain: "", forward: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/email-settings`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoadErr(data.error ?? "Couldn't load");
      return;
    }
    const st = data as Settings;
    setS(st);
    setChoice(st.event.sending_identity_id ?? BRAND);
    const base = st.current ?? null;
    const addr = splitAddress(base?.from_email ?? st.brand_sender.from_email);
    setForm({
      name: base?.from_name ?? st.event.title,
      local: addr.local,
      domain: st.domains.includes(addr.domain) ? addr.domain : st.domains[0],
      forward: (base?.forward_to?.length ? base.forward_to : st.default_forward).join(", "),
    });
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(method: string, body: Record<string, unknown>, done: string) {
    setBusy(true);
    setErr(null);
    setHint(null);
    const res = await fetch(`/api/events/${eventId}/email-settings`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(data.error ?? "Couldn't save");
      return false;
    }
    setHint(done);
    await load();
    router.refresh();
    return true;
  }

  const senderBody = () => ({
    from_name: form.name,
    from_local: form.local,
    from_domain: form.domain,
    forward_to: form.forward.split(/[\s,;]+/).filter(Boolean),
  });

  // What the chosen option would send as, for the summary line.
  const shown: Identity | null = useMemo(() => {
    if (!s) return null;
    if (choice === BRAND) return s.brand_sender;
    if (choice === NEW) return null;
    return s.identities.find((i) => i.id === choice) ?? null;
  }, [s, choice]);

  if (loadErr) return <p className="text-sm text-destructive">{loadErr}</p>;
  if (!s) return <p className="text-sm text-muted-foreground">Loading email settings…</p>;

  const savedChoice = s.event.sending_identity_id ?? BRAND;
  const isOwn = choice === savedChoice && choice !== BRAND && s.current_editable;
  const editing = choice === NEW || isOwn;
  const others = s.identities.filter((i) => i.id !== s.brand_sender.id);

  return (
    <div className="space-y-6">
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sender</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Who this event&apos;s emails come from, and where replies go. Replies come back into the Hub (logged on
              the person&apos;s record) and are forwarded to the inboxes you choose.
            </p>

            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">Send as</span>
              <select
                className={inputCls}
                value={choice}
                disabled={busy}
                onChange={(e) => {
                  setChoice(e.target.value);
                  setErr(null);
                  setHint(null);
                }}
              >
                <option value={BRAND}>
                  Brand sender — {s.brand_sender.from_name} &lt;{s.brand_sender.from_email}&gt;
                </option>
                {others.map((i) => (
                  <option key={i.id!} value={i.id!}>
                    {i.display_name} — {i.from_name} &lt;{i.from_email}&gt;
                  </option>
                ))}
                <option value={NEW}>＋ New sender for this event…</option>
              </select>
            </label>

            {!editing && shown && (
              <div className="border border-border bg-muted/40 p-3 text-xs space-y-1">
                <p>
                  <span className="text-muted-foreground">From:</span> {shown.from_name} &lt;{shown.from_email}&gt;
                </p>
                <p>
                  <span className="text-muted-foreground">Replies land in:</span> {shown.reply_to ?? "nowhere set"}
                  {shown.forward_to?.length ? ` → forwarded to ${shown.forward_to.join(", ")}` : ""}
                </p>
                {choice !== BRAND && choice === savedChoice && !s.current_editable && (
                  <p className="text-muted-foreground">
                    Other events (or a brand) use this sender, so it&apos;s edited under{" "}
                    <Link className="underline" href="/communications/identities">
                      Communications → Identities
                    </Link>
                    .
                  </p>
                )}
              </div>
            )}

            {editing && (
              <div className="space-y-3 border border-border p-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-muted-foreground">Sender name (what the inbox shows)</span>
                  <input
                    className={inputCls}
                    value={form.name}
                    maxLength={80}
                    disabled={busy}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </label>
                <div>
                  <span className="mb-1 block text-xs text-muted-foreground">From address</span>
                  <div className="flex items-center gap-1">
                    <input
                      className={inputCls}
                      value={form.local}
                      disabled={busy}
                      onChange={(e) => setForm({ ...form, local: e.target.value.trim().toLowerCase() })}
                    />
                    <span>@</span>
                    <select
                      className={inputCls}
                      value={form.domain}
                      disabled={busy}
                      onChange={(e) => setForm({ ...form, domain: e.target.value })}
                    >
                      {s.domains.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Only domains verified for sending are listed —{" "}
                    <Link className="underline" href="/communications/domains">
                      add another
                    </Link>
                    . People reply to the Hub address below, not this one.
                  </p>
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs text-muted-foreground">Forward replies to</span>
                  <input
                    className={inputCls}
                    value={form.forward}
                    disabled={busy}
                    placeholder="media@ffsouthafrica.com, events-lead@ffsouthafrica.com"
                    onChange={(e) => setForm({ ...form, forward: e.target.value })}
                  />
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    Separate several with commas. Replies are also kept in the Hub on the person&apos;s record.
                  </span>
                </label>
                <p className="text-[11px] text-muted-foreground">
                  Replies come back to{" "}
                  <code>
                    {choice === NEW
                      ? `${(s.current?.slug ?? "this-event")}…@${s.hub_inbox_domain}`
                      : s.current?.reply_to ?? `…@${s.hub_inbox_domain}`}
                  </code>
                  {choice === NEW && " (named after the event when it's created)"}.
                </p>
              </div>
            )}

            {err && <p className="text-xs text-destructive">{err}</p>}
            {hint && <p className="text-xs text-grass-text">{hint}</p>}

            <div className="flex flex-wrap gap-2">
              {choice === NEW ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => call("POST", senderBody(), "Sender created — this event now sends as it.")}
                  className="px-3 py-1.5 bg-ink text-white text-xs hover:bg-[#262622] disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Create sender and use it"}
                </button>
              ) : isOwn ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => call("PUT", senderBody(), "Sender saved.")}
                  className="px-3 py-1.5 bg-ink text-white text-xs hover:bg-[#262622] disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save sender"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy || choice === savedChoice}
                  onClick={() =>
                    call(
                      "PATCH",
                      { sending_identity_id: choice === BRAND ? null : choice },
                      choice === BRAND ? "Back to the brand sender." : "Sender switched."
                    )
                  }
                  className="px-3 py-1.5 bg-ink text-white text-xs hover:bg-[#262622] disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Use this sender"}
                </button>
              )}
              {choice !== savedChoice && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setChoice(savedChoice)}
                  className="px-3 py-1.5 border border-border text-xs hover:bg-muted"
                >
                  Cancel
                </button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Logo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {s.event.logo_url ? (
              <>
                <div className="flex items-center gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.event.logo_url}
                    alt="Event logo"
                    className="max-h-16 max-w-[180px] border border-border bg-muted/40 p-1"
                  />
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={s.event.email_show_event_logo}
                      disabled={busy}
                      onChange={(e) =>
                        call(
                          "PATCH",
                          { email_show_event_logo: e.target.checked },
                          e.target.checked ? "The logo now heads this event's emails." : "Logo removed from emails."
                        )
                      }
                    />
                    Show this logo at the top of the event&apos;s emails
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  It sits above the message, inside the brand&apos;s own email design. Change the logo itself on{" "}
                  <Link className="underline" href={`/events/${eventId}?tab=details`}>
                    Details &amp; Roles
                  </Link>
                  .
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">
                This event has no logo yet. Upload one on{" "}
                <Link className="underline" href={`/events/${eventId}?tab=details`}>
                  Details &amp; Roles
                </Link>{" "}
                and you can put it at the top of its emails here.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="self-start">
        <CardHeader>
          <CardTitle className="text-base">Emails that use this</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {USES.map(([name, note]) => (
              <li key={name}>
                <p className="font-semibold">{name}</p>
                <p className="text-xs text-muted-foreground">{note}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>

    <EmailWordingEditor eventId={eventId} saved={s.event.email_wording ?? {}} onSaved={load} />
    </div>
  );
}
