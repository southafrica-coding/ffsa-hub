"use client";

import { useState } from "react";
import Link from "next/link";
import { CAMPUS_LABEL, formatJoined } from "../access";
import { MissioApiError, missioClient, type MissioClient } from "../api";
import content from "../content.module.css";
import shell from "../shell.module.css";
import type { MissioPerson } from "../types-shim";
import { houseChurchesClient, houseErrorCopy, type HouseChurchesClient } from "./client";
import { houseTitle, meetingLine, nameList, peopleCount, personHref, ROLE_LABEL, sortMembers } from "./format";
import { useMissioLoad } from "./load";
import { PeoplePicker } from "./people-picker";
import { HouseStatus } from "./status";
import type { HouseMember, HouseRole } from "./types";
import styles from "./house-churches.module.css";

export function HouseDetailView({
  houseId,
  client = houseChurchesClient,
  people = missioClient,
}: {
  houseId: string;
  client?: HouseChurchesClient;
  people?: Pick<MissioClient, "listPeople">;
}) {
  const { state, retry } = useMissioLoad(() => client.getHouse(houseId), [client, houseId]);
  const [role, setRole] = useState<HouseRole>("member");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function changeRole(member: HouseMember, next: HouseRole) {
    if (next === member.role) return;
    setPending(true);
    setNotice(null);
    try {
      await client.updateMemberRole(houseId, member.contactId, next);
      retry();
    } catch (caught) {
      setNotice(caught instanceof MissioApiError ? houseErrorCopy(caught, "The role didn’t change.") : "The role didn’t change.");
    } finally {
      setPending(false);
    }
  }

  async function remove(member: HouseMember) {
    setPending(true);
    setNotice(null);
    try {
      await client.removeMember(houseId, member.contactId);
      retry();
    } catch (caught) {
      setNotice(caught instanceof MissioApiError ? houseErrorCopy(caught, "This person is still in the house.") : "This person is still in the house.");
    } finally {
      setPending(false);
    }
  }

  async function add(person: MissioPerson) {
    setPending(true);
    setNotice(null);
    try {
      await client.addMember(houseId, { contactId: person.contactId, role });
      retry();
    } catch (caught) {
      setNotice(caught instanceof MissioApiError ? houseErrorCopy(caught, "They weren’t added.") : "They weren’t added.");
    } finally {
      setPending(false);
    }
  }

  const house = state.phase === "ready" ? state.data.house : null;
  const canWrite = state.phase === "ready" ? state.data.canWrite : false;
  const members = house ? sortMembers(house.members) : [];
  const meets = house ? meetingLine(house) : "";

  return (
    <div className={`${content.page} ${styles.root}`}>
      <Link href="/missio/house-churches" className={styles.back}>
        All houses
      </Link>
      {state.phase === "loading" ? (
        <div className={shell.state} data-state="loading" role="status">
          Loading this house…
        </div>
      ) : null}
      {state.phase === "error" ? (
        <HouseStatus error={state.error} fallback="This house didn’t load." onRetry={retry} />
      ) : null}
      {house ? (
        <>
          <p className={`${shell.eyebrow} ${content.eyebrow}`}>House {house.number}</p>
          <h1 className={content.title}>{houseTitle(house)}</h1>
          <p className={styles.line}>
            <span className={shell.campus}>{CAMPUS_LABEL[house.campus]}</span>
            {house.campus === "potch" ? <span className={shell.campusMain}>Main</span> : null}
            <span className={styles.count}> · {peopleCount(house.memberCount)}</span>
          </p>
          {meets ? <p className={styles.line}>{meets}</p> : null}
          <p className={styles.line}>Leaders: {nameList(house.leaders)}</p>
          <p className={styles.line}>Co-leaders: {nameList(house.coLeaders)}</p>
          {house.leaderNotes?.trim() ? (
            <section className={styles.block}>
              <h2>Leader notes</h2>
              <p className={`${shell.lede} ${content.lede}`}>{house.leaderNotes.trim()}</p>
            </section>
          ) : null}
          {notice ? (
            <p className={shell.alert} role="alert">
              {notice}
            </p>
          ) : null}
          <section className={`${styles.block} ${styles.members}`}>
            <h2>People</h2>
            {members.length === 0 ? <p className={styles.line}>No one is in this house yet.</p> : null}
            {members.length > 0 ? (
              <>
                <ul className={shell.peopleCards} data-testid="house-members">
                  {members.map((member) => (
                    <MemberCard
                      key={member.contactId}
                      member={member}
                      canWrite={canWrite}
                      pending={pending}
                      onRole={(next) => void changeRole(member, next)}
                      onRemove={() => void remove(member)}
                    />
                  ))}
                </ul>
                <table className={`${shell.table} ${content.table}`} data-testid="house-member-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Since</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => (
                      <tr key={member.contactId}>
                        <td>
                          <PersonName member={member} />
                        </td>
                        <td>{canWrite ? <RoleSelect member={member} disabled={pending} onRole={(next) => void changeRole(member, next)} /> : ROLE_LABEL[member.role]}</td>
                        <td className={shell.muted}>{member.startedAt ? formatJoined(member.startedAt) : "—"}</td>
                        <td>
                          {canWrite ? (
                            <button
                              type="button"
                              className={shell.textButton}
                              disabled={pending}
                              aria-label={`Remove ${member.displayName} from house`}
                              onClick={() => void remove(member)}
                            >
                              Remove from house
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}
          </section>
          {canWrite ? (
            <section className={styles.block} data-testid="add-member">
              <h2>Add someone</h2>
              <p className={styles.line}>Choose a role, then search the people list.</p>
              <label className={shell.field}>
                Role
                <select aria-label="Role for the new person" value={role} onChange={(event) => setRole(event.target.value as HouseRole)}>
                  <option value="leader">Leader</option>
                  <option value="co_leader">Co-leader</option>
                  <option value="member">Member</option>
                </select>
              </label>
              <PeoplePicker people={people} pending={pending} onPick={(person) => void add(person)} />
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function PersonName({ member }: { member: HouseMember }) {
  const href = personHref(member);
  if (!href) return <span className={shell.personName}>{member.displayName}</span>;
  return (
    <Link href={href} className={`${shell.personName} ${styles.personLink}`}>
      {member.displayName}
    </Link>
  );
}

function RoleSelect({
  member,
  disabled,
  onRole,
}: {
  member: HouseMember;
  disabled: boolean;
  onRole: (role: HouseRole) => void;
}) {
  return (
    <select
      aria-label={`Role for ${member.displayName}`}
      value={member.role}
      disabled={disabled}
      onChange={(event) => onRole(event.target.value as HouseRole)}
    >
      <option value="leader">Leader</option>
      <option value="co_leader">Co-leader</option>
      <option value="member">Member</option>
    </select>
  );
}

function MemberCard({
  member,
  canWrite,
  pending,
  onRole,
  onRemove,
}: {
  member: HouseMember;
  canWrite: boolean;
  pending: boolean;
  onRole: (role: HouseRole) => void;
  onRemove: () => void;
}) {
  return (
    <li className={shell.personCard}>
      <div className={shell.personCardTop}>
        <PersonName member={member} />
        {canWrite ? null : (
          <span className={member.role === "member" ? shell.tagQuiet : shell.tag}>{ROLE_LABEL[member.role]}</span>
        )}
      </div>
      {member.startedAt ? <div className={shell.muted}>Since {formatJoined(member.startedAt)}</div> : null}
      {canWrite ? (
        <>
          <RoleSelect member={member} disabled={pending} onRole={onRole} />
          <button
            type="button"
            className={shell.textButton}
            disabled={pending}
            aria-label={`Remove ${member.displayName} from house`}
            onClick={onRemove}
          >
            Remove from house
          </button>
        </>
      ) : null}
    </li>
  );
}
