"use client";

import { useState } from "react";
import type { CareNeed, CarePrivacy, CareRequest, CareSource, CareStatus } from "@/lib/missio/care";
import content from "../content.module.css";
import { MissioApiError } from "../api";
import { missioFixedCopy } from "../errors";
import { whatsAppHref } from "../follow-up/whatsapp";
import { houseTitle } from "../house-churches/format";
import { useMissioLoad } from "../house-churches/load";
import { HouseStatus } from "../house-churches/status";
import { MissioDialog } from "../missio-dialog";
import shell from "../shell.module.css";
import { careClient, type CareClient } from "./client";
import styles from "./care.module.css";

export const NEED_LABEL: Record<CareNeed, string> = { prayer: "Prayer", talk: "Talk", practical: "Practical help" };
export const PRIVACY_LABEL: Record<CarePrivacy, string> = {
  pastors: "Pastors only",
  pastors_leaders: "Pastors & leaders",
  house: "House can pray",
};
const SOURCE_LABEL: Record<CareSource, string> = {
  care_form: "Care form",
  connect_card: "Connect card",
  house_feedback: "House feedback",
  manual: "Logged by hand",
};
const COLUMNS: Array<{ status: CareStatus; label: string }> = [
  { status: "new", label: "New" },
  { status: "on_it", label: "Someone’s on it" },
  { status: "done", label: "Done" },
];

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Johannesburg" });

