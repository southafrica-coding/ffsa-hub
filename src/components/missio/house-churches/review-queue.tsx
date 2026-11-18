"use client";

import { useState } from "react";
import { MissioApiError, missioClient, type MissioClient } from "../api";
import content from "../content.module.css";
import shell from "../shell.module.css";
import type { MissioPerson } from "../types-shim";
import { houseChurchesClient, houseErrorCopy, type HouseChurchesClient } from "./client";
import { candidateContext, houseTitle, reviewReasons, ROLE_LABEL } from "./format";
import { useMissioLoad } from "./load";
import { PeoplePicker } from "./people-picker";
import { AllHousesLink } from "./present";
import { accessStatus, HouseStatus } from "./status";
import type { ResolveBody, ReviewItem } from "./types";
import styles from "./house-churches.module.css";

export function ReviewQueue({
  client = houseChurchesClient,
  people = missioClient,
}: {
  client?: HouseChurchesClient;
  people?: Pick<MissioClient, "listPeople">;
}) {
  const { state, retry } = useMissioLoad(() => client.listReview(), [client]);
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [skipNote, setSkipNote] = useState("");

  const items = state.phase === "ready" ? state.data.items : [];
  const total = items.length;
  const item = !finished && index < total ? items[index] : null;

  function resetFields() {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setSkipNote("");
    setNotice(null);
  }

  function advance(count: number) {
    const next = index + 1;
    resetFields();
    setIndex(next);
    if (next >= count) setFinished(true);
  }

  async function resolve(body: ResolveBody, count: number) {
    if (!item) return;
    setPending(true);
    setNotice(null);
    try {
      await client.resolveReview(item.id, body);
      advance(count);
    } catch (caught) {
      if (caught instanceof MissioApiError && caught.code === "already_resolved") {
        advance(count);
        return;
      }
      setNotice(
        caught instanceof MissioApiError ? houseErrorCopy(caught, "That didn’t save. Try again.") : "That didn’t save. Try again."
      );
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
      <p className={`${shell.lede} ${content.lede}`}>
        Match each imported name to a person, create them, or skip. Linking or creating adds them to the house.
      </p>

      {state.phase === "loading" ? (
        <div className={shell.state} data-state="loading" role="status">
          Loading names to review…
        </div>
      ) : null}
      {state.phase === "error" ? (
        <HouseStatus error={state.error} fallback="Names to review didn’t load." onRetry={retry} />
      ) : null}
      {state.phase === "ready" && total === 0 ? (
        <div className={shell.state} data-state="empty" data-testid="review-empty">
          No imported names are waiting.
        </div>
      ) : null}
      {state.phase === "ready" && finished ? (
        <div className={shell.state} data-state="done" data-testid="review-done">
          {total === 1 ? "That name is resolved." : total === 2 ? "Both names are resolved." : `All ${total} names are resolved.`}
        </div>
      ) : null}
      {item ? (
        <ReviewCard
          key={item.id}
          item={item}
          pending={pending}
          notice={notice}
          people={people}
          firstName={firstName}
          lastName={lastName}
          email={email}
          phone={phone}
          skipNote={skipNote}
          onFirstName={setFirstName}
          onLastName={setLastName}
          onEmail={setEmail}
          onPhone={setPhone}
          onSkipNote={setSkipNote}
          onLink={(contactId) => void resolve({ action: "link", contactId }, total)}
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
              total
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

function ReviewCard({
  item,
  pending,
  notice,
  people,
  firstName,
  lastName,
  email,
  phone,
  skipNote,
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
  notice: string | null;
  people: Pick<MissioClient, "listPeople">;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  skipNote: string;
  onFirstName: (value: string) => void;
  onLastName: (value: string) => void;
  onEmail: (value: string) => void;
  onPhone: (value: string) => void;
  onSkipNote: (value: string) => void;
  onLink: (contactId: string) => void;
  onCreate: () => void;
  onSkip: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const houseLabel = item.house ? houseTitle(item.house) : `House ${item.houseNumber}`;
  const showName = item.sourceLine.trim() !== item.rawName.trim();
  const reasons = reviewReasons(item);

  return (
    <article data-testid="review-item">
      <section className={styles.summary} data-testid="review-summary">
        <p className={`${shell.eyebrow} ${content.eyebrow}`}>Original line</p>
        <p className={styles.quoteBox}>{item.sourceLine}</p>
        {showName ? <h2>{item.rawName}</h2> : null}
        <p className={styles.line}>{houseLabel}</p>
        {item.house && item.house.name?.trim() ? <p className={styles.number}>House {item.house.number}</p> : null}
        {item.role ? <p className={styles.line}>Role: {ROLE_LABEL[item.role]}</p> : null}
        <ul className={styles.reasons}>
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        {item.notes?.trim() ? <p className={styles.line}>Note: {item.notes.trim()}</p> : null}
      </section>
      {notice ? (
        <p className={shell.alert} role="alert">
          {notice}
        </p>
      ) : null}

      {item.candidates.length > 0 ? (
        <section className={styles.section}>
          <h2>Possible matches</h2>
          <ul className={styles.choices} data-testid="review-candidates">
            {item.candidates.map((candidate) => {
              const context = candidateContext(candidate);
              return (
                <li key={candidate.contactId}>
                  <button
                    type="button"
                    className={`${shell.ghost} ${styles.choice}`}
                    disabled={pending}
                    onClick={() => onLink(candidate.contactId)}
                  >
                    <span className={styles.choiceBody}>
                      <span>Use {candidate.displayName}</span>
                      {context ? <span className={styles.choiceMeta}>{context}</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className={styles.section}>
        <h2>Search people</h2>
        <PeoplePicker
          people={people}
          pending={pending}
          label="Search people"
          showLabel={false}
          onPick={(person: MissioPerson) => onLink(person.contactId)}
        />
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
    </article>
  );
}
