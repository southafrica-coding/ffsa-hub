"use client";

/**
 * One feedback item, inside the 470px Drawer. The same panel serves both
 * sides: the submitter (their item, the conversation, the status trail)
 * and the team (plus context, team notes and — for triage — the controls).
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/ffsa";
import { cn } from "@/lib/utils/cn";
import {
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  KIND_META,
  SEVERITIES,
  SEVERITY_META,
  STATUS_META,
  fmtFeedbackDate,
  isFeedbackKind,
  isFeedbackSeverity,
  isFeedbackStatus,
} from "@/lib/hub-feedback/constants";
import type { FeedbackDetail } from "@/lib/hub-feedback/types";

type Assignee = { id: string; name: string };
type MergeTarget = { id: string; ref: number; title: string };

export function FeedbackDetailPanel({
  id,
  assignees = [],
  mergeTargets = [],
  onChanged,
}: {
  id: string;
  /** Team only: who an item can be handed to. */
  assignees?: Assignee[];
  /** Team only: open items this one could be merged into. */
  mergeTargets?: MergeTarget[];
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<FeedbackDetail | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/hub-feedback/${id}`);
    if (!res.ok) {
      setMissing(true);
      return;
    }
    setDetail(await res.json());
  }, [id]);

  useEffect(() => {
    setDetail(null);
    setMissing(false);
    load();
  }, [load]);

  async function refresh() {
    await load();
    onChanged?.();
  }

  if (missing) return <p className="mono-label px-6 py-8">This item couldn&rsquo;t be loaded</p>;
  if (!detail) return <p className="mono-label px-6 py-8">Loading…</p>;

  const { item } = detail;
  const kind = isFeedbackKind(item.kind) ? KIND_META[item.kind].label : item.kind;
  const status = isFeedbackStatus(item.status) ? STATUS_META[item.status] : null;
  const severity = isFeedbackSeverity(item.severity) ? SEVERITY_META[item.severity] : null;
  const conversation = detail.comments.filter((c) => c.visibility === "submitter");
  const teamNotes = detail.comments.filter((c) => c.visibility === "team");

  return (
    <div className="flex flex-col">
      {/* Head */}
      <div className="border-b border-ink px-6 pb-5 pt-5">
        <div className="mono-label">
          #{item.ref} · {kind}
          {item.module_label ? ` · ${item.module_label}` : ""}
        </div>
        <h2 className="mt-1.5 font-display text-[24px] font-black uppercase leading-[1.05] text-ink">{item.title}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {status && (
            <StatusPill tone={status.tone}>{detail.is_team ? status.label : status.forSubmitter}</StatusPill>
          )}
          {severity && <StatusPill tone={severity.tone}>{severity.label}</StatusPill>}
          {detail.is_team && item.duplicate_count > 0 && (
            <StatusPill tone="warn">+{item.duplicate_count} more reported this</StatusPill>
          )}
        </div>
        <p className="mt-3 text-[12.5px] text-[color:var(--text-secondary)]">
          {detail.is_team ? `${item.submitter_name} · ` : "Sent "}
          {fmtFeedbackDate(item.created_at, true)}
          {item.source === "slack" ? " · via Slack" : ""}
        </p>
      </div>

      {item.status_note && item.status !== "new" && (
        <div className="border-b border-rule border-l-[3px] border-l-yellow bg-bone px-6 py-3.5 text-[13.5px] text-ink">
          {item.status_note}
        </div>
      )}

      {detail.merged_into && (
        <div className="border-b border-rule px-6 py-3.5 text-[13.5px]">
          Merged into <strong>#{detail.merged_into.ref} {detail.merged_into.title}</strong>
          {isFeedbackStatus(detail.merged_into.status) && (
            <> — now {STATUS_META[detail.merged_into.status].forSubmitter.toLowerCase()}</>
          )}
        </div>
      )}

      {/* Body */}
      <Section title="What they said">
        {item.details ? (
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{item.details}</p>
        ) : (
          <p className="text-[13px] text-[color:var(--text-secondary)]">No details — just the title.</p>
        )}
        {detail.files.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {detail.files.map((f) =>
              f.url ? (
                <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="block border border-rule-strong hover:border-ink">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.url} alt={f.file_name ?? "Screenshot"} className="h-24 w-24 object-cover" />
                </a>
              ) : null
            )}
          </div>
        )}
      </Section>

      {detail.is_team && (item.page_path || item.user_agent) && (
        <Section title="Where they were">
          <dl className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
            {item.page_path && (
              <>
                <dt className="mono-label">Page</dt>
                <dd className="break-all font-mono text-[12px]">{item.page_path}</dd>
              </>
            )}
            {item.viewport && (
              <>
                <dt className="mono-label">Screen</dt>
                <dd>{item.viewport}</dd>
              </>
            )}
            {item.user_agent && (
              <>
                <dt className="mono-label">Device</dt>
                <dd className="break-words text-[11.5px] text-[color:var(--text-secondary)]">{item.user_agent}</dd>
              </>
            )}
          </dl>
        </Section>
      )}

      {detail.can_triage && (
        <TriageControls
          detail={detail}
          assignees={assignees}
          mergeTargets={mergeTargets.filter((m) => m.id !== item.id)}
          onSaved={refresh}
        />
      )}

      {detail.is_team && detail.duplicates.length > 0 && (
        <Section title={`Also reported by ${detail.duplicates.length}`}>
          <ul className="space-y-1.5 text-[13px]">
            {detail.duplicates.map((d) => (
              <li key={d.id}>
                <span className="font-mono text-[11px] text-[#7C786C]">#{d.ref}</span> {d.title}{" "}
                <span className="text-[color:var(--text-secondary)]">
                  — {d.submitter_name}, {fmtFeedbackDate(d.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={detail.is_team ? "Conversation with the sender" : "Conversation"}>
        <Thread comments={conversation} empty={detail.is_team ? "No messages to the sender yet." : "No messages yet."} />
        <CommentBox
          id={item.id}
          visibility="submitter"
          placeholder={
            detail.is_team
              ? `Message ${item.submitter_name.split(" ")[0]} (they'll see this)`
              : item.status === "needs_info"
                ? "Answer the question…"
                : "Add more detail…"
          }
          onSent={refresh}
        />
      </Section>

      {detail.is_team && (
        <Section title="Team notes" dark>
          <Thread comments={teamNotes} empty="No team notes." />
          <CommentBox id={item.id} visibility="team" placeholder="Note for the team (the sender can't see this)" onSent={refresh} />
        </Section>
      )}

      <Section title="History">
        <ul className="space-y-1.5 text-[12.5px]">
          {detail.events.map((e) => (
            <li key={e.id} className="flex gap-3">
              <span className="w-[88px] shrink-0 font-mono text-[10.5px] text-[#7C786C]">
                {fmtFeedbackDate(e.created_at, true)}
              </span>
              <span>{describeEvent(e)}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function describeEvent(e: FeedbackDetail["events"][number]): string {
  const who = e.actor_name ?? "The Hub";
  const to = isFeedbackStatus(e.to_status) ? STATUS_META[e.to_status].label : e.to_status;
  switch (e.kind) {
    case "created":
      return `${who} sent it`;
    case "merged":
      return `${who} merged it into ${e.note ?? "another item"}`;
    case "assigned":
      return e.note ? `${who} assigned it to ${e.note}` : `${who} unassigned it`;
    default:
      return `${who} moved it to ${to}${e.note ? ` — “${e.note}”` : ""}`;
  }
}

function Section({ title, dark, children }: { title: string; dark?: boolean; children: React.ReactNode }) {
  return (
    <section className="border-b border-rule">
      <div className={cn("px-6 py-2", dark ? "bg-ink" : "bg-bone")}>
        <span className={cn("font-mono text-[9.5px] font-bold uppercase tracking-[0.18em]", dark ? "text-yellow" : "text-ink")}>
          {title}
        </span>
      </div>
      <div className="px-6 py-4">{children}</div>
    </section>
  );
}

function Thread({ comments, empty }: { comments: FeedbackDetail["comments"]; empty: string }) {
  if (comments.length === 0) return <p className="text-[13px] text-[color:var(--text-secondary)]">{empty}</p>;
  return (
    <ul className="space-y-3">
      {comments.map((c) => (
        <li key={c.id} className={cn("border-l-[3px] pl-3", c.mine ? "border-l-ink" : "border-l-rule-strong")}>
          <div className="mono-label">
            {c.mine ? "You" : c.author_name} · {fmtFeedbackDate(c.created_at, true)}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-ink">{c.body}</p>
        </li>
      ))}
    </ul>
  );
}

function CommentBox({
  id,
  visibility,
  placeholder,
  onSent,
}: {
  id: string;
  visibility: "team" | "submitter";
  placeholder: string;
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/hub-feedback/${id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text.trim(), visibility }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast.error(body.error ?? "Couldn't send that");
      return;
    }
    setText("");
    onSent();
  }

  return (
    <div className="mt-3 space-y-2">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} rows={2} />
      <div className="flex justify-end">
        <Button size="sm" onClick={send} disabled={busy || !text.trim()}>
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}

function TriageControls({
  detail,
  assignees,
  mergeTargets,
  onSaved,
}: {
  detail: FeedbackDetail;
  assignees: Assignee[];
  mergeTargets: MergeTarget[];
  onSaved: () => void;
}) {
  const { item } = detail;
  const [status, setStatus] = useState(item.status);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [mergeInto, setMergeInto] = useState("");

  useEffect(() => {
    setStatus(item.status);
    setNote("");
    setMergeInto("");
  }, [item.id, item.status]);

  async function patch(body: Record<string, unknown>, done: string) {
    setBusy(true);
    const res = await fetch(`/api/hub-feedback/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      toast.error(out.error ?? "Couldn't save that");
      return;
    }
    toast.success(done);
    onSaved();
  }

  const statusChanged = status !== item.status;
  const notePrompt =
    status === "needs_info"
      ? "What do you need to know? (they'll see this)"
      : status === "shipped"
        ? "Where to find it (optional, they'll see this)"
        : status === "declined"
          ? "Why not, for now (optional, they'll see this)"
          : "Note to the sender (optional)";

  return (
    <Section title="Triage">
      <div className="space-y-4">
        <div>
          <div className="mono-label mb-1.5">Stage</div>
          <div className="flex flex-wrap gap-1.5">
            {FEEDBACK_STATUSES.filter((s) => s !== "duplicate").map((s) => (
              <button
                key={s}
                type="button"
                className="chip"
                data-active={status === s ? "true" : undefined}
                onClick={() => setStatus(s)}
              >
                {STATUS_META[s].label}
              </button>
            ))}
          </div>
          {statusChanged && (
            <div className="mt-2.5 space-y-2">
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={notePrompt}
                rows={2}
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setStatus(item.status)} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={busy || (status === "needs_info" && !note.trim())}
                  onClick={() =>
                    patch({ status, status_note: note }, `Moved to ${isFeedbackStatus(status) ? STATUS_META[status].label : status}`)
                  }
                >
                  Move &amp; notify
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mono-label mb-1.5 block">Assigned to</span>
            <select
              value={item.assigned_to ?? ""}
              disabled={busy}
              onChange={(e) => patch({ assigned_to: e.target.value || null }, "Assignment saved")}
              className="h-9 w-full border border-input bg-white px-2 text-sm"
            >
              <option value="">Nobody yet</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mono-label mb-1.5 block">Type</span>
            <select
              value={item.kind}
              disabled={busy}
              onChange={(e) => patch({ kind: e.target.value }, "Type saved")}
              className="h-9 w-full border border-input bg-white px-2 text-sm"
            >
              {FEEDBACK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_META[k].label}
                </option>
              ))}
            </select>
          </label>
          {item.kind === "problem" && (
            <label className="block">
              <span className="mono-label mb-1.5 block">Severity</span>
              <select
                value={item.severity ?? ""}
                disabled={busy}
                onChange={(e) => patch({ severity: e.target.value || null }, "Severity saved")}
                className="h-9 w-full border border-input bg-white px-2 text-sm"
              >
                <option value="">Not set</option>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_META[s].label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {item.status !== "duplicate" && mergeTargets.length > 0 && (
          <div>
            <span className="mono-label mb-1.5 block">Same as another item?</span>
            <div className="flex gap-2">
              <select
                value={mergeInto}
                onChange={(e) => setMergeInto(e.target.value)}
                className="h-9 min-w-0 flex-1 border border-input bg-white px-2 text-sm"
              >
                <option value="">Pick the item to merge into…</option>
                {mergeTargets.map((m) => (
                  <option key={m.id} value={m.id}>
                    #{m.ref} {m.title}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !mergeInto}
                onClick={() => patch({ duplicate_of: mergeInto }, "Merged")}
              >
                Merge
              </Button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
