"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CAMPUS_LABEL,
  DEFAULT_PEOPLE_LIMIT,
  STATUS_LABEL,
  formatJoined,
  type PeopleQuery,
} from "./access";
import { MissioApiError, missioClient, missioErrorCopy, type MissioClient } from "./api";
import { AddPersonDialog } from "./add-person";
import { MissioDialog } from "./missio-dialog";
import type { MissioCampus, MissioPerson, MissioStatus } from "./types-shim";
import content from "./content.module.css";
import styles from "./shell.module.css";

type ListState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; rows: MissioPerson[]; total: number };

export function PeopleDirectory({ client = missioClient }: { client?: MissioClient }) {
  const params = useSearchParams();
  const [campus, setCampus] = useState<"" | MissioCampus>("");
  const [status, setStatus] = useState<"" | MissioStatus>("");
  const [draft, setDraft] = useState(() => params.get("q") ?? "");
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(0);
  const [list, setList] = useState<ListState>({ phase: "loading" });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MissioPerson | null>(null);
  const [focusPersonId, setFocusPersonId] = useState<string | null>(null);

  const query = useMemo<PeopleQuery>(
    () => ({ campus, status, q, limit: DEFAULT_PEOPLE_LIMIT, offset }),
    [campus, status, q, offset]
  );

  useEffect(() => {
    let active = true;
    setList({ phase: "loading" });
    client.listPeople(query).then(
      (page) => {
        if (active) setList({ phase: "ready", rows: page.rows, total: page.total });
      },
      (error: unknown) => {
        if (!active) return;
        const message = error instanceof MissioApiError ? error.message : "People didn’t load.";
        setList({ phase: "error", message });
      }
    );
    return () => {
      active = false;
    };
  }, [client, query, tick]);

  useEffect(() => {
    if (!focusPersonId || list.phase !== "ready") return;
    const row = list.rows.find((person) => person.id === focusPersonId);
    if (!row) return;
    setEditing(row);
    setFocusPersonId(null);
  }, [focusPersonId, list]);

  const total = list.phase === "ready" ? list.total : 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + DEFAULT_PEOPLE_LIMIT, total);

  return (
    <div className={content.page}>
      <div className={styles.headRow}>
        <div>
          <p className={`${styles.eyebrow} ${content.eyebrow}`}>Missio people</p>
          <h1 className={content.title}>People</h1>
          <p className={`${styles.lede} ${content.lede}`}>Mark someone inactive to close the record.</p>
        </div>
        <button type="button" className={styles.primary} onClick={() => setAdding(true)}>
          Add person
        </button>
      </div>

      <form
        className={`${styles.toolbar} ${content.toolbar}`}
        data-testid="people-search"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setOffset(0);
          setQ(String(data.get("q") ?? "").trim());
        }}
      >
        <label className={styles.filter}>
          <span className={styles.filterLabel} id="missio-campus-label">Campus</span>
          <select
            id="missio-campus"
            aria-labelledby="missio-campus-label"
            aria-label="Campus"
            className={styles.select}
            value={campus}
            onChange={(event) => {
              setCampus(event.target.value as "" | MissioCampus);
              setOffset(0);
            }}
          >
            <option value="">All campuses</option>
            <option value="potch">Missio Potch</option>
            <option value="jhb">Missio JHB</option>
          </select>
        </label>
        <label className={styles.filter}>
          <span className={styles.filterLabel} id="missio-status-label">Status</span>
          <select
            id="missio-status"
            aria-labelledby="missio-status-label"
            aria-label="Status"
            className={styles.select}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as "" | MissioStatus);
              setOffset(0);
            }}
          >
            <option value="">All statuses</option>
            <option value="visitor">Visitor</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <input
          className={styles.textInput}
          name="q"
          aria-label="Search names"
          placeholder="Search by name"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className={styles.ghost}>
          Search
        </button>
      </form>

      <div className={styles.tableCard}>
        {list.phase === "loading" ? (
          <div className={styles.state} data-state="loading" role="status">
            Loading people…
          </div>
        ) : null}
        {list.phase === "error" ? (
          <div className={styles.state} data-state="error" role="alert">
            <p>{list.message}</p>
            <button type="button" className={styles.ghost} onClick={() => setTick((n) => n + 1)}>
              Try again
            </button>
          </div>
        ) : null}
        {list.phase === "ready" && list.rows.length === 0 ? (
          <div className={styles.state} data-state="empty">
            {q || campus || status ? "No one matches those filters." : "No Missio people yet."}
          </div>
        ) : null}
        {list.phase === "ready" && list.rows.length > 0 ? (
          <>
            <ul className={styles.peopleCards} data-testid="people-cards">
              {list.rows.map((person) => (
                <li key={person.id} className={styles.personCard}>
                  <div className={styles.personCardTop}>
                    <span className={styles.personName}>{person.name}</span>
                    <span className={`${styles.badge} ${badgeClass(person.status)}`} data-status={person.status}>
                      {STATUS_LABEL[person.status]}
                    </span>
                  </div>
                  <div className={styles.personCardMeta}>
                    <span className={styles.campus}>{CAMPUS_LABEL[person.campus]}</span>
                    {person.campus === "potch" ? <span className={styles.campusMain}>Main</span> : null}
                  </div>
                  {personStage(person) || personJoined(person) ? (
                    <div className={styles.muted}>
                      {personStage(person) ? <span>{personStage(person)}</span> : null}
                      {personJoined(person) ? <span className={styles.joined}>Joined {personJoined(person)}</span> : null}
                    </div>
                  ) : null}
                  <button type="button" className={styles.textButton} aria-label={`Edit ${person.name}`} onClick={() => setEditing(person)}>
                    Edit
                  </button>
                </li>
              ))}
            </ul>
            <table className={`${styles.table} ${content.table}`} data-testid="people-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Campus</th>
                <th>Status</th>
                <th>Stage</th>
                <th>Joined</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.rows.map((person) => (
                <tr key={person.id}>
                  <td className={styles.personName}>{person.name}</td>
                  <td>
                    <span className={styles.campus}>{CAMPUS_LABEL[person.campus]}</span>
                    {person.campus === "potch" ? <span className={styles.campusMain}>Main</span> : null}
                  </td>
                  <td>
                    <span className={`${styles.badge} ${badgeClass(person.status)}`} data-status={person.status}>
                      {STATUS_LABEL[person.status]}
                    </span>
                  </td>
                  <td className={styles.muted}>{personStage(person) || "—"}</td>
                  <td className={styles.muted}>{person.joinedAt ? formatJoined(person.joinedAt) : "—"}</td>
                  <td>
                    <button type="button" className={styles.textButton} aria-label={`Edit ${person.name}`} onClick={() => setEditing(person)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
            </>
        ) : null}
        {list.phase === "ready" && total > DEFAULT_PEOPLE_LIMIT ? (
          <div className={styles.pager}>
            <span>
              {from}–{to} of {total}
            </span>
            <div className={styles.pagerActions}>
              <button type="button" className={styles.ghost} disabled={offset === 0} onClick={() => setOffset((n) => Math.max(0, n - DEFAULT_PEOPLE_LIMIT))}>
                Previous
              </button>
              <button
                type="button"
                className={styles.ghost}
                disabled={offset + DEFAULT_PEOPLE_LIMIT >= total}
                onClick={() => setOffset((n) => n + DEFAULT_PEOPLE_LIMIT)}
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {adding ? (
        <AddPersonDialog
          client={client}
          onClose={() => setAdding(false)}
          onCreated={() => setTick((n) => n + 1)}
          onViewPerson={(personId, name) => {
            setAdding(false);
            setCampus("");
            setStatus("");
            setDraft(name);
            setQ(name);
            setOffset(0);
            setFocusPersonId(personId);
          }}
        />
      ) : null}
      {editing ? (
        <EditPerson
          person={editing}
          client={client}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setTick((n) => n + 1);
          }}
          onNotFound={() => setTick((n) => n + 1)}
        />
      ) : null}
    </div>
  );
}

function badgeClass(status: MissioStatus): string {
  if (status === "active") return styles.badgeActive;
  if (status === "visitor") return styles.badgeVisitor;
  return styles.badgeInactive;
}

function personStage(person: MissioPerson): string {
  return person.currentStage?.trim() ?? "";
}

function personJoined(person: MissioPerson): string {
  return person.joinedAt ? formatJoined(person.joinedAt) : "";
}

function EditPerson({
  person,
  client,
  onClose,
  onSaved,
  onNotFound,
}: {
  person: MissioPerson;
  client: MissioClient;
  onClose: () => void;
  onSaved: () => void;
  onNotFound: () => void;
}) {
  const [campus, setCampus] = useState<MissioCampus>(person.campus);
  const [status, setStatus] = useState<MissioStatus>(person.status);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: { campus?: MissioCampus; status?: MissioStatus }) {
    setPending(true);
    setError(null);
    try {
      await client.updatePerson(person.id, patch);
      onSaved();
    } catch (caught) {
      const missing = caught instanceof MissioApiError && caught.code === "not_found";
      setError(missing ? "This person couldn’t be found" : caught instanceof MissioApiError ? missioErrorCopy(caught, "submit") : "Couldn’t save.");
      if (missing) onNotFound();
      setPending(false);
    }
  }

  return (
    <MissioDialog onClose={onClose} title={`Edit ${person.name}`} testId="edit-person">
        <p className={styles.help}>Campus and status only. There’s no delete — mark someone inactive when they leave.</p>
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.fields}>
          <label className={styles.field}>
            Campus
            <select aria-label="Edit campus" value={campus} onChange={(event) => setCampus(event.target.value as MissioCampus)}>
              <option value="potch">Missio Potch</option>
              <option value="jhb">Missio JHB</option>
            </select>
          </label>
          <label className={styles.field}>
            Status
            <select aria-label="Edit status" value={status} onChange={(event) => setStatus(event.target.value as MissioStatus)}>
              <option value="visitor">Visitor</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>
        <div className={styles.actions}>
          {person.status !== "inactive" ? (
            <button
              type="button"
              className={styles.markInactive}
              disabled={pending}
              onClick={() => void save({ status: "inactive" })}
            >
              Mark inactive
            </button>
          ) : (
            <span className={styles.spacer} />
          )}
          <button type="button" className={styles.ghost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.primary} disabled={pending} onClick={() => void save({ campus, status })}>
            Save
          </button>
        </div>
    </MissioDialog>
  );
}