/** "2 hours ago", "yesterday", "5 days ago", "12 Nov". */
export function ago(iso: string, now = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.round((now.getTime() - then.getTime()) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";
  return dayMonth.format(then);
}

function whoOf(request: CareRequest): string {
  if (request.name) return request.name;
  if (request.source === "house_feedback" && request.house) return `${houseTitle(request.house)} feedback`;
  return "Anonymous";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]![0]}${parts[parts.length - 1]![0]}` : (parts[0] ?? "?").slice(0, 2)).toUpperCase();
}

/** Board M14b. Prayer and care from every door, in one place. Pastors. */
export function CareBoard({ client = careClient, origin }: { client?: CareClient; origin?: string }) {
  const { state, retry } = useMissioLoad(() => client.list(), [client]);
  const [taking, setTaking] = useState<CareRequest | null>(null);
  const [logging, setLogging] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const data = state.phase === "ready" ? state.data : null;
  const link = `${origin ?? (typeof window === "undefined" ? "" : window.location.origin)}/serve/missio/care`;

  async function step(request: CareRequest, action: Parameters<CareClient["step"]>[1]) {
    setBusy(request.id);
    setNotice(null);
    try {
      await client.step(request.id, action);
      retry();
    } catch (caught) {
      setNotice(missioFixedCopy(caught instanceof MissioApiError ? caught.code : null));
      retry();
    } finally {
      setBusy(null);
    }
  }

  const counts = new Map<CareSource, number>();
  for (const request of data?.requests ?? []) counts.set(request.source, (counts.get(request.source) ?? 0) + 1);

  return (
    <div className={content.page}>
      <div className={styles.head}>
        <div>
          <h1 className={content.title}>Care</h1>
          <p className={`${shell.lede} ${content.lede}`}>Prayer and care requests from every door, in one place</p>
        </div>
        <div className={styles.headActions}>
          <button
            type="button"
            className={shell.ghost}
            onClick={() => {
              void navigator.clipboard?.writeText(link);
              setNotice(`Care link copied: ${link}`);
            }}
          >
            Copy the care link
          </button>
          <button type="button" className={shell.primary} onClick={() => setLogging(true)}>
            Log a need
          </button>
        </div>
      </div>
      {data && counts.size > 0 ? (
        <p className={styles.sources} data-testid="care-sources">
          Comes in from:
          {(Object.keys(SOURCE_LABEL) as CareSource[])
            .filter((source) => counts.has(source))
            .map((source) => (
              <span key={source} className={styles.chip}>
                {SOURCE_LABEL[source]} · {counts.get(source)}
              </span>
            ))}
        </p>
      ) : null}
      {state.phase === "loading" ? <p className={shell.state}>Loading…</p> : null}
      {state.phase === "error" ? <HouseStatus error={state.error} fallback="Care didn’t load." onRetry={retry} /> : null}
      {notice ? (
        <p className={shell.alert} role="status">
          {notice}
        </p>
      ) : null}
      {data ? (
        <div className={styles.columns}>
          {COLUMNS.map((column) => {
            const cards = data.requests.filter((request) => request.status === column.status);
            return (
              <section key={column.status} className={styles.column} data-testid={`care-${column.status}`}>
                <h2>
                  {column.label} <span>{cards.length}</span>
                </h2>
                {cards.length === 0 ? <p className={styles.empty}>{column.status === "new" ? "Nothing waiting." : "No one yet."}</p> : null}
                <ul>
                  {cards.map((request) => {
                    const who = whoOf(request);
                    return (
                      <li key={request.id} className={`${styles.card} ${request.urgent && request.status !== "done" ? styles.cardUrgent : ""}`} data-testid="care-card">
                        <div className={styles.cardTop}>
                          <span className={styles.avatar} aria-hidden="true">
                            {initials(who)}
                          </span>
                          <div>
                            <b>{who}</b>
                            <span className={styles.meta}>
                              {SOURCE_LABEL[request.source]} · {ago(request.createdAt)}
                            </span>
                          </div>
                        </div>
                        <div className={styles.chips}>
                          {request.urgent ? <span className={`${styles.chip} ${styles.chipUrgent}`}>Urgent</span> : null}
                          {request.needs.map((need) => (
                            <span key={need} className={styles.chip}>
                              {NEED_LABEL[need]}
                            </span>
                          ))}
                        </div>
                        {request.body ? <p className={styles.body}>{request.body}</p> : null}
                        <div className={styles.foot}>
                          <span className={styles.privacy}>{PRIVACY_LABEL[request.privacy]}</span>
                          <div className={styles.actions}>
                            {request.status === "new" ? (
                              <button type="button" className={styles.take} disabled={busy === request.id} onClick={() => setTaking(request)}>
                                I’ll take it
                              </button>
                            ) : null}
                            {request.status === "on_it" ? (
                              <>
                                <span className={styles.meta}>{request.takenBy?.name ?? "A pastor"}</span>
                                <button type="button" className={styles.link} disabled={busy === request.id} onClick={() => void step(request, "done")}>
                                  Done
                                </button>
                              </>
                            ) : null}
                            {request.status === "done" ? (
                              <>
                                <span className={styles.meta}>
                                  {request.takenBy?.name.split(" ")[0] ?? "Done"}
                                  {request.doneAt ? ` · ${dayMonth.format(new Date(request.doneAt))}` : ""}
                                </span>
                                {request.checkIn ? (
                                  <button type="button" className={styles.link} disabled={busy === request.id} onClick={() => void step(request, "checked_in")}>
                                    Checked back in
                                  </button>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        </div>
                        {request.checkIn ? <span className={styles.checkIn}>Two weeks on: how are things now?</span> : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      ) : null}
      <p className={styles.footnote}>
        The person chose who may know, and only pastors see this board for now. Two weeks after “done”, the card asks whoever took
        it to check back in. Urgent requests go to the top in red.
      </p>
      {taking && data ? (
        <TakeDialog
          request={taking}
          me={data.me}
          onClose={() => setTaking(null)}
          onTake={async () => {
            await step(taking, "take");
            setTaking(null);
          }}
        />
      ) : null}
      {logging ? (
        <LogDialog
          client={client}
          onClose={() => setLogging(false)}
          onSaved={() => {
            setLogging(false);
            retry();
          }}
        />
      ) : null}
    </div>
  );
}

/** The first reply, edited where it's sent (board M13). */
export function takeMessage(request: CareRequest, me: string): string {
  const first = request.name?.split(" ")[0];
  const hello = first ? `Hi ${first}` : "Hi";
  const from = me ? `, it’s ${me} from Missio` : ", it’s Missio";
  const pray = request.needs.includes("prayer") ? " We’re praying for you." : "";
  return `${hello}${from}. Thank you for telling us.${pray} How are you doing?`;
}

function TakeDialog({ request, me, onClose, onTake }: { request: CareRequest; me: string; onClose: () => void; onTake: () => Promise<void> }) {
  const [message, setMessage] = useState(() => takeMessage(request, me));
  const [pending, setPending] = useState(false);
  const chat = whatsAppHref(request.phone);
  const who = whoOf(request);
  return (
    <MissioDialog onClose={onClose} title={`You’re taking ${request.name ? `${request.name.split(" ")[0]}’s` : "this"} request`} testId="care-take">
      {request.body ? <p className={styles.body}>{request.body}</p> : null}
      {chat ? (
        <label className={shell.field}>
          To {who.split(" ")[0]} · edit before you send
          <textarea className={styles.message} value={message} onChange={(event) => setMessage(event.target.value)} />
        </label>
      ) : (
        <p className={styles.meta}>{request.source === "house_feedback" ? "This came from house feedback. Talk to the leader." : "No number, so there’s no one to message. Take it to pray."}</p>
      )}
      <div className={shell.actions}>
        <button type="button" className={shell.ghost} onClick={onClose}>
          Cancel
        </button>
        {chat ? (
          <a
            className={shell.primary}
            href={`${chat}?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              setPending(true);
              void onTake();
            }}
            aria-disabled={pending}
          >
            Send & take it
          </a>
        ) : (
          <button
            type="button"
            className={shell.primary}
            disabled={pending}
            onClick={() => {
              setPending(true);
              void onTake();
            }}
          >
            Take it
          </button>
        )}
      </div>
    </MissioDialog>
  );
}

