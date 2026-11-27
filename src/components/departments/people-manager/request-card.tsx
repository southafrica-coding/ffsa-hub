"use client";

import { useId, useState, type ReactNode } from "react";
import pw from "@/components/song-library/pw.module.css";
import { ALREADY_DECIDED, decisionBody, errorCopy, type PmApi } from "./client";
import { firstName, rangeLabel, requestMeta } from "./format";
import pm from "./pm.module.css";
import type { PmDecision, PmRequest } from "./types";
import { DaysBox, StatusTag } from "./ui";

/** Codes after which the request on screen is stale and must be read again. */
const REFETCH_CODES = new Set([ALREADY_DECIDED, "leave_request_changed", "leave_request_locked", "conflict"]);

export type RequestCardProps = {
  request: PmRequest;
  api: PmApi;
  /** "mine": my own list; "leader": the queue (name first); "person": a person's history. */
  view: "mine" | "leader" | "person";
  /** Pills under the dates (queue context). Replaces the status tag when given. */
  pills?: ReactNode;
  /** Extra line(s) above the actions. */
  aside?: ReactNode;
  focused?: boolean;
  /** A write succeeded (with the new row) or the row is stale (no row): parent refetches. */
  onChanged: (updated?: PmRequest) => void;
};

export function RequestCard({ request: r, api, view, pills, aside, focused, onChanged }: RequestCardProps) {
  const mine = view === "mine";
  const typeLabel = r.type.label ?? "Leave";
  const title = view === "leader" ? `${r.requester.name ?? "Someone"} · ${typeLabel}` : typeLabel;
  const noteBy = mine ? "Your note" : firstName(r.requester.name);
  const failed = r.status === "pending" ? r.sent_to.filter((s) => !s.ok) : [];
  const classes = [pm.req, r.status === "pending" ? pm.reqPend : "", focused ? pm.reqFocus : ""].filter(Boolean).join(" ");

  return (
    <article className={classes} id={`request-${r.id}`} aria-label={`${title}, ${rangeLabel(r.start_date, r.end_date)}`}>
      <div className={pm.reqTop}>
        <div className={pm.reqWhat}>
          <div className={pm.reqK}>{title}</div>
          <div className={pm.reqS}>{rangeLabel(r.start_date, r.end_date)}</div>
        </div>
        <DaysBox days={r.days_count} />
      </div>
      <div className={pm.reqMeta}>
        {pills ?? <StatusTag status={r.status} />}
        {pills ? null : <span className={pm.metaText}>{requestMeta(r, mine)}</span>}
      </div>
      {r.notes ? (
        <div className={pm.reqNote}>
          <b>{noteBy}:</b> {r.notes}
        </div>
      ) : null}
      {r.decision_note && (r.status === "approved" || r.status === "declined") ? (
        <div className={pm.reqNote}>
          <b>{firstName(r.decided_by_person?.name)}:</b> {r.decision_note}
        </div>
      ) : null}
      {aside}
      {failed.length > 0 && (mine || r.can_decide || view === "person") ? (
        <ResendNotice request={r} api={api} names={failed.map((f) => firstName(f.name))} />
      ) : null}
      {r.can_decide ? <DecisionActions request={r} api={api} onChanged={onChanged} /> : null}
      {r.can_cancel ? <CancelAction request={r} api={api} onChanged={onChanged} /> : null}
    </article>
  );
}

