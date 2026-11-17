"use client";

import { useState } from "react";
import {
  CAMPUS_LABEL,
  STATUS_LABEL,
  classifyContactQuery,
  validateNewPerson,
} from "./access";
import { MissioApiError, type MissioClient } from "./api";
import type {
  ContactMatch,
  CreateMissioPersonInput,
  MissioCampus,
  MissioStatus,
} from "./types-shim";
import styles from "./shell.module.css";

type Searched = { kind: "email" | "phone"; value: string };

export function AddPersonDialog({
  client,
  onClose,
  onCreated,
}: {
  client: MissioClient;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState<Searched | null>(null);
  const [matches, setMatches] = useState<ContactMatch[] | null>(null);
  const [step, setStep] = useState<"search" | "create">("search");
  const [notice, setNotice] = useState<{ tone: "alert" | "success"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [campus, setCampus] = useState<MissioCampus>("potch");
  const [status, setStatus] = useState<MissioStatus>("visitor");
  const [joinedAt, setJoinedAt] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  async function findContact(event: React.FormEvent) {
    event.preventDefault();
    setNotice(null);
    const kind = classifyContactQuery(query);
    if (kind === "empty" || kind === "name") {
      setMatches(null);
      setSearched(null);
      setNotice({
        tone: "alert",
        text: "Enter an email address or a phone number. A name isn’t accepted — Missio matches an existing contact exactly, and a name would be a guess.",
      });
      return;
    }
    setPending(true);
    try {
      const result = await client.searchContacts(query.trim());
      setSearched({ kind, value: query.trim() });
      setMatches(result.matches);
      if (result.matches.length === 0) {
        setNotice({ tone: "alert", text: "No contact uses that email or phone." });
      }
    } catch (error) {
      setMatches(null);
      const text =
        error instanceof MissioApiError
          ? error.message
          : "The contact search didn’t respond.";
      setNotice({ tone: "alert", text });
    } finally {
      setPending(false);
    }
  }

  function startCreate() {
    setStep("create");
    setNotice(null);
    if (searched?.kind === "email") setEmail(searched.value);
    if (searched?.kind === "phone") setPhone(searched.value);
  }

  async function submit(input: CreateMissioPersonInput) {
    setPending(true);
    setNotice(null);
    try {
      const result = await client.createPerson(input);
      setNotice({
        tone: "success",
        text: result.linkedExisting ? "Linked to an existing contact" : "Person added",
      });
      onCreated();
    } catch (error) {
      const conflict = error instanceof MissioApiError && error.status === 409;
      setNotice({
        tone: "alert",
        text: conflict ? "Already in Missio" : error instanceof Error ? error.message : "Couldn’t add this person.",
      });
    } finally {
      setPending(false);
    }
  }

  function linkContact(match: ContactMatch) {
    if (!searched || match.alreadyInOrg) return;
    const matchedBy = searched.kind === "email" ? { email: searched.value } : { phone: searched.value };
    const input: CreateMissioPersonInput = {
      contactId: match.contactId,
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
    <div className={styles.backdrop} role="presentation" onMouseDown={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-person-title"
        data-testid="add-person"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="add-person-title">Add person</h2>
        {notice ? (
          <p
            className={notice.tone === "success" ? styles.success : styles.alert}
            role={notice.tone === "success" ? "status" : "alert"}
            data-testid={notice.text === "Linked to an existing contact" ? "linked-existing" : notice.text === "Already in Missio" ? "create-conflict" : undefined}
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
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  autoComplete="off"
                  inputMode="email"
                  aria-label="Email or phone"
                />
              </label>
              <div className={styles.actions}>
                <button type="button" className={styles.ghost} onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className={styles.primary} disabled={pending}>
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
                  {matches.map((match) => (
                    <li key={match.contactId} className={styles.match}>
                      <div className={styles.matchBody}>
                        <div className={styles.matchName}>{match.name}</div>
                        <div className={styles.masked}>Email (masked) {match.maskedEmail ?? "—"}</div>
                        <div className={styles.masked}>Phone (masked) {match.maskedPhone ?? "—"}</div>
                        {match.alreadyInOrg ? (
                          <div className={styles.note} data-testid="already-in-org">
                            Already in Missio
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className={styles.primary}
                        disabled={match.alreadyInOrg || pending}
                        aria-label={`Use this contact, ${match.name}`}
                        onClick={() => linkContact(match)}
                      >
                        Use this contact
                      </button>
                    </li>
                  ))}
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
                <input value={email} onChange={(event) => setEmail(event.target.value)} aria-label="Email" />
              </label>
              <label className={styles.field}>
                Phone
                <input value={phone} onChange={(event) => setPhone(event.target.value)} aria-label="Phone" />
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
              <button type="submit" className={styles.primary} disabled={pending}>
                Create person
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
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
      </label>
    </div>
  );
}
