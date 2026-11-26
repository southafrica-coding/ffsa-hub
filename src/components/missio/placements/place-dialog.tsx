"use client";

import { useEffect, useState } from "react";
import type { PlacementView } from "@/lib/missio/placements";
import { MissioApiError } from "../api";
import { missioFixedCopy } from "../errors";
import { whatsAppHref } from "../follow-up/whatsapp";
import { houseChurchesClient, type HouseChurchesClient } from "../house-churches/client";
import { coachNames, houseTitle, leadingLine, meetingDayLabel, sizeWord } from "../house-churches/format";
import type { Household } from "@/lib/missio/households";
import { householdsClient, type HouseholdsClient } from "../households/client";
import { useMissioLoad } from "../house-churches/load";
import { MissioDialog } from "../missio-dialog";
import shell from "../shell.module.css";
import { placementsClient, type PlacementsClient } from "./client";
import { placementMessages, type FamilyNote } from "./messages";
import styles from "./placements.module.css";

/**
 * Board M12a: a pastor places someone in a house, then sends the two
 * WhatsApps (to the person and the leader). Until the WhatsApp connection
 * is built, "Send" opens WhatsApp with the message ready.
 */
export function PlaceDialog({
  name,
  contactId = null,
  resolveContact,
  houses = houseChurchesClient,
  households = householdsClient,
  placements = placementsClient,
  onClose,
  onPlaced,
}: {
  name: string;
  /** Known when they're already a contact; their household (if any) is offered too. */
  contactId?: string | null;
  /** The contact to place; may create it first for a connect card. */
  resolveContact: () => Promise<string>;
  houses?: Pick<HouseChurchesClient, "listHouses">;
  households?: Pick<HouseholdsClient, "forContact">;
  placements?: Pick<PlacementsClient, "create">;
  onClose: () => void;
  onPlaced: (placement: PlacementView) => void;
}) {
  const { state } = useMissioLoad(() => houses.listHouses(), [houses]);
  const [houseId, setHouseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PlacementView | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [together, setTogether] = useState(true);

  useEffect(() => {
    if (!contactId) return;
    let live = true;
    households.forContact(contactId).then(
      (found) => live && setHousehold(found && found.adults.length + found.children.length > 1 ? found : null),
      () => undefined
    );
    return () => {
      live = false;
    };
  }, [contactId, households]);

  const family = household && together ? household : null;
  const familyNote: FamilyNote | null = family
    ? { title: family.title, greeting: family.greeting, adults: family.adults.length, kids: family.children.length }
    : null;
  const familySize = family ? family.adults.length + family.children.length : 1;
  const list = state.phase === "ready" ? [...state.data.houses].sort((a, b) => a.memberCount - b.memberCount || a.number - b.number) : [];
  const first = name.split(" ")[0] || name;
  const chosen = list.find((house) => house.id === houseId) ?? null;

  async function place() {
    if (!houseId || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const contactId = await resolveContact();
      const placement = await placements.create(contactId, houseId, Boolean(family));
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
    const { toPerson, toLeader } = placementMessages(placed, origin, "", familyNote);
    const personChat = whatsAppHref(placed.person.phone);
    const leaderChat = whatsAppHref(placed.leaders[0]?.phone ?? null);
    return (
      <MissioDialog onClose={onClose} title={`${first} is placed in ${houseTitle(placed.house)}`} testId="place-done">
        <p className={styles.meta}>Now send these two. They open in WhatsApp, ready to go.</p>
        <p className={styles.messageHead}>
          <span>{first} gets</span>
        </p>
        <div className={styles.tray}>
          <p className={styles.message} data-testid="msg-person">
            {toPerson}
          </p>
        </div>
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
        <div className={styles.tray}>
          <p className={styles.message} data-testid="msg-leader">
            {toLeader}
          </p>
        </div>
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
    <MissioDialog onClose={onClose} title={family ? `Place ${family.title.replace(/^The /, "the ")} in a house` : `Place ${first} in a house`} testId="place-dialog">
      <p className={styles.meta}>Smallest houses first. The leader gets a message to say hi, then the tracker follows {first} until they’ve joined.</p>
      {household ? (
        <div className={styles.family} data-testid="place-family">
          <label className={styles.familyToggle}>
            <input type="checkbox" checked={together} onChange={(event) => setTogether(event.target.checked)} />
            <span>Place the whole household together</span>
          </label>
          <ul>
            {household.adults.map((adult) => (
              <li key={adult.memberId}>
                <b>{adult.name}</b> <span>adult{adult.main ? " · main contact" : ""}</span>
              </li>
            ))}
            {household.children.map((child) => (
              <li key={child.memberId}>
                <b>{[child.firstName, child.lastName].filter(Boolean).join(" ")}</b> <span>child · {child.birthYear}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
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
              <span className={`${styles.radio} ${houseId === house.id ? styles.radioOn : ""}`} aria-hidden="true" />
              <span className={styles.choiceText}>
              <b>
                {houseTitle(house)}
                {house.meetingDay ? ` · ${meetingDayLabel(house.meetingDay)}s` : ""}
              </b>
              <span>
                {leadingLine(house)} · {house.memberCount} {sizeWord(house)}
                {house.coaches.length > 0 ? ` · coached by ${coachNames(house.coaches)}` : ""}
              </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {chosen && family ? (
        <p className={styles.meta} data-testid="place-size">
          {houseTitle(chosen)} goes from {chosen.memberCount} to{" "}
          <b>
            {chosen.memberCount + family.adults.length}{" "}
            {sizeWord({ memberCount: chosen.memberCount + family.adults.length, kidsCount: (chosen.kidsCount ?? 0) + family.children.length })}
          </b>
          .
        </p>
      ) : null}
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
          {!chosen ? "Choose a house" : family ? `Place ${familySize} in ${houseTitle(chosen)}` : `Place in ${houseTitle(chosen)}`}
        </button>
      </div>
    </MissioDialog>
  );
}
