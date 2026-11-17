"use client";

import { useEffect, useState } from "react";
import {
  CAMPUS_LABEL,
  STATUS_LABEL,
  classifyContactQuery,
  formatJoined,
  validateNewPerson,
} from "./access";
import {
  MissioApiError,
  EXISTS_USE_SEARCH_MESSAGE,
  capRetryAfterSeconds,
  missioErrorCopy,
  type MissioClient,
} from "./api";
import { MissioDialog } from "./missio-dialog";
import type {
  ContactMatch,
  CreateMissioPersonInput,
  MissioCampus,
  MissioStatus,
} from "./types-shim";
import styles from "./shell.module.css";

type Searched = { kind: "email" | "phone"; value: string };
type Notice = { tone: "alert" | "success" | "info"; text: string };

const EXISTS_NOTICE: Notice = { tone: "info", text: EXISTS_USE_SEARCH_MESSAGE };

export function AddPersonDialog({
  client,
  onClose,
  onCreated,
  onViewPerson,
}: {
  client: MissioClient;
  onClose: () => void;
  onCreated: () => void;
  onViewPerson?: (personId: string, name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState<Searched | null>(null);
  const [matches, setMatches] = useState<ContactMatch[] | null>(null);
  const [step, setStep] = useState<"search" | "create">("search");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState(false);
  const [campus, setCampus] = useState<MissioCampus>("potch");
  const [status, setStatus] = useState<MissioStatus>("visitor");
  const [joinedAt, setJoinedAt] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [lockedUntil, setLockedUntil] = useState(0);
  const [submitLockedUntil, setSubmitLockedUntil] = useState(0);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const until = Math.max(lockedUntil, submitLockedUntil);
    if (until <= Date.now()) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= until) window.clearInterval(timer);
    }, 500);
    return () => window.clearInterval(timer);
  }, [lockedUntil, submitLockedUntil]);

  const searchLocked = lockedUntil > clock;
  const submitLocked = submitLockedUntil > clock;

  async function runSearch(raw: string, keep?: string) {
    if (lockedUntil > Date.now()) return;
    const value = raw.trim();
    const kind = classifyContactQuery(value);
    if (kind === "empty" || kind === "name") {
      setMatches(null);
      setSearched(null);
      setStep("search");
      setQuery(value);
      setNotice({
        tone: "alert",
        text: "Enter an email address or a phone number. A name isn’t accepted — Missio matches an existing contact exactly, and a name would be a guess.",
      });
      return;
    }
    setPending(true);
    setQuery(value);
    setStep("search");
    setNotice(keep ? { tone: "alert", text: keep } : null);
    try {
      const result = await client.searchContacts(value);
      setSearched({ kind, value });
      setMatches(result.matches);
      if (keep) setNotice({ tone: "alert", text: keep });
      else if (result.matches.length === 0) setNotice({ tone: "alert", text: "No contact uses that email or phone." });
      else setNotice(null);
    } catch (error) {
      setMatches(null);
      if (error instanceof MissioApiError && error.code === "rate_limited") {
        const seconds = capRetryAfterSeconds(error.retryAfterSeconds);
        setLockedUntil(Date.now() + seconds * 1000);
        setNotice({ tone: "alert", text: missioErrorCopy(error, "search") });
      } else {
        const text = error instanceof MissioApiError ? missioErrorCopy(error, "search") : "The contact search didn’t respond.";
        setNotice({ tone: "alert", text });
      }
    } finally {
      setPending(false);
    }
  }

  function findContact(event: React.FormEvent) {
    event.preventDefault();
    void runSearch(query);
  }

  function startCreate() {
    setStep("create");
    setNotice(null);
    if (searched?.kind === "email") setEmail(searched.value);
    if (searched?.kind === "phone") setPhone(searched.value);
  }

  /**
   * A create 409 means one of the typed identifiers already exists.
   * Search the email first. Only when that comes back empty, search the phone.
   * The field and the later link both use the identifier that produced the hit.
   * pending stays true until this finishes.
   */
  async function revealExisting(emailRaw: string, phoneRaw: string) {
    setStep("search");
    setNotice(EXISTS_NOTICE);
    const candidates: Searched[] = [];
    const emailValue = emailRaw.trim();
    const phoneValue = phoneRaw.trim();
    if (classifyContactQuery(emailValue) === "email") candidates.push({ kind: "email", value: emailValue });
    if (classifyContactQuery(phoneValue) === "phone") candidates.push({ kind: "phone", value: phoneValue });
    if (candidates.length === 0) {
      setMatches(null);
      setSearched(null);
      setPending(false);
      return;
    }
    setQuery(candidates[0].value);
    try {
      for (const candidate of candidates) {
        const result = await client.searchContacts(candidate.value);
        if (result.matches.length === 0) continue;
        setQuery(candidate.value);
        setSearched(candidate);
        setMatches(result.matches);
        setNotice(EXISTS_NOTICE);
        return;
      }
      setQuery(candidates[0].value);
      setSearched(null);
      setMatches([]);
      setNotice(EXISTS_NOTICE);
    } catch (error) {
      setMatches(null);
      setSearched(null);
      if (error instanceof MissioApiError && error.code === "rate_limited") {
        const seconds = capRetryAfterSeconds(error.retryAfterSeconds);
        setLockedUntil(Date.now() + seconds * 1000);
        setNotice({ tone: "alert", text: missioErrorCopy(error, "search") });
      } else {
        const text = error instanceof MissioApiError ? missioErrorCopy(error, "search") : "The contact search didn’t respond.";
        setNotice({ tone: "alert", text });
      }
    } finally {
      setPending(false);
    }
  }

  async function submit(input: CreateMissioPersonInput) {
    if (submitLocked) return;
    setPending(true);
    setNotice(null);
    const linking = "matchToken" in input;
    let handedOff = false;
    try {
      const result = await client.createPerson(input);
      setNotice({
        tone: "success",
        text: linking && result.linkedExisting ? "Linked to an existing contact" : "Person added",
      });
      onCreated();
    } catch (error) {
      if (!(error instanceof MissioApiError)) {
        setNotice({ tone: "alert", text: "Couldn’t add this person." });
        return;
      }
      if (error.code === "invalid_token") {
        setStep("search");
        setMatches(null);
        setSearched(null);
        setNotice({ tone: "alert", text: missioErrorCopy(error, "submit") });
        return;
      }
      if (error.code === "rate_limited") {
        const seconds = capRetryAfterSeconds(error.retryAfterSeconds);
        const until = Date.now() + seconds * 1000;
        setSubmitLockedUntil(until);
        setNotice({ tone: "alert", text: missioErrorCopy(error, "submit") });
        return;
      }
      if (error.code === "exists_use_search" && !linking) {
        handedOff = true;
        await revealExisting(email, phone);
        return;
      }
      if (error.code === "already_in_org") {
        setNotice({ tone: "alert", text: "Already in Missio" });
        return;
      }
      setNotice({ tone: "alert", text: missioErrorCopy(error, "submit") });
    } finally {
      if (!handedOff) setPending(false);
    }
  }

  function linkContact(match: ContactMatch) {
    if (!searched || match.alreadyInOrg) return;
    const matchedBy = searched.kind === "email" ? { email: searched.value } : { phone: searched.value };
    const input: CreateMissioPersonInput = {
      matchToken: match.matchToken,
      matchedBy,
      campus,
      status,
      ...(joinedAt ? { joinedAt } : {}),
    };
    void submit(input);
  }

  function createNew(event: React.FormEvent) {
    event.preventDefault();
    const problem = validateNewPerson({ name, email, phone });
    if (problem) {
      setNotice({ tone: "alert", text: problem });
      return;
    }
    const input: CreateMissioPersonInput = {
      name: name.trim(),
      campus,
      status,
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(joinedAt ? { joinedAt } : {}),
    };
    void submit(input);
  }

  return (
    <MissioDialog onClose={onClose} title="Add person" testId="add-person">
        {notice ? (
          <p
            className={notice.tone === "success" ? styles.success : notice.tone === "info" ? styles.info : styles.alert}
            role={notice.tone === "alert" ? "alert" : "status"}
            data-testid={
              notice.tone === "info"
                ? "exists-use-search"
                : notice.text === "Linked to an existing contact"
                  ? "linked-existing"
                  : notice.text === "That match expired, search again"
                    ? "match-expired"
                    : notice.text.startsWith("Too many searches")
                      ? "search-rate-limit"
                      : notice.text.startsWith("Too many attempts")
                        ? "submit-rate-limit"
                        : undefined
            }
          >
            {notice.text}
          </p>
        ) : (
          <p className={styles.help}>
            Search an existing contact by email or phone first. A name isn’t accepted on this step.
          </p>
        )}

        {step === "search" ? (
          <>
            <form onSubmit={findContact} className={styles.fields}>
              <label className={styles.field}>
                Email or phone
                <input
                  disabled={searchLocked}
                  type="text"
                  autoComplete="off"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Email or phone"
                />
              </label>
              <div className={styles.actions}>
                <button type="button" className={styles.ghost} onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className={styles.primary} disabled={pending || searchLocked}>
                  Find contact
                </button>
              </div>
            </form>
            {matches && matches.length > 0 ? (
              <div>
                <CampusFields
                  campus={campus}
                  status={status}
                  joinedAt={joinedAt}
                  onCampus={setCampus}
                  onStatus={setStatus}
                  onJoined={setJoinedAt}
                />
                <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0 }}>
                  {matches.map((match) => {
                    const label = match.alreadyInOrg && match.name ? match.name : null;
                    return (
                    <li key={match.matchToken} className={styles.match}>
                      <div className={styles.matchBody}>
                        {label ? <div className={styles.matchName}>{label}</div> : null}
                        <div className={styles.masked}>Name (masked) {match.maskedName}</div>
                        <div className={styles.masked}>Email (masked) {match.maskedEmail ?? "—"}</div>
                        <div className={styles.masked}>Phone (masked) {match.maskedPhone ?? "—"}</div>
                        {match.alreadyInOrg ? (
                          <div className={styles.note} data-testid="already-in-org">
                            Already in Missio
                            {match.personId ? (
                              <>
                                {" "}
                                <button
                                  type="button"
                                  className={styles.textButton}
                                  onClick={() => onViewPerson?.(match.personId as string, match.name ?? match.maskedName)}
                                >
                                  Open their record
                                </button>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className={styles.primary}
                        disabled={match.alreadyInOrg || pending || submitLocked}
                        aria-label={`Use this contact, ${label ?? match.maskedName}`}
                        onClick={() => linkContact(match)}
                      >
                        Use this contact
                      </button>
                    </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {matches && matches.length === 0 ? (
              <div className={styles.actions}>
                <button type="button" className={styles.primary} onClick={startCreate}>
                  Create new person
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <form onSubmit={createNew} className={styles.fields} data-testid="create-person-form">
            <label className={styles.field}>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Name" />
            </label>
            <div className={styles.row2}>
              <label className={styles.field}>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-label="Email"
                />
              </label>
              <label className={styles.field}>
                Phone
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  aria-label="Phone"
                />
              </label>
            </div>
            <CampusFields
              campus={campus}
              status={status}
              joinedAt={joinedAt}
              onCampus={setCampus}
              onStatus={setStatus}
              onJoined={setJoinedAt}
            />
            <div className={styles.actions}>
              <button type="button" className={styles.ghost} onClick={() => setStep("search")}>
                Back
              </button>
              <button type="submit" className={styles.primary} disabled={pending || submitLocked}>
                Create person
              </button>
            </div>
          </form>
        )}
    </MissioDialog>
  );
}

function CampusFields({
  campus,
  status,
  joinedAt,
  onCampus,
  onStatus,
  onJoined,
}: {
  campus: MissioCampus;
  status: MissioStatus;
  joinedAt: string;
  onCampus: (value: MissioCampus) => void;
  onStatus: (value: MissioStatus) => void;
  onJoined: (value: string) => void;
}) {
  return (
    <div className={styles.row2} style={{ marginTop: 12 }}>
      <label className={styles.field}>
        Campus
        <select aria-label="Campus for new person" value={campus} onChange={(event) => onCampus(event.target.value as MissioCampus)}>
          {(Object.keys(CAMPUS_LABEL) as MissioCampus[]).map((value) => (
            <option key={value} value={value}>
              {CAMPUS_LABEL[value]}
              {value === "potch" ? " (main)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        Status
        <select aria-label="Status for new person" value={status} onChange={(event) => onStatus(event.target.value as MissioStatus)}>
          {(Object.keys(STATUS_LABEL) as MissioStatus[]).map((value) => (
            <option key={value} value={value}>
              {STATUS_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field} style={{ gridColumn: "1 / -1" }}>
        Joined
        <input aria-label="Joined date" type="date" value={joinedAt} onChange={(event) => onJoined(event.target.value)} />
        {joinedAt ? <span className={styles.dateReadout}>{formatJoined(joinedAt)}</span> : null}
      </label>
    </div>
  );
}
