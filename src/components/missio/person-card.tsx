"use client";

import Link from "next/link";
import type { PersonProfile } from "@/lib/missio/profile";
import { CAMPUS_LABEL, STATUS_LABEL } from "./access";
import { fetchPersonProfile } from "./api";
import { houseTitle, ROLE_LABEL } from "./house-churches/format";
import { useMissioLoad } from "./house-churches/load";
import { HouseStatus } from "./house-churches/status";
import { MissioDialog } from "./missio-dialog";
import {
  ContactActions,
  defaultAccess,
  HubAccessCard,
  initials,
  journeyCopy,
  journeyDate,
  since,
  type AccessClient,
} from "./person-profile";
import { householdsClient, type HouseholdsClient } from "./households/client";
import { HouseholdCard } from "./households/household-card";
import shell from "./shell.module.css";
import styles from "./person-profile.module.css";

/**
 * A person's details as a card over the list, so a pastor can look someone
 * up without leaving the page. "Open full profile" goes to the whole page.
 */
export function PersonCardDialog({
  personId,
  name,
  onClose,
  load = fetchPersonProfile,
  access = defaultAccess,
  households = householdsClient,
}: {
  personId: string;
  name: string;
  onClose: () => void;
  load?: (id: string) => Promise<PersonProfile>;
  access?: AccessClient;
  households?: HouseholdsClient;
}) {
  const { state, retry } = useMissioLoad(() => load(personId), [personId, load]);
  return (
    <MissioDialog onClose={onClose} title={name || "Person"} testId="person-card">
      {state.phase === "loading" ? (
        <p className={shell.state} role="status">
          Loading…
        </p>
      ) : null}
      {state.phase === "error" ? <HouseStatus error={state.error} fallback="This person didn’t load." onRetry={retry} /> : null}
      {state.phase === "ready" ? <CardBody profile={state.data} access={access} households={households} /> : null}
      <div className={styles.cardFoot}>
        <Link href={`/missio/people/${encodeURIComponent(personId)}`} className={styles.fullLink}>
          Open full profile
        </Link>
        <button type="button" className={shell.ghost} onClick={onClose}>
          Close
        </button>
      </div>
    </MissioDialog>
  );
}

function CardBody({ profile, access, households }: { profile: PersonProfile; access: AccessClient; households: HouseholdsClient }) {
  const { person, contact, houses, journey } = profile;
  const current = houses.filter((house) => !house.endedAt);
  return (
    <div className={styles.quick} data-testid="person-card-body">
      <div className={styles.quickHead}>
        <span className={styles.avatar} aria-hidden="true">
          {initials(person.name)}
        </span>
        <p className={styles.tags}>
          <span className={shell.tag}>{STATUS_LABEL[person.status]}</span>
          <span className={shell.tag}>{CAMPUS_LABEL[person.campus]}</span>
        </p>
      </div>
      <ContactActions phone={contact.phone} email={contact.email} />

      <dl className={styles.facts}>
        <div>
          <dt>Phone</dt>
          <dd>{contact.phone ?? "Not on file"}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{contact.email ?? "Not on file"}</dd>
        </div>
      </dl>

      <div>
        <h3 className={styles.quickLabel}>Belongs to</h3>
        {current.length === 0 ? <p className={styles.quiet}>Not in a house church yet.</p> : null}
        <ul className={styles.rows}>
          {current.map((house) => (
            <li key={house.membershipId}>
              <Link href={`/missio/house-churches/${house.houseId}`} className={styles.row}>
                <span className={styles.rowMain}>
                  {houseTitle(house)} · {ROLE_LABEL[house.role]}
                </span>
                <span className={styles.rowMeta}>Since {since(house.startedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {journey.length > 0 ? (
        <div>
          <h3 className={styles.quickLabel}>Lately</h3>
          <ul className={styles.quickJourney}>
            {journey.slice(0, 3).map((event) => (
              <li key={event.id}>
                <span>{journeyCopy(event).title}</span>
                <span className={styles.rowMeta}>{journeyDate(event.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <HouseholdCard personId={person.id} name={person.name} client={households} />
      <HubAccessCard personId={person.id} name={person.name} client={access} />
    </div>
  );
}
