"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Paperclip, Reply, Check, Archive, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionBar, StatusPill, type Tone } from "@/components/ffsa";
import type { InboundEmail, InboundStatus } from "@/services/inbound-emails";

type Filter = "open" | "handled" | "archived" | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "handled", label: "Handled" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
];

const STATUS_TONE: Record<InboundStatus, Tone> = {
  new: "bad",
  read: "quiet",
  handled: "good",
  archived: "quiet",
};

function senderName(e: InboundEmail): string {
  const c = e.contacts;
  const contactName = c ? [c.first_name, c.last_name].filter(Boolean).join(" ") : "";
  return contactName || e.from_name || e.from_email;
}

function when(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

export function InboxView({
  emails: initial,
  identities,
  initialOpenId,
}: {
  emails: InboundEmail[];
  identities: { id: string; display_name: string }[];
  initialOpenId: string | null;
}) {
  const router = useRouter();
  const [emails, setEmails] = useState(initial);
  const [filter, setFilter] = useState<Filter>(() => {
    const opened = initial.find((e) => e.id === initialOpenId);
    return opened && (opened.status === "handled" || opened.status === "archived")
      ? "all"
      : "open";
  });
  const [team, setTeam] = useState<string>("");
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [err, setErr] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      emails.filter((e) => {
        if (team && e.identity_id !== team) return false;
        if (filter === "open") return e.status === "new" || e.status === "read";
        if (filter === "all") return true;
        return e.status === filter;
      }),
    [emails, filter, team]
  );
  const open = emails.find((e) => e.id === openId) ?? null;
  const newCount = emails.filter((e) => e.status === "new").length;

  async function setStatus(id: string, status: InboundStatus) {
    setErr(null);
    const prev = emails;
    setEmails((list) => list.map((e) => (e.id === id ? { ...e, status } : e)));
    const res = await fetch(`/api/inbound-emails/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      setEmails(prev);
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(d.error ?? "Couldn't update the reply");
      return;
    }
    router.refresh();
  }

  function openEmail(e: InboundEmail) {
    setOpenId(e.id);
    // Opening it is reading it.
    if (e.status === "new") void setStatus(e.id, "read");
  }

  return (
    <div className="space-y-3">
      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`chip ${filter === f.key ? "border-ink text-ink" : ""}`}
          >
            {f.label}
            {f.key === "open" && newCount > 0 ? ` · ${newCount} new` : ""}
          </button>
        ))}
        <select
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          className="ml-auto h-8 border border-rule bg-white px-2 text-xs"
          aria-label="Filter by team"
        >
          <option value="">All teams</option>
          {identities.map((i) => (
            <option key={i.id} value={i.id}>
              {i.display_name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="border border-ink bg-white">
          <SectionBar title="Replies" meta={`${visible.length}`} />
          {visible.length === 0 ? (
            <p className="px-5 py-6 text-sm text-[color:var(--text-tertiary)]">
              {emails.length === 0
                ? "No replies yet. When someone answers an email from the Hub, it shows up here."
                : "Nothing in this view."}
            </p>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-[color:var(--rule)] overflow-y-auto">
              {visible.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => openEmail(e)}
                    className={`block w-full px-4 py-3 text-left hover:bg-[color:var(--surface-2)] ${
                      openId === e.id ? "bg-[color:var(--surface-2)]" : ""
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={`truncate text-sm ${
                          e.status === "new" ? "font-semibold" : ""
                        }`}
                      >
                        {senderName(e)}
                      </span>
                      <span className="tabular shrink-0 text-[11px] text-[color:var(--text-tertiary)]">
                        {when(e.received_at)}
                      </span>
                    </div>
                    <div className="truncate text-[13px]">
                      {e.subject || "(no subject)"}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[color:var(--text-tertiary)]">
                      <span className="truncate">
                        {e.sending_identities?.display_name ?? e.to_emails[0] ?? "—"}
                      </span>
                      {e.attachments.length > 0 && <Paperclip className="h-3 w-3" />}
                      {e.is_auto_reply && <span>auto-reply</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border border-ink bg-white">
          {!open ? (
            <p className="px-5 py-10 text-center text-sm text-[color:var(--text-tertiary)]">
              Select a reply to read it.
            </p>
          ) : (
            <ReplyDetail email={open} onStatus={(s) => setStatus(open.id, s)} />
          )}
        </div>
      </div>
    </div>
  );
}

function ReplyDetail({
  email: e,
  onStatus,
}: {
  email: InboundEmail;
  onStatus: (s: InboundStatus) => void;
}) {
  const replySubject = /^re:/i.test(e.subject ?? "") ? e.subject : `Re: ${e.subject ?? ""}`;
  const mailto = `mailto:${encodeURIComponent(e.from_email)}?subject=${encodeURIComponent(
    replySubject ?? ""
  )}`;

  return (
    <div>
      <SectionBar title={e.subject || "(no subject)"} />
      <div className="space-y-1 border-b border-rule px-5 py-3 text-[13px]">
        <div>
          <span className="text-[color:var(--text-tertiary)]">From </span>
          <span className="font-medium">{senderName(e)}</span>{" "}
          <span className="font-mono text-xs text-[color:var(--text-tertiary)]">
            &lt;{e.from_email}&gt;
          </span>
          {e.contact_id ? (
            <Link
              href={`/contacts/${e.contact_id}`}
              className="ml-2 text-xs underline"
            >
              View contact
            </Link>
          ) : (
            <span className="ml-2 text-xs text-[color:var(--text-tertiary)]">
              Not a contact yet
            </span>
          )}
        </div>
        <div>
          <span className="text-[color:var(--text-tertiary)]">To </span>
          {e.sending_identities?.display_name ?? "No team"}{" "}
          <span className="font-mono text-xs text-[color:var(--text-tertiary)]">
            {e.to_emails.join(", ")}
          </span>
        </div>
        <div className="text-xs text-[color:var(--text-tertiary)]">
          {new Date(e.received_at).toLocaleString()} ·{" "}
          {e.forwarded_at ? (
            <>Forwarded to {e.forwarded_to.join(", ")}</>
          ) : e.forward_error ? (
            <span className="text-destructive">Forward failed: {e.forward_error}</span>
          ) : e.is_auto_reply ? (
            <>Auto-reply — not forwarded</>
          ) : (
            <>Not forwarded — add inboxes for this team on Identities</>
          )}
        </div>
        {e.forwarded_at && e.forward_error && (
          <div className="text-xs text-[color:var(--amber)]">{e.forward_error}</div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-5 py-2.5">
        <StatusPill tone={STATUS_TONE[e.status]}>{e.status}</StatusPill>
        <a href={mailto} className="ml-auto">
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs">
            <Reply className="h-3.5 w-3.5" />
            Reply
          </Button>
        </a>
        {e.status !== "handled" && (
          <Button
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => onStatus("handled")}
          >
            <Check className="h-3.5 w-3.5" />
            Mark handled
          </Button>
        )}
        {e.status !== "archived" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => onStatus("archived")}
          >
            <Archive className="h-3.5 w-3.5" />
            Archive
          </Button>
        )}
        {e.status !== "new" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => onStatus("new")}
          >
            <Mail className="h-3.5 w-3.5" />
            Mark unread
          </Button>
        )}
      </div>

      {e.html_body ? (
        // Untrusted mail HTML: an empty sandbox means no scripts, forms,
        // popups or same-origin access — it can only be looked at.
        <iframe
          title="Reply content"
          sandbox=""
          srcDoc={e.html_body}
          className="h-[55vh] w-full border-0 bg-white"
        />
      ) : (
        <pre className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap px-5 py-4 font-sans text-sm">
          {e.text_body || "(empty message)"}
        </pre>
      )}

      {e.attachments.length > 0 && (
        <div className="border-t border-rule px-5 py-3 text-xs text-[color:var(--text-secondary)]">
          <div className="mono-label mb-1">Attachments</div>
          {e.attachments.map((a) => (
            <div key={a.id} className="flex items-center gap-1.5">
              <Paperclip className="h-3 w-3" />
              {a.filename ?? "attachment"} · {Math.max(1, Math.round(a.size / 1024))} KB
            </div>
          ))}
          <div className="mt-1 text-[color:var(--text-tertiary)]">
            Attachments arrive with the forwarded copy in the team&rsquo;s inbox.
          </div>
        </div>
      )}
    </div>
  );
}