/** Approve / Decline… A decline needs a note; the UI won't send one without it. */
export function DecisionActions({
  request,
  api,
  onChanged,
}: {
  request: Pick<PmRequest, "id" | "requester" | "can_decide">;
  api: PmApi;
  onChanged: (updated?: PmRequest) => void;
}) {
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const noteId = useId();
  if (!request.can_decide) return null;
  const who = firstName(request.requester.name);

  async function send(decision: PmDecision) {
    const body = decisionBody(decision, decision === "declined" ? note : null);
    if (!body) {
      setMessage(errorCopy("leave_request_decline_note_required"));
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await api.decide(request.id, body);
    setBusy(false);
    if (result.ok) {
      setDeclining(false);
      onChanged(result.data.request);
      return;
    }
    setMessage(errorCopy(result.code));
    if (result.code && REFETCH_CODES.has(result.code)) onChanged();
  }

  return (
    <>
      {declining ? (
        <div className={pm.declineBox}>
          <label className={pw.label} htmlFor={noteId}>
            Note to {who} (required)
          </label>
          <textarea
            id={noteId}
            className={pw.input}
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Say why, so they can plan"
          />
          <p className={pm.reqInfo}>{who} sees this in the Hub and in their Slack DM.</p>
          <div className={pm.acts}>
            <button type="button" className={pw.btn} onClick={() => setDeclining(false)} disabled={busy}>
              Back
            </button>
            <button
              type="button"
              className={`${pw.btn} ${pw.primary}`}
              onClick={() => void send("declined")}
              disabled={busy || !note.trim()}
              aria-disabled={busy || !note.trim()}
            >
              Decline request
            </button>
          </div>
        </div>
      ) : (
        <div className={pm.acts}>
          <button type="button" className={`${pw.btn} ${pw.primary}`} onClick={() => void send("approved")} disabled={busy}>
            Approve
          </button>
          <button
            type="button"
            className={`${pw.btn} ${pm.declineBtn}`}
            onClick={() => {
              setMessage(null);
              setDeclining(true);
            }}
            disabled={busy}
          >
            Decline…
          </button>
        </div>
      )}
      {message ? (
        <p className={pm.reqMsg} role="alert">
          {message}
        </p>
      ) : null}
    </>
  );
}

function CancelAction({ request, api, onChanged }: { request: PmRequest; api: PmApi; onChanged: (updated?: PmRequest) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setMessage(null);
    const result = await api.cancel(request.id);
    setBusy(false);
    if (result.ok) {
      setConfirming(false);
      onChanged(result.data.request);
      return;
    }
    setMessage(errorCopy(result.code));
    if (result.code && REFETCH_CODES.has(result.code)) onChanged();
  }

  return (
    <>
      <div className={pm.acts}>
        {confirming ? (
          <>
            <button type="button" className={pw.btn} onClick={() => setConfirming(false)} disabled={busy}>
              Keep it
            </button>
            <button type="button" className={`${pw.btn} ${pm.declineBtn}`} onClick={() => void cancel()} disabled={busy}>
              Yes, cancel it
            </button>
          </>
        ) : (
          <button type="button" className={pw.btn} onClick={() => setConfirming(true)}>
            Cancel request
          </button>
        )}
      </div>
      {message ? (
        <p className={pm.reqMsg} role="alert">
          {message}
        </p>
      ) : null}
    </>
  );
}

/** A Slack DM didn't reach someone: offer a resend. The server's error text is never shown. */
function ResendNotice({ request, api, names }: { request: PmRequest; api: PmApi; names: string[] }) {
  const [state, setState] = useState<"idle" | "busy" | "sent" | "failed">("idle");
  const [code, setCode] = useState<string | null>(null);
  async function resend() {
    setState("busy");
    const result = await api.notify(request.id);
    if (result.ok) setState("sent");
    else {
      setCode(result.code);
      setState("failed");
    }
  }
  return (
    <div className={pm.reqInfo}>
      <span>
        The Slack message didn&apos;t reach {names.join(", ")}.{" "}
        {state === "sent" ? "Sent again." : state === "failed" ? errorCopy(code) : null}
      </span>
      {state !== "sent" ? (
        <div className={pm.acts}>
          <button type="button" className={`${pw.btn} ${pw.ghost}`} onClick={() => void resend()} disabled={state === "busy"}>
            Resend notification
          </button>
        </div>
      ) : null}
    </div>
  );
}
