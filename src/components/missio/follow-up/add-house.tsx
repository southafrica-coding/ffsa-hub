"use client";

import { useState } from "react";
import { MissioApiError, missioClient, type MissioClient } from "../api";
import { missioFixedCopy, isStaleWrite } from "../errors";
import { houseChurchesClient, type HouseChurchesClient } from "../house-churches/client";
import { houseTitle, meetingDayLabel, sortHouses } from "../house-churches/format";
import { useMissioLoad } from "../house-churches/load";
import { PeoplePicker } from "../house-churches/people-picker";
import { MissioDialog } from "../missio-dialog";
import type { FollowUpClient } from "./client";
import type { FollowUpItem } from "./types";
import styles from "./follow-up.module.css";

export function AddHouseDialog({
  person,
  followUp,
  houses = houseChurchesClient,
  people = missioClient,
  onClose,
  onAdded,
  onConflict,
}: {
  person: FollowUpItem;
  followUp: FollowUpClient;
  houses?: Pick<HouseChurchesClient, "listHouses" | "addMember">;
  people?: Pick<MissioClient, "listPeople">;
  onClose: () => void;
  onAdded: () => void;
  onConflict: () => void;
}) {
  const { state, retry } = useMissioLoad(() => houses.listHouses(), [houses]);
  const [houseId, setHouseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState(false);

  async function addContact(contactId: string) {
    await houses.addMember(houseId as string, { contactId, role: "member" });
    onAdded();
  }

  async function confirm() {
    if (!houseId || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      let contactId = person.contactId;
      if (!contactId) {
        const created = await followUp.createContact(person.key);
        contactId = created.person.contactId;
        if (!contactId) throw new MissioApiError(500, "", null, "server_error");
      }
      await addContact(contactId);
    } catch (caught) {
      const code = caught instanceof MissioApiError ? caught.code : null;
      if (isStaleWrite(code)) {
        setNotice(missioFixedCopy(code));
        onConflict();
        return;
      }
      if (code === "exists_use_search") setSearch(true);
      setNotice(missioFixedCopy(code, caught instanceof MissioApiError ? caught.retryAfterSeconds : null));
    } finally {
      setBusy(false);
    }
  }

  async function linkExisting(contactId: string) {
    if (!houseId || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await addContact(contactId);
    } catch (caught) {
      const code = caught instanceof MissioApiError ? caught.code : null;
      if (isStaleWrite(code)) {
        setNotice(missioFixedCopy(code));
        onConflict();
        return;
      }
      setNotice(missioFixedCopy(code, caught instanceof MissioApiError ? caught.retryAfterSeconds : null));
    } finally {
      setBusy(false);
    }
  }

  const list = state.phase === "ready" ? sortHouses(state.data.houses) : [];

  return (
    <MissioDialog title="Add to a house" testId="add-house" onClose={onClose} returnFocus={false}>
      <div className={styles.root}>
        {state.phase === "loading" ? <p role="status">Loading houses…</p> : null}
        {state.phase === "error" ? (
          <div role="alert">
            <p>{missioFixedCopy(caughtCode(state.error), retrySeconds(state.error))}</p>
            <button type="button" className={styles.ghost} onClick={retry}>
              Try again
            </button>
          </div>
        ) : null}
        {state.phase === "ready" && list.length === 0 ? <p>No house churches yet.</p> : null}
        {list.length > 0 ? (
          <ul className={styles.choices}>
            {list.map((house) => {
              const day = meetingDayLabel(house.meetingDay);
              const selected = houseId === house.id;
              return (
                <li key={house.id}>
                  <button
                    type="button"
                    className={`${styles.choice} ${selected ? styles.choiceOn : ""}`}
                    aria-pressed={selected}
                    onClick={() => setHouseId(house.id)}
                  >
                    {houseTitle(house)}
                    {day ? ` · ${day}` : ""}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {notice ? (
          <p className={styles.notice} role="alert">
            {notice}
          </p>
        ) : null}
        {search ? (
          <PeoplePicker
            people={people}
            pending={busy}
            label="Search people"
            onPick={(picked) => void linkExisting(picked.contactId)}
          />
        ) : null}
        <button type="button" className={styles.primary} disabled={!houseId || busy || search} onClick={() => void confirm()}>
          {busy ? "Adding…" : "Add to this house"}
        </button>
      </div>
    </MissioDialog>
  );
}

function caughtCode(error: unknown): string | null {
  return error instanceof MissioApiError ? error.code : null;
}

function retrySeconds(error: unknown): number | null {
  return error instanceof MissioApiError ? error.retryAfterSeconds : null;
}
