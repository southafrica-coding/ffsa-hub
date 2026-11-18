"use client";

import { useId, useState } from "react";
import { MissioApiError, missioErrorCopy, type MissioClient } from "../api";
import type { MissioPerson } from "../types-shim";
import shell from "../shell.module.css";
import styles from "./house-churches.module.css";

export function PeoplePicker({
  people,
  onPick,
  pending = false,
  label = "Search people",
  placeholder = "Name",
  showLabel = true,
}: {
  people: Pick<MissioClient, "listPeople">;
  onPick: (person: MissioPerson) => void;
  pending?: boolean;
  label?: string;
  placeholder?: string;
  showLabel?: boolean;
}) {
  const fieldId = useId();
  const [draft, setDraft] = useState("");
  const [rows, setRows] = useState<MissioPerson[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  async function search(query: string) {
    const q = query.trim();
    if (!q) {
      setRows(null);
      setNotice("Enter a name.");
      return;
    }
    setSearching(true);
    setNotice(null);
    try {
      const page = await people.listPeople({ q, limit: 8, offset: 0 });
      setRows(page.rows);
      if (page.rows.length === 0) setNotice("No one matches that name.");
    } catch (caught) {
      setRows(null);
      setNotice(caught instanceof MissioApiError ? missioErrorCopy(caught, "search") : "People didn’t load.");
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
        const data = new FormData(event.currentTarget);
        void search(String(data.get("q") ?? ""));
      }}
    >
      <label className={shell.field} htmlFor={fieldId}>
        {showLabel ? label : <span className={shell.visuallyHidden}>{label}</span>}
        <input
          id={fieldId}
          name="q"
          placeholder={placeholder}
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
            <li key={person.id}>
              <button
                type="button"
                className={`${shell.ghost} ${styles.choice}`}
                disabled={pending}
                onClick={() => onPick(person)}
              >
                <span>{person.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
