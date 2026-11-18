"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MissioApiError } from "../api";
import content from "../content.module.css";
import shell from "../shell.module.css";
import { houseChurchesClient, houseErrorCopy, type HouseChurchesClient } from "./client";
import { houseTitle, reviewHeading, reviewReasons, ROLE_LABEL } from "./format";
import { useMissioLoad } from "./load";
import { AllHousesLink } from "./present";
import { accessStatus, HouseStatus } from "./status";
import type { PersonRef, ResolveBody, ReviewContactMatch, ReviewItem } from "./types";
import styles from "./house-churches.module.css";

export function ReviewQueue({
  client = houseChurchesClient,
}: {
  client?: HouseChurchesClient;
}) {
  const { state, retry } = useMissioLoad(() => client.listReview(), [client]);
  const [queue, setQueue] = useState<ReviewItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [skipNote, setSkipNote] = useState("");
  // People already added from the name on screen. A sheet name can be a couple.
  const [added, setAdded] = useState<string[]>([]);
  const focusTarget = useRef<"item" | "done" | "next" | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state.phase === "ready") setQueue(state.data.items);
  }, [state]);

  const items = queue ?? (state.phase === "ready" ? state.data.items : []);
  const total = items.length;
  const item = !finished && index < total ? items[index] : null;

  useEffect(() => {
    const target = focusTarget.current;
    if (!target) return;
    focusTarget.current = null;
    const id =
      target === "done" ? "review-done-heading" : target === "next" ? "review-next" : "review-item-heading";
    document.getElementById(id)?.focus();
  });

  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice, item?.id, finished]);

  function resetFields() {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setSkipNote("");
    setNotice(null);
  }

  function resetPersonFields() {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
  }

  function advance(count: number) {
    const next = index + 1;
    resetFields();
    setAdded([]);
    setIndex(next);
    const done = next >= count;
    if (done) setFinished(true);
    focusTarget.current = done ? "done" : "item";
  }

  async function refreshQueue(currentId: string, fromIndex: number) {
    const page = await client.listReview();
    const remaining = page.items.filter((row) => row.id !== currentId);
    setQueue(remaining);
    setAdded([]);
    if (remaining.length === 0) {
      setFinished(true);
      setIndex(0);
      return;
    }
    setFinished(false);
    setIndex(Math.min(fromIndex, remaining.length - 1));
  }

  async function resolve(body: ResolveBody, count: number, name?: string) {
    if (!item) return;
    setPending(true);
    setNotice(null);
    try {
      const again = added.length > 0 && body.action !== "skip";
      await client.resolveReview(item.id, again ? { ...body, also: true } : body);
      if (body.action === "skip") {
        advance(count);
      } else {
        // Stay on the name so a spouse or the rest of a household can be added.
        setAdded((names) => [...names, name ?? "Person"]);
        resetPersonFields();
        focusTarget.current = "next";
      }
    } catch (caught) {
      if (caught instanceof MissioApiError && caught.code === "already_resolved") {
        setNotice(houseErrorCopy(caught));
        await refreshQueue(item.id, index).catch(() => undefined);
        return;
      }
      setNotice(caught instanceof MissioApiError ? houseErrorCopy(caught, "review") : "That didn’t work. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (state.phase === "error" && accessStatus(state.error) != null) {
    return (
      <div className={`${content.page} ${styles.root}`}>
        <HouseStatus error={state.error} fallback="Names to review didn’t load." onRetry={retry} />
      </div>
    );
  }

  return (
    <div className={`${content.page} ${styles.root}`}>
      <AllHousesLink />
      <div className={styles.reviewHead}>
        <h1 className={content.title}>Review names</h1>
        {item ? (
          <p className={styles.progress} data-testid="review-progress">
            {index + 1} of {total}
          </p>
        ) : null}
      </div>
      {finished ? null : (
        <p className={`${shell.lede} ${content.lede}`}>
          Match each imported name to a person, create them, or skip. Linking or creating adds them to the house and
          to Missio. If the name is a couple, add both before moving on.
        </p>
      )}

      {!queue && state.phase === "loading" ? (
        <div className={shell.state} data-state="loading" role="status">
          Loading names to review…
        </div>
      ) : null}
      {state.phase === "error" ? (
        <HouseStatus error={state.error} fallback="Names to review didn’t load." onRetry={retry} />
      ) : null}
      {state.phase === "ready" && total === 0 && !finished ? (
        <div className={shell.state} data-state="empty" data-testid="review-empty">
          No imported names are waiting.
        </div>
      ) : null}
      {notice ? (
        <p ref={noticeRef} id="review-action-error" className={shell.alert} role="alert" tabIndex={-1}>
          {notice}
        </p>
      ) : null}
      {state.phase === "ready" && finished ? (
        <h2 id="review-done-heading" tabIndex={-1} className={styles.doneTitle} data-testid="review-done">
          {doneHeading(total)}
        </h2>
      ) : null}
      {item ? (
        <ReviewCard
          key={item.id}
          item={item}
          pending={pending}
          client={client}
          firstName={firstName}
          lastName={lastName}
          email={email}
          phone={phone}
          skipNote={skipNote}
          added={added}
          last={index + 1 >= total}
          onNext={() => advance(total)}
          onFirstName={setFirstName}
          onLastName={setLastName}
          onEmail={setEmail}
          onPhone={setPhone}
          onSkipNote={setSkipNote}
          onLink={(contactId, name) => void resolve({ action: "link", contactId }, total, name)}
          onCreate={() => {
            const given = firstName.trim();
            if (!given) {
              setNotice("Enter a first name.");
              return;
            }
            const family = lastName.trim();
            const mail = email.trim();
            const number = phone.trim();
            void resolve(
              {
                action: "create",
                firstName: given,
                ...(family ? { lastName: family } : {}),
                ...(mail ? { email: mail } : {}),
                ...(number ? { phone: number } : {}),
              },
              total,
              family ? `${given} ${family}` : given
            );
          }}
          onSkip={() => {
            const notes = skipNote.trim();
            void resolve(notes ? { action: "skip", notes } : { action: "skip" }, total);
          }}
        />
      ) : null}
    </div>
  );
}

function doneHeading(count: number): string {
  if (count <= 0) return "No names left to review.";
  if (count === 1) return "That name is resolved.";
  if (count === 2) return "Both names are resolved.";
  return `All ${count} names are resolved.`;
}

function ReviewCard({
  item,
  pending,
  client,
  firstName,
  lastName,
  email,
  phone,
  skipNote,
  added,
  last,
  onNext,
  onFirstName,
  onLastName,
  onEmail,
  onPhone,
  onSkipNote,
  onLink,
  onCreate,
  onSkip,
}: {
  item: ReviewItem;
  pending: boolean;
  client: Pick<HouseChurchesClient, "searchReviewContacts">;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  skipNote: string;
  added: string[];
  last: boolean;
  onNext: () => void;
  onFirstName: (value: string) => void;
  onLastName: (value: string) => void;
  onEmail: (value: string) => void;
  onPhone: (value: string) => void;
  onSkipNote: (value: string) => void;
  onLink: (contactId: string, name: string) => void;
  onCreate: () => void;
  onSkip: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const houseLabel = item.house ? houseTitle(item.house) : `House ${item.houseNumber}`;
  const houseNumber = item.house?.number ?? item.houseNumber;
  const housePlace = item.role ? `House ${houseNumber} · ${ROLE_LABEL[item.role]}` : `House ${houseNumber}`;
  const reasons = reviewReasons(item);
  const note = item.notes?.trim() ?? "";

  return (
    <article data-testid="review-item">
      <section className={styles.summary} data-testid="review-summary">
        <h2 id="review-item-heading" tabIndex={-1}>
          {reviewHeading(item)}
        </h2>
        {note ? <p className={styles.quiet}>{note}</p> : null}
        {item.house?.name?.trim() ? <p className={styles.line}>{houseLabel}</p> : null}
        <p className={styles.line}>{housePlace}</p>
        <ul className={styles.reasons}>
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </section>

      {added.length > 0 ? (
        <section className={styles.added} data-testid="review-added" aria-live="polite">
          <h2>Added to House {houseNumber}</h2>
          <ul className={styles.addedList}>
            {added.map((name, at) => (
              <li key={`${name}-${at}`}>{name}</li>
            ))}
          </ul>
          <p className={styles.quiet}>Is this name a couple or a household? Add the next person below.</p>
          <div className={styles.formActions}>
            <button id="review-next" type="button" className={shell.primary} disabled={pending} onClick={onNext}>
              {last ? "Done" : "Next name"}
            </button>
          </div>
        </section>
      ) : null}

      {item.candidates.length > 0 ? (
        <section className={styles.section}>
          <h2>{added.length > 0 ? "Add another: possible matches" : "Possible matches"}</h2>
          <ul className={styles.choices} data-testid="review-candidates">
            {item.candidates.map((candidate) => (
              <li key={candidate.contactId}>
                <button
                  type="button"
                  className={`${shell.ghost} ${styles.choice}`}
                  disabled={pending}
                  onClick={() => onLink(candidate.contactId, candidate.displayName)}
                >
                  <span className={styles.choiceText}>
                    <span className={styles.choiceName}>Use {candidate.displayName}</span>
                    <span className={styles.choiceMeta}>{matchMeta(candidate, candidate.orgPersonId != null)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.section}>
        <h2>{added.length > 0 ? "Add another: search everyone" : "Search everyone"}</h2>
        <p className={`${shell.help} ${styles.searchHelp}`}>
          Looks through every contact in the Hub, not only Missio. Linking someone adds them to Missio.
        </p>
        <ContactSearch client={client} pending={pending} onPick={onLink} />
      </section>

      <section className={styles.section}>
        <button
          type="button"
          className={shell.ghost}
          aria-expanded={creating}
          data-testid="create-toggle"
          onClick={() => setCreating((open) => !open)}
        >
          Create new person
        </button>
        {creating ? (
          <form
            className={styles.form}
            data-testid="review-create"
            onSubmit={(event) => {
              event.preventDefault();
              onCreate();
            }}
          >
            <label className={shell.field}>
              First name
              <input aria-label="First name" value={firstName} onChange={(event) => onFirstName(event.target.value)} />
            </label>
            <label className={shell.field}>
              Last name
              <input aria-label="Last name" value={lastName} onChange={(event) => onLastName(event.target.value)} />
            </label>
            <label className={shell.field}>
              Email
              <input aria-label="Email" inputMode="email" autoComplete="off" value={email} onChange={(event) => onEmail(event.target.value)} />
            </label>
            <label className={shell.field}>
              Phone
              <input aria-label="Phone" inputMode="tel" autoComplete="off" value={phone} onChange={(event) => onPhone(event.target.value)} />
            </label>
            <div className={styles.formActions}>
              <button type="submit" className={shell.primary} disabled={pending}>
                Create person
              </button>
            </div>
          </form>
        ) : null}
      </section>

      {added.length > 0 ? null : (
        <section className={styles.section}>
          <h2>Skip</h2>
          <form
            className={styles.form}
            data-testid="review-skip"
            onSubmit={(event) => {
              event.preventDefault();
              onSkip();
            }}
          >
            <label className={shell.field}>
              Note
              <textarea
                className={styles.note}
                aria-label="Skip note"
                value={skipNote}
                onChange={(event) => onSkipNote(event.target.value)}
              />
            </label>
            <div className={styles.formActions}>
              <button type="submit" className={shell.ghost} disabled={pending}>
                Skip
              </button>
            </div>
          </form>
        </section>
      )}
    </article>
  );
}

/** The quiet line under a name: who they are, and whether linking adds them to Missio. */
function matchMeta(person: PersonRef, inMissio: boolean): string {
  const where = inMissio ? "Already in Missio" : "Not in Missio yet";
  return person.hint ? `${person.hint} · ${where}` : where;
}

function ContactSearch({
  client,
  pending,
  onPick,
}: {
  client: Pick<HouseChurchesClient, "searchReviewContacts">;
  pending: boolean;
  onPick: (contactId: string, name: string) => void;
}) {
  const fieldId = useId();
  const [draft, setDraft] = useState("");
  const [rows, setRows] = useState<ReviewContactMatch[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  async function search(query: string) {
    const q = query.trim();
    if (q.length < 2) {
      setRows(null);
      setNotice("Enter at least two letters of a name.");
      return;
    }
    setSearching(true);
    setNotice(null);
    try {
      const page = await client.searchReviewContacts(q);
      setRows(page.matches);
      if (page.matches.length === 0) setNotice("No one in the Hub matches that name.");
    } catch (caught) {
      setRows(null);
      setNotice(caught instanceof MissioApiError ? houseErrorCopy(caught) : "People didn’t load.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <form
      className={styles.form}
      data-testid="people-picker"
      onSubmit={(event) => {
        event.preventDefault();
        void search(draft);
      }}
    >
      <label className={shell.field} htmlFor={fieldId}>
        Name
        <input
          id={fieldId}
          name="q"
          placeholder="First or last name"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          autoComplete="off"
        />
      </label>
      <div className={styles.formActions}>
        <button type="submit" className={`${shell.ghost} ${styles.searchButton}`} disabled={searching || pending}>
          Search
        </button>
      </div>
      {notice ? (
        <p className={shell.help} role="status">
          {notice}
        </p>
      ) : null}
      {rows && rows.length > 0 ? (
        <ul className={styles.choices} data-testid="people-results">
          {rows.map((person) => (
            <li key={person.contactId}>
              <button
                type="button"
                className={`${shell.ghost} ${styles.choice}`}
                disabled={pending}
                onClick={() => onPick(person.contactId, person.displayName)}
              >
                <span className={styles.choiceText}>
                  <span className={styles.choiceName}>{person.displayName}</span>
                  <span className={styles.choiceMeta}>{matchMeta(person, person.inMissio)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