function LogDialog({ client, onClose, onSaved }: { client: CareClient; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [needs, setNeeds] = useState<CareNeed[]>(["prayer"]);
  const [body, setBody] = useState("");
  const [privacy, setPrivacy] = useState<CarePrivacy>("pastors");
  const [urgent, setUrgent] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    if (!body.trim() || needs.length === 0 || pending) return;
    setPending(true);
    try {
      await client.log({
        needs,
        body: body.trim(),
        privacy,
        urgent,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      });
      onSaved();
    } catch (caught) {
      setNotice(missioFixedCopy(caught instanceof MissioApiError ? caught.code : null));
      setPending(false);
    }
  }

  return (
    <MissioDialog onClose={onClose} title="Log a need" testId="care-log">
      <div className={shell.fields}>
        <label className={shell.field}>
          Who (optional)
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className={shell.field}>
          Phone (optional)
          <input value={phone} maxLength={40} inputMode="tel" onChange={(event) => setPhone(event.target.value)} />
        </label>
        <div className={styles.needs} role="group" aria-label="What they need">
          {(Object.keys(NEED_LABEL) as CareNeed[]).map((need) => (
            <label key={need}>
              <input
                type="checkbox"
                checked={needs.includes(need)}
                onChange={() => setNeeds((list) => (list.includes(need) ? list.filter((item) => item !== need) : [...list, need]))}
              />
              {NEED_LABEL[need]}
            </label>
          ))}
        </div>
        <label className={shell.field}>
          What’s going on
          <textarea className={styles.message} value={body} maxLength={2000} onChange={(event) => setBody(event.target.value)} />
        </label>
        <label className={shell.field}>
          Who can know
          <select value={privacy} onChange={(event) => setPrivacy(event.target.value as CarePrivacy)}>
            {(Object.keys(PRIVACY_LABEL) as CarePrivacy[]).map((value) => (
              <option key={value} value={value}>
                {PRIVACY_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.needs}>
          <label>
            <input type="checkbox" checked={urgent} onChange={(event) => setUrgent(event.target.checked)} />
            It’s urgent
          </label>
        </div>
      </div>
      {notice ? (
        <p className={shell.alert} role="alert">
          {notice}
        </p>
      ) : null}
      <div className={shell.actions}>
        <button type="button" className={shell.ghost} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={shell.primary} disabled={!body.trim() || needs.length === 0 || pending} onClick={() => void save()}>
          Add to the board
        </button>
      </div>
    </MissioDialog>
  );
}
