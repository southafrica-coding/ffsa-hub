"use client";

import { useEffect, useState } from "react";
import type { Household } from "@/lib/missio/households";
import { MissioApiError, missioClient, type MissioClient } from "../api";
import { missioFixedCopy } from "../errors";
import { houseTitle } from "../house-churches/format";
import { MissioDialog } from "../missio-dialog";
import shell from "../shell.module.css";
import type { MissioPerson } from "../types-shim";
import profile from "../person-profile.module.css";
import { householdsClient, type HouseholdsClient } from "./client";
import styles from "./households.module.css";

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[parts.length - 1]![0]}` : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

function copyFor(caught: unknown): string {
  return missioFixedCopy(caught instanceof MissioApiError ? caught.code : null);
}

/**
 * Board M14a, the household card on a profile. Adults and children, who the
 * main contact is, and how a family message opens. Pastors only.
 */
export function HouseholdCard({
  personId,
  name,
  client = householdsClient,
  people = missioClient,
}: {
  personId: string;
  name: string;
  client?: HouseholdsClient;
  people?: Pick<MissioClient, "listPeople">;
}) {
  const [household, setHousehold] = useState<Household | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState<"adult" | "child" | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    client.forPerson(personId).then(
      (value) => live && setHousehold(value),
      () => live && setFailed(true)
    );
    return () => {
      live = false;
    };
  }, [client, personId]);

  async function run(action: () => Promise<Household | null>) {
    setPending(true);
    setNotice(null);
    try {
      setHousehold(await action());
      return true;
    } catch (caught) {
      setNotice(copyFor(caught));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function start(kind: "adult" | "child") {
    if (household) return setAdding(kind);
    if (await run(() => client.create(personId))) setAdding(kind);
  }

  const first = name.split(" ")[0] || "They";
  const main = household?.adults.find((adult) => adult.main);

  return (
    <section className={profile.card} data-testid="profile-household">
      <div className={styles.head}>
        <h2>{household ? `Household · ${household.title}` : "Household"}</h2>
        {household ? (
          <button type="button" className={styles.link} onClick={() => setEditing((on) => !on)} aria-pressed={editing}>
            {editing ? "Done" : "Edit"}
          </button>
        ) : null}
      </div>
      {failed ? <p className={profile.quiet}>The household didn’t load.</p> : null}
      {household === undefined && !failed ? <p className={profile.quiet}>Loading…</p> : null}
      {household === null ? (
        <p className={profile.quiet}>
          {first} isn’t linked to a household yet. Add a spouse or children so the family is placed together and gets one
          message.
        </p>
      ) : null}
      {household ? (
        <ul className={styles.members}>
          {household.adults.map((adult) => (
            <li key={adult.memberId} className={styles.member}>
              <span className={styles.avatar} aria-hidden="true">
                {initialsOf(adult.name)}
              </span>
              <span className={styles.who}>
                <b>{adult.name}</b>
                <span className={profile.rowMeta}>
                  Adult{adult.label ? ` · ${adult.label}` : ""}
                  {adult.main ? " · main contact" : ""}
                </span>
              </span>
              {editing ? (
                <span className={styles.memberActions}>
                  {!adult.main ? (
                    <button
                      type="button"
                      className={styles.link}
                      disabled={pending}
                      onClick={() => void run(() => client.update(household.id, { mainContactId: adult.contactId }))}
                    >
                      Make main contact
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.link}
                    disabled={pending}
                    aria-label={`Take ${adult.name} out of the household`}
                    onClick={() => void run(() => client.remove(household.id, adult.memberId))}
                  >
                    Take out
                  </button>
                </span>
              ) : adult.main ? (
                <span className={shell.tag}>Main contact</span>
              ) : adult.houses[0] ? (
                <span className={shell.tag}>{houseTitle(adult.houses[0])}</span>
              ) : null}
            </li>
          ))}
          {household.children.map((child) => (
            <li key={child.memberId} className={styles.member}>
              <span className={`${styles.avatar} ${styles.avatarChild}`} aria-hidden="true">
                {initialsOf(`${child.firstName} ${child.lastName ?? ""}`)}
              </span>
              <span className={styles.who}>
                <b>{[child.firstName, child.lastName].filter(Boolean).join(" ")}</b>
                <span className={profile.rowMeta}>Child · born {child.birthYear}</span>
              </span>
              {editing ? (
                <span className={styles.memberActions}>
                  <button
                    type="button"
                    className={styles.link}
                    disabled={pending}
                    aria-label={`Take ${child.firstName} out of the household`}
                    onClick={() => void run(() => client.remove(household.id, child.memberId))}
                  >
                    Take out
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {household && main && household.adults.length > 1 ? (
        <p className={profile.quiet}>
          Family messages go once, to {main.firstName}: “{household.greeting}”.
        </p>
      ) : null}
      {notice ? (
        <p className={profile.quiet} role="alert">
          {notice}
        </p>
      ) : null}
      {household !== undefined && !failed ? (
        <div className={styles.addRow}>
          <button type="button" className={shell.ghost} disabled={pending} onClick={() => void start("adult")}>
            Add an adult
          </button>
          <button type="button" className={shell.ghost} disabled={pending} onClick={() => void start("child")}>
            Add a child
          </button>
        </div>
      ) : null}
      {adding && household ? (
        <AddMemberDialog
          household={household}
          kind={adding}
          client={client}
          people={people}
          onClose={() => setAdding(null)}
          onSaved={(next) => {
            setHousehold(next);
            setAdding(null);
          }}
        />
      ) : null}
    </section>
  );
}

const THIS_YEAR = new Date().getUTCFullYear();

/** Board M14a, "Add to the Naidoo household": an adult from Missio people, or a child. */
export function AddMemberDialog({
  household,
  kind: initialKind,
  client,
  people,
  onClose,
  onSaved,
}: {
  household: Household;
  kind: "adult" | "child";
  client: HouseholdsClient;
  people: Pick<MissioClient, "listPeople">;
  onClose: () => void;
  onSaved: (household: Household) => void;
}) {
  const [kind, setKind] = useState(initialKind);
  const surname = household.adults[0]?.name.split(" ").slice(1).join(" ") ?? "";
  const [firstName, setFirstName] = useState("");
  const [year, setYear] = useState("");
  const [sameSurname, setSameSurname] = useState(Boolean(surname));
  const [lastName, setLastName] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MissioPerson[]>([]);
  const [picked, setPicked] = useState<MissioPerson | null>(null);
  const [label, setLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "adult" || q.trim().length < 2) {
      setResults([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      people.listPeople({ q: q.trim(), limit: 6, offset: 0 }).then(
        (page) => live && setResults(page.rows.filter((row) => !household.adults.some((adult) => adult.contactId === row.contactId))),
        () => live && setResults([])
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [kind, q, people, household.adults]);

  const yearNumber = Number(year);
  const childReady = firstName.trim().length > 0 && /^\d{4}$/.test(year) && yearNumber >= 1990 && yearNumber <= THIS_YEAR;
  const ready = kind === "child" ? childReady : Boolean(picked);
  const shortTitle = household.title.replace(/^The /, "the ");

  async function save() {
    if (!ready || pending) return;
    setPending(true);
    setNotice(null);
    try {
      const next =
        kind === "child"
          ? await client.addChild(household.id, {
              firstName: firstName.trim(),
              birthYear: yearNumber,
              ...(sameSurname ? (surname ? { lastName: surname } : {}) : lastName.trim() ? { lastName: lastName.trim() } : {}),
            })
          : await client.addAdult(household.id, picked!.id, label.trim() || undefined);
      onSaved(next);
    } catch (caught) {
      setNotice(copyFor(caught));
      setPending(false);
    }
  }

  return (
    <MissioDialog onClose={onClose} title={`Add to ${shortTitle}`} testId="household-add">
      <div className={styles.seg} role="radiogroup" aria-label="Who">
        {(["adult", "child"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={kind === option}
            className={kind === option ? styles.segOn : undefined}
            onClick={() => setKind(option)}
          >
            {option === "adult" ? "An adult" : "A child"}
          </button>
        ))}
      </div>
      {kind === "child" ? (
        <div className={shell.fields}>
          <label className={shell.field}>
            First name
            <input value={firstName} onChange={(event) => setFirstName(event.target.value)} maxLength={60} autoComplete="off" />
          </label>
          <label className={shell.field}>
            Year born
            <input
              value={year}
              onChange={(event) => setYear(event.target.value.replace(/\D/g, "").slice(0, 4))}
              inputMode="numeric"
              placeholder={String(THIS_YEAR - 5)}
            />
          </label>
          <p className={styles.help}>Only the year. We don’t keep more than we need about children.</p>
          {surname ? (
            <div className={styles.seg} role="radiogroup" aria-label="Their surname">
              <button type="button" role="radio" aria-checked={sameSurname} className={sameSurname ? styles.segOn : undefined} onClick={() => setSameSurname(true)}>
                {surname}
              </button>
              <button type="button" role="radio" aria-checked={!sameSurname} className={!sameSurname ? styles.segOn : undefined} onClick={() => setSameSurname(false)}>
                Different
              </button>
            </div>
          ) : null}
          {!sameSurname || !surname ? (
            <label className={shell.field}>
              Surname
              <input value={lastName} onChange={(event) => setLastName(event.target.value)} maxLength={60} autoComplete="off" />
            </label>
          ) : null}
          <p className={styles.help}>
            Children have no phone or email and never get messages. Only pastors and their house leaders can see them.
          </p>
        </div>
      ) : (
        <div className={shell.fields}>
          <label className={shell.field}>
            Find them in Missio people
            <input
              value={q}
              onChange={(event) => {
                setQ(event.target.value);
                setPicked(null);
              }}
              placeholder="Name"
              autoComplete="off"
            />
          </label>
          {results.length > 0 && !picked ? (
            <ul className={styles.results}>
              {results.map((row) => (
                <li key={row.id}>
                  <button type="button" onClick={() => setPicked(row)}>
                    {row.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {q.trim().length >= 2 && results.length === 0 && !picked ? (
            <p className={styles.help}>No one by that name. Add them on People first, then link them here.</p>
          ) : null}
          {picked ? <p className={styles.picked}>Adding {picked.name}</p> : null}
          <label className={shell.field}>
            How they’re related (optional)
            <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={30} placeholder="Husband, wife, mom…" />
          </label>
        </div>
      )}
      {notice ? (
        <p className={shell.alert} role="alert">
          {notice}
        </p>
      ) : null}
      <div className={shell.actions}>
        <button type="button" className={shell.ghost} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={shell.primary} disabled={!ready || pending} onClick={() => void save()}>
          {kind === "child" ? `Add ${firstName.trim() || "child"}` : picked ? `Add ${picked.name.split(" ")[0]}` : "Add"}
        </button>
      </div>
    </MissioDialog>
  );
}
