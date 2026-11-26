"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MissioApiError } from "../api";
import content from "../content.module.css";
import { houseChurchesClient, houseErrorCopy, houseErrorMatches, type HouseChurchesClient } from "./client";
import Link from "next/link";
import { initialsOf, reviewReasons, ROLE_LABEL } from "./format";
import { useMissioLoad } from "./load";
import { accessStatus, HouseStatus } from "./status";
import type { PersonRef, ResolveBody, ReviewContactMatch, ReviewItem } from "./types";
import styles from "./house-churches.module.css";
import rv from "./review.module.css";
import ui from "./ui.module.css";

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
  // Who a refused "create" collided with, so they can be linked in one tap.
  const [existing, setExisting] = useState<ReviewContactMatch[]>([]);
  // Set when a name-only create met a contact with the same name. Holds the
  // create to send again if the pastor says it is a different person.
  const [sameName, setSameName] = useState<Extract<ResolveBody, { action: "create" }> | null>(null);
  const focusTarget = useRef<"item" | "done" | "next" | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state.phase === "ready") setQueue(state.data.items);
  }, [state]);

  const items = queue ?? (state.phase === "ready" ? state.data.items : []);
  const total = items.length;
  const typedName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
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
    setExisting([]);
    setSameName(null);
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
    setExisting([]);
    setSameName(null);
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
      const matches = body.action === "create" ? houseErrorMatches(caught) : [];
      if (matches.length > 0) {
        setExisting(matches);
        if (body.action === "create" && !body.email && !body.phone) {
          setSameName(body);
          setNotice("Someone with that name is already in the Hub, so no new person was made yet. Is this them?");
          return;
        }
        setNotice(
          matches.length === 1
            ? "That email or phone already belongs to someone in the Hub, so no new person was made. Is this them?"
            : "That email or phone already belongs to people in the Hub, so no new person was made. Is it one of them?"
        );
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

  const shown = finished ? total : Math.min(index, total);
  const percent = total > 0 ? Math.round((shown / total) * 100) : 0;

  return (
    <div className={`${ui.root} ${rv.page}`}>
      <div className={rv.top}>
        <Link href="/missio/house-churches" className={`${ui.btn} ${ui.g} ${ui.ic} ${rv.close}`} aria-label="Close review">
          <CloseIcon />
        </Link>
        <h1 className={rv.title}>{finished ? "All sorted" : "Review names"}</h1>
      </div>
      {total > 0 ? (
        <div className={rv.progressRow}>
          <div
            className={rv.track}
            role="progressbar"
            aria-label="Names reviewed"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={shown}
          >
            <div className={rv.fill} style={{ width: `${percent}%` }} />
          </div>
          {item ? (
            <span className={`${ui.mono} ${rv.count}`} data-testid="review-progress">
              {index + 1} of {total}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className={rv.body}>
        {!queue && state.phase === "loading" ? (
          <div className={`${ui.card} ${rv.state}`} data-state="loading" role="status">
            Loading names to review…
          </div>
        ) : null}
        {state.phase === "error" ? (
          <HouseStatus error={state.error} fallback="Names to review didn’t load." onRetry={retry} />
        ) : null}
        {state.phase === "ready" && total === 0 && !finished ? (
          <div className={`${ui.card} ${rv.state}`} data-state="empty" data-testid="review-empty">
            No imported names are waiting.
          </div>
        ) : null}
        {notice ? (
          <p ref={noticeRef} id="review-action-error" className={rv.alert} role="alert" tabIndex={-1}>
            {notice}
          </p>
        ) : null}
        {item && existing.length > 0 ? (
          <section className={rv.existing} data-testid="review-existing">
            <div className={`${ui.card} ${rv.list}`}>
              {existing.map((person) => (
                <div key={person.contactId}>
                  <button
                    type="button"
                    className={`${rv.row}`}
                    disabled={pending}
                    onClick={() => void resolve({ action: "link", contactId: person.contactId }, total, person.displayName)}
                  >
                    <Avatar id={person.contactId} name={person.displayName} />
                    <span className={rv.rowText}>
                      <span className={ui.nm}>Link {person.displayName}</span>
                      <span className={ui.meta}>{matchMeta(person, person.inMissio)}</span>
                    </span>
                  </button>
                  {typedName && typedName.toLowerCase() !== person.displayName.trim().toLowerCase() ? (
                    <button
                      type="button"
                      className={`${rv.row}`}
                      disabled={pending}
                      data-testid="review-link-rename"
                      onClick={() =>
                        void resolve(
                          {
                            action: "link",
                            contactId: person.contactId,
                            rename: { firstName: firstName.trim(), ...(lastName.trim() ? { lastName: lastName.trim() } : {}) },
                          },
                          total,
                          typedName
                        )
                      }
                    >
                      <span className={rv.rowText}>
                        <span className={ui.nm}>Link and rename to {typedName}</span>
                        <span className={ui.meta}>Same person, wrong name on file. Changes their name everywhere in the Hub.</span>
                      </span>
                    </button>
                  ) : null}
                </div>
              ))}
              {sameName ? (
                <button
                  type="button"
                  className={`${rv.row}`}
                  disabled={pending}
                  data-testid="review-create-anyway"
                  onClick={() => void resolve({ ...sameName, allowDuplicate: true }, total, typedName)}
                >
                  <span className={rv.rowText}>
                    <span className={ui.nm}>No, create a new {typedName}</span>
                    <span className={ui.meta}>A different person who happens to share the name.</span>
                  </span>
                </button>
              ) : null}
            </div>
            {sameName ? null : (
              <p className={`${ui.help} ${rv.centre}`}>
                Someone else entirely? Two people can’t share an email or phone in the Hub. Create the new person with
                their own number or email instead.
              </p>
            )}
          </section>
        ) : null}
        {state.phase === "ready" && finished ? (
          <div className={rv.done}>
            <h2 id="review-done-heading" tabIndex={-1} className={`${ui.serif} ${rv.doneTitle}`} data-testid="review-done">
              {doneHeading(total)}
            </h2>
            <Link href="/missio/house-churches" className={`${ui.btn} ${ui.p}`}>
              Back to the map
            </Link>
          </div>
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
              if (!family && !mail && !number) {
                setNotice("Add a last name, or an email or phone number.");
                return;
              }
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
    </div>
  );
}

const TINTS = ["a1", "a2", "a3", "a4", "a5"] as const;

/** Avatar tint by person id (M1b: five tints), so a person keeps their colour everywhere. */
function Avatar({ id, name }: { id: string; name: string }) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const tint = TINTS[hash % TINTS.length];
  return (
    <span className={`${ui.av} ${ui[tint]}`} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
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
  const [panel, setPanel] = useState<"search" | "create" | null>(null);
  const houseNumber = item.house?.number ?? item.houseNumber;
  const houseName = item.house?.name?.trim() ?? "";
  const housePlace = item.role ? `House ${houseNumber} · ${ROLE_LABEL[item.role]}` : `House ${houseNumber}`;
  const reasons = reviewReasons(item);
  const note = item.notes?.trim() ?? "";
  const source = item.sourceLine == null ? `From the House ${houseNumber} list` : `From the House ${houseNumber} list · line ${item.sourceLine}`;
  const toggle = (next: "search" | "create") => setPanel((open) => (open === next ? null : next));

  return (
    <article className={rv.item} data-testid="review-item">
      <section className={`${ui.card} ${rv.nameCard}`} data-testid="review-summary">
        <p className={rv.source}>{source}</p>
        <h2 id="review-item-heading" tabIndex={-1} className={`${ui.serif} ${rv.name}`}>
          “{item.rawName}”
        </h2>
        <p className={rv.facts}>
          {[housePlace, houseName, ...reasons].filter(Boolean).join(" · ")}
        </p>
        {note ? <p className={rv.note}>{note}</p> : null}
      </section>

      {added.length > 0 ? (
        <section className={`${ui.card} ${rv.added}`} data-testid="review-added" aria-live="polite">
          <h2 className={rv.addedTitle}>Added to House {houseNumber}</h2>
          <ul className={rv.addedList}>
            {added.map((name, at) => (
              <li key={`${name}-${at}`}>{name}</li>
            ))}
          </ul>
          <p className={ui.help}>Is this name a couple or a household? Add the next person below.</p>
          <button id="review-next" type="button" className={`${ui.btn} ${ui.p}`} disabled={pending} onClick={onNext}>
            {last ? "Done" : "Next name"}
          </button>
        </section>
      ) : null}

      {item.candidates.length > 0 ? (
        <section className={rv.section}>
          <h3 className={`${ui.sect} ${rv.sectLabel}`}>{added.length > 0 ? "Add another? Is this…" : "Is this…"}</h3>
          <div className={`${ui.card} ${rv.list}`} data-testid="review-candidates">
            {item.candidates.map((candidate, at) => {
              const best = at === 0;
              return (
                <button
                  key={candidate.contactId}
                  type="button"
                  className={`${rv.row} ${best ? rv.best : ""}`}
                  disabled={pending}
                  onClick={() => onLink(candidate.contactId, candidate.displayName)}
                >
                  <Avatar id={candidate.contactId} name={candidate.displayName} />
                  <span className={rv.rowText}>
                    <span className={ui.nm}>
                      <span className={ui.visuallyHidden}>Use </span>
                      {candidate.displayName}
                    </span>
                    <span className={ui.meta}>{matchMeta(candidate, candidate.orgPersonId != null)}</span>
                  </span>
                  <span className={`${ui.btn} ${ui.sm} ${best ? ui.p : ui.s}`} aria-hidden="true">
                    Link
                  </span>
                </button>
              );
            })}
          </div>
          {item.candidates.length === 1 ? <p className={`${ui.help} ${rv.centre}`}>Only one likely match.</p> : null}
        </section>
      ) : (
        <p className={`${ui.help} ${rv.centre}`}>No likely match. Search everyone, or add them as someone new.</p>
      )}

      <section className={rv.section} hidden={panel !== "search"} data-testid="review-search-panel">
        <h3 className={`${ui.serif} ${rv.panelTitle}`}>Find “{item.rawName}”</h3>
        <p className={ui.help}>Looks through every contact in the Hub, not only Missio. Linking someone adds them to Missio.</p>
        <ContactSearch client={client} pending={pending} onPick={onLink} />
      </section>

      {panel === "create" ? (
        <form
          className={`${ui.card} ${rv.form}`}
          data-testid="review-create"
          onSubmit={(event) => {
            event.preventDefault();
            onCreate();
          }}
        >
          <h3 className={`${ui.serif} ${rv.panelTitle}`}>Someone new</h3>
          <p className={ui.help}>Email and phone are optional. Add them if you have them.</p>
          <label className={ui.field}>
            First name
            <input className={ui.input} aria-label="First name" value={firstName} onChange={(event) => onFirstName(event.target.value)} />
          </label>
          <label className={ui.field}>
            Last name
            <input className={ui.input} aria-label="Last name" value={lastName} onChange={(event) => onLastName(event.target.value)} />
          </label>
          <label className={ui.field}>
            Email
            <input
              className={ui.input}
              aria-label="Email"
              inputMode="email"
              autoComplete="off"
              value={email}
              onChange={(event) => onEmail(event.target.value)}
            />
          </label>
          <label className={ui.field}>
            Phone
            <input
              className={ui.input}
              aria-label="Phone"
              inputMode="tel"
              autoComplete="off"
              value={phone}
              onChange={(event) => onPhone(event.target.value)}
            />
          </label>
          <button type="submit" className={`${ui.btn} ${ui.p}`} disabled={pending}>
            Create person
          </button>
        </form>
      ) : null}

      {/* The actions sit at the bottom, under the thumb (M4c). */}
      <form
        className={rv.bar}
        data-testid={added.length > 0 ? undefined : "review-skip"}
        onSubmit={(event) => {
          event.preventDefault();
          if (added.length === 0) onSkip();
        }}
      >
        {added.length > 0 ? null : (
          <details className={rv.skipNote}>
            <summary>Add a note before skipping</summary>
            <textarea
              className={ui.input}
              aria-label="Skip note"
              value={skipNote}
              onChange={(event) => onSkipNote(event.target.value)}
            />
          </details>
        )}
        <div className={rv.barButtons}>
          <button
            type="button"
            className={`${ui.btn} ${ui.s} ${rv.barButton}`}
            aria-expanded={panel === "search"}
            data-testid="search-toggle"
            onClick={() => toggle("search")}
          >
            <SearchIcon />
            Search
          </button>
          <button
            type="button"
            className={`${ui.btn} ${ui.s} ${rv.barButton}`}
            aria-expanded={panel === "create"}
            data-testid="create-toggle"
            onClick={() => toggle("create")}
          >
            <PlusIcon />
            New
          </button>
          {added.length > 0 ? null : (
            <button type="submit" className={`${ui.btn} ${ui.g} ${rv.barButton} ${rv.skip}`} disabled={pending}>
              Skip
            </button>
          )}
        </div>
      </form>
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
      className={rv.searchForm}
      data-testid="people-picker"
      onSubmit={(event) => {
        event.preventDefault();
        void search(draft);
      }}
    >
      <div className={rv.searchRow}>
        <label className={ui.visuallyHidden} htmlFor={fieldId}>
          Name
        </label>
        <input
          id={fieldId}
          name="q"
          className={ui.input}
          placeholder="First or last name"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          autoComplete="off"
        />
        <button type="submit" className={`${ui.btn} ${ui.s}`} disabled={searching || pending}>
          Search
        </button>
      </div>
      {notice ? (
        <p className={ui.help} role="status">
          {notice}
        </p>
      ) : null}
      {rows && rows.length > 0 ? (
        <div className={`${ui.card} ${rv.list}`} data-testid="people-results">
          {rows.map((person) => (
            <button
              key={person.contactId}
              type="button"
              className={`${rv.row}`}
              disabled={pending}
              onClick={() => onPick(person.contactId, person.displayName)}
            >
              <Avatar id={person.contactId} name={person.displayName} />
              <span className={rv.rowText}>
                <span className={ui.nm}>{person.displayName}</span>
                <span className={ui.meta}>{matchMeta(person, person.inMissio)}</span>
              </span>
              <span className={`${ui.btn} ${ui.sm} ${ui.s}`} aria-hidden="true">
                Link
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </form>
  );
}
