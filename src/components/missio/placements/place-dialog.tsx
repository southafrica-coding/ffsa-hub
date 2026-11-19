"use client";

import { useState } from "react";
import type { PlacementView } from "@/lib/missio/placements";
import { MissioApiError } from "../api";
import { missioFixedCopy } from "../errors";
import { whatsAppHref } from "../follow-up/whatsapp";
import { houseChurchesClient, type HouseChurchesClient } from "../house-churches/client";
import { coachNames, houseTitle, leadingLine, meetingDayLabel } from "../house-churches/format";
import { useMissioLoad } from "../house-churches/load";
import { MissioDialog } from "../missio-dialog";
import shell from "../shell.module.css";
import { placementsClient, type PlacementsClient } from "./client";
import { placementMessages } from "./messages";
import styles from "./placements.module.css";

/**
 * Board M12a: a pastor places someone in a house, then sends the two
 * WhatsApps (to the person and the leader). Until the WhatsApp connection
 * is built, "Send" opens WhatsApp with the message ready.
 */
export function PlaceDialog({
  name,
  resolveContact,
  houses = houseChurchesClient,
  placements = placementsClient,
  onClose,
  onPlaced,
}: {
  name: string;
  /** The contact to place; may create it first for a connect card. */
  resolveContact: () => Promise<string>;
  houses?: Pick<HouseChurchesClient, "listHouses">;
  placements?: Pick<PlacementsClient, "create">;
  onClose: () => void;
  onPlaced: (placement: PlacementView) => void;
}) {
  const { state } = useMissioLoad(() => houses.listHouses(), [houses]);
  const [houseId, setHouseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PlacementView | null>(null);
  const list = state.phase === "ready" ? [...state.data.houses].sort((a, b) => a.memberCount - b.memberCount || a.number - b.number) : [];
  const first = name.split(" ")[0] || name;

  async function place() {
    if (!houseId || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const contactId = await resolveContact();
      const placement = await placements.create(contactId, houseId);
      setPlaced(placement);
      onPlaced(placement);
    } catch (caught) {
      setNotice(caught instanceof MissioApiError ? missioFixedCopy(caught.code) : "That didn’t work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (placed) {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const { toPerson, toLeader } = placementMessages(placed, origin);
    const personChat = whatsAppHref(placed.person.phone);
    const leaderChat = whatsAppHref(placed.leaders[0]?.phone ?? null);
    return (
      <MissioDialog onClose={onClose} title={`${first} is placed in ${houseTitle(placed.house)}`} testId="place-done">
        <p className={styles.meta}>Now send these two. They open in WhatsApp, ready to go.</p>
        <p className={styles.messageHead}>
          <span>{first} gets</span>
        </p>
        <p className={styles.message} data-testid="msg-person">
          {toPerson}
        </p>
        <div className={styles.footer}>
          {personChat ? (
            <a className={shell.ghost} href={`${personChat}?text=${encodeURIComponent(toPerson)}`} target="_blank" rel="noopener noreferrer">
              Send to {first}
            </a>
          ) : (
            <span className={styles.meta}>No phone on file for {first}.</span>
          )}
        </div>
        <p className={styles.messageHead}>
          <span>{placed.leaders[0]?.name.split(" ")[0] || "The leader"} gets</span>
        </p>
        <p className={styles.message} data-testid="msg-leader">
          {toLeader}
        </p>
        <div className={styles.footer}>
          {leaderChat ? (
            <a className={shell.ghost} href={`${leaderChat}?text=${encodeURIComponent(toLeader)}`} target="_blank" rel="noopener noreferrer">
              Send to {placed.leaders[0]?.name.split(" ")[0]}
            </a>
          ) : (
            <span className={styles.meta}>No leader phone on file for this house.</span>
          )}
          <button type="button" className={shell.primary} onClick={onClose}>
            Done
          </button>
        </div>
      </MissioDialog>
    );
  }

  return (
    <MissioDialog onClose={onClose} title={`Place ${first} in a house`} testId="place-dialog">
      <p className={styles.meta}>Smallest houses first. The leader gets a message to say hi, then the tracker follows {first} until they’ve joined.</p>
      {state.phase === "loading" ? <p className={styles.meta}>Loading houses…</p> : null}
      {state.phase === "error" ? (
        <p className={shell.alert} role="alert">
          Houses didn’t load. Close and try again.
        </p>
      ) : null}
      <ul className={styles.houses} role="radiogroup" aria-label="House">
        {list.map((house) => (
          <li key={house.id}>
            <button
              type="button"
              role="radio"
              aria-checked={houseId === house.id}
              className={`${styles.houseChoice} ${houseId === house.id ? styles.houseOn : ""}`}
              onClick={() => setHouseId(house.id)}
            >
              <b>
                {houseTitle(house)}
                {house.meetingDay ? ` · ${meetingDayLabel(house.meetingDay)}s` : ""}
              </b>
              <span>
                {leadingLine(house)} · {house.memberCount} {house.memberCount === 1 ? "person" : "people"}
                {house.coaches.length > 0 ? ` · coached by ${coachNames(house.coaches)}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {notice ? (
        <p className={shell.alert} role="alert">
          {notice}
        </p>
      ) : null}
      <div className={styles.footer}>
        <button type="button" className={shell.ghost} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={shell.primary} disabled={!houseId || busy} onClick={() => void place()}>
          {houseId ? `Place in ${houseTitle(list.find((house) => house.id === houseId)!)}` : "Choose a house"}
        </button>
      </div>
    </MissioDialog>
  );
}
