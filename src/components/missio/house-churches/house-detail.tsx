"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatJoined, missioSkinVars } from "../access";
import { MissioApiError, missioClient, type MissioClient } from "../api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import content from "../content.module.css";
import shell from "../shell.module.css";
import type { MissioPerson } from "../types-shim";
import { houseChurchesClient, houseErrorCopy, type HouseChurchesClient } from "./client";
import {
  houseSignals,
  houseTitle,
  initialsOf,
  MULTIPLY_AT,
  meetingDayLabel,
  peopleCount,
  personHref,
  ROLE_LABEL,
  SIGNAL_LABEL,
  sortMembers,
} from "./format";
import { SizeDots } from "./house-grid";
import { PersonCardDialog } from "../person-card";
import { useMissioLoad } from "./load";
import { PeoplePicker } from "./people-picker";
import { AllHousesLink, CampusTag } from "./present";
import { HouseStatus } from "./status";
import type { CoachRef, HouseDetail, HouseMember, HouseRole, PersonRef } from "./types";
import styles from "./house-churches.module.css";

function portaledMissioClass() {
  const root = typeof document === "undefined" ? null : document.querySelector("[data-missio-font]");
  return [styles.menu, root?.className].filter(Boolean).join(" ");
}

function replaceMembers(house: HouseDetail, members: HouseMember[]): HouseDetail {
  return {
    ...house,
    memberCount: members.length,
    members,
    leaders: members.filter((member) => member.role === "leader"),
    coLeaders: members.filter((member) => member.role === "co_leader"),
  };
}

function focusElement(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

function needsQuietRefresh(error: unknown): boolean {
  return (
    error instanceof MissioApiError &&
    (error.code === "membership_not_current" || error.code === "already_resolved" || error.code === "member_left_missio")
  );
}

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
  const [live, setLive] = useState<{ house: HouseDetail; canWrite: boolean; canEdit: boolean } | null>(null);
  const [role, setRole] = useState<HouseRole>("member");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state.phase === "ready") {
      setLive({
        house: state.data.house,
        canWrite: state.data.canWrite,
        canEdit: state.data.abilities?.editMembers ?? state.data.canWrite,
      });
    }
  }, [state]);

  useEffect(() => {
    if (notice) errorRef.current?.focus();
  }, [notice]);

  async function refreshHouse() {
    const fresh = await client.getHouse(houseId);
    setLive({ house: fresh.house, canWrite: fresh.canWrite, canEdit: fresh.abilities?.editMembers ?? fresh.canWrite });
  }

  async function changeRole(member: HouseMember, next: HouseRole) {
    if (next === member.role) return;
    setPending(true);
    setNotice(null);
    try {
      const result = await client.updateMemberRole(houseId, member.contactId, next);
      setLive((current) => {
        if (!current) return current;
        const members = current.house.members.map((item) =>
          item.contactId === member.contactId ? { ...item, ...result.member, contactId: member.contactId } : item
        );
        return { ...current, house: replaceMembers(current.house, members) };
      });
      focusElement(`house-edit-${member.contactId}`);
    } catch (caught) {
      const copy =
        caught instanceof MissioApiError ? houseErrorCopy(caught, "role") : "That didn’t work. Try again.";
      setNotice(copy);
      if (needsQuietRefresh(caught)) await refreshHouse().catch(() => undefined);
    } finally {
      setPending(false);
    }
  }

  async function remove(member: HouseMember) {
    const sorted = sortMembers(live?.house.members ?? []);
    const index = sorted.findIndex((item) => item.contactId === member.contactId);
    const next = sorted[index + 1] ?? sorted[index - 1];
    setPending(true);
    setNotice(null);
    try {
      await client.removeMember(houseId, member.contactId);
      setLive((current) => {
        if (!current) return current;
        const members = current.house.members.filter((item) => item.contactId !== member.contactId);
        return { ...current, house: replaceMembers(current.house, members) };
      });
      if (next) focusElement(`house-edit-${next.contactId}`);
    } catch (caught) {
      const copy = caught instanceof MissioApiError ? houseErrorCopy(caught) : "That didn’t work. Try again.";
      setNotice(copy);
      if (needsQuietRefresh(caught)) await refreshHouse().catch(() => undefined);
    } finally {
      setPending(false);
    }
  }

  async function add(person: MissioPerson) {
    setPending(true);
    setNotice(null);
    try {
      const result = await client.addMember(houseId, { contactId: person.contactId, role });
      setLive((current) => {
        if (!current) return current;
        const without = current.house.members.filter((item) => item.contactId !== result.member.contactId);
        return { ...current, house: replaceMembers(current.house, [...without, result.member]) };
      });
      focusElement(`house-edit-${result.member.contactId}`);
    } catch (caught) {
      setNotice(caught instanceof MissioApiError ? houseErrorCopy(caught) : "That didn’t work. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function setCoach(contactId: string, on: boolean) {
    setPending(true);
    setNotice(null);
    try {
      const result = await client.setCoach(houseId, contactId, on);
      setLive((current) => (current ? { ...current, house: { ...current.house, coaches: result.coaches } } : current));
      focusElement("house-coach-change");
    } catch (caught) {
      setNotice(caught instanceof MissioApiError ? houseErrorCopy(caught) : "That didn’t work. Try again.");
    } finally {
      setPending(false);
    }
  }

  const house = live?.house ?? null;
  const canWrite = live?.canWrite ?? false;
  // Coaches can change roles and end memberships in houses they coach.
  const canEdit = live?.canEdit ?? false;
  const members = house ? sortMembers(house.members) : [];

  return (
    <div className={`${content.page} ${styles.root}`}>
      <AllHousesLink />
      {!house && state.phase === "loading" ? (
        <div className={shell.state} data-state="loading" role="status">
          Loading this house…
        </div>
      ) : null}
      {!house && state.phase === "error" ? (
        <HouseStatus error={state.error} fallback="This house didn’t load." onRetry={retry} />
      ) : null}
      {house ? (
        <>
          <header className={styles.houseHead}>
            <div className={styles.houseHeadText}>
              {house.name?.trim() ? <p className={`${shell.eyebrow} ${content.eyebrow}`}>House {house.number}</p> : null}
              <h1 className={content.title}>{houseTitle(house)}</h1>
              <p className={styles.houseWhere}>
                {meetingDayLabel(house.meetingDay) ? <span>{meetingDayLabel(house.meetingDay)}s</span> : null}
                {house.location?.trim() ? <span>{house.location.trim()}</span> : null}
                <CampusTag campus={house.campus} />
              </p>
            </div>
            {canWrite ? (
              <a href="#house-add" className={`${shell.primary} ${styles.headAction}`}>
                Add a person
              </a>
            ) : null}
          </header>

          <div className={styles.houseCards}>
            <section className={styles.panel} data-testid="house-leading">
              <h2>Leading</h2>
              <LeadingList title="Leaders" role="leader" people={house.leaders} members={house.members} linkProfile={canWrite} />
              <LeadingList title="Co-leaders" role="co_leader" people={house.coLeaders} members={house.members} linkProfile={canWrite} />
              <CoachRow
                coaches={house.coaches}
                canWrite={canWrite}
                pending={pending}
                people={people}
                onSet={(contactId, on) => void setCoach(contactId, on)}
              />
            </section>
            <section className={styles.panel} data-testid="house-health">
              <h2>Health</h2>
              <div className={styles.size}>
                <span className={styles.sizeCount}>{house.memberCount}</span>
                <span className={styles.sizeLabel}>{peopleCount(house.memberCount).replace(/^\d+\s/, "")}</span>
              </div>
              <SizeDots count={house.memberCount} />
              <HealthNote house={house} />
            </section>
          </div>

          {house.leaderNotes?.trim() ? (
            <section className={styles.block}>
              <h2>Leader notes</h2>
              <p className={`${shell.lede} ${content.lede}`}>{house.leaderNotes.trim()}</p>
            </section>
          ) : null}
          {notice ? (
            <p className={shell.alert} role="alert" tabIndex={-1} ref={errorRef} id="house-action-error">
              {notice}
            </p>
          ) : null}
          <section className={`${styles.block} ${styles.members}`}>
            <h2>People in this house</h2>
            {members.length === 0 ? <p className={styles.line}>No one is in this house yet.</p> : null}
            {members.length > 0 ? (
              <ul className={styles.memberList} data-testid="house-members">
                {members.map((member) => (
                  <MemberRow
                    key={member.contactId}
                    member={member}
                    canWrite={canEdit}
                    linkProfile={canWrite}
                    pending={pending}
                    onRole={(next) => void changeRole(member, next)}
                    onRemove={() => void remove(member)}
                  />
                ))}
              </ul>
            ) : null}
          </section>
          {canWrite ? (
            <section className={styles.block} data-testid="add-member" id="house-add">
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

function LeadingList({
  title,
  role,
  people,
  members,
  linkProfile,
}: {
  title: string;
  role: HouseRole;
  people: PersonRef[];
  members: HouseMember[];
  linkProfile: boolean;
}) {
  return (
    <div className={styles.leadingGroup}>
      <h3>{title}</h3>
      {people.length === 0 ? (
        <p className={styles.quiet}>No one yet</p>
      ) : (
        <ul className={styles.leadingList}>
          {people.map((person) => {
            const since = members.find((member) => member.contactId === person.contactId)?.startedAt;
            const href = linkProfile ? personHref(person) : null;
            return (
              <li key={person.contactId}>
                <span className={styles.face} aria-hidden="true">
                  {initialsOf(person.displayName)}
                </span>
                <span>
                  {href ? (
                    <Link href={href} className={styles.personLink}>
                      {person.displayName}
                    </Link>
                  ) : (
                    <span className={styles.leadingName}>{person.displayName}</span>
                  )}
                  <span className={styles.leadingRole}>
                    {ROLE_LABEL[role]}
                    {since ? ` · since ${formatJoined(since)}` : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CoachRow({
  coaches,
  canWrite,
  pending,
  people,
  onSet,
}: {
  coaches: CoachRef[];
  canWrite: boolean;
  pending: boolean;
  people: Pick<MissioClient, "listPeople">;
  onSet: (contactId: string, on: boolean) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  return (
    <div className={styles.leadingGroup} data-testid="house-coach">
      <h3>{coaches.length > 1 ? "Coaches" : "Coached by"}</h3>
      {coaches.length === 0 ? <p className={styles.quiet}>No coach yet</p> : null}
      {coaches.length > 0 ? (
        <ul className={styles.leadingList}>
          {coaches.map((coach) => {
            const href = canWrite ? personHref(coach) : null;
            return (
              <li key={coach.contactId} className={styles.coachLine}>
                <span className={styles.coachWho}>
                  <span className={styles.face} aria-hidden="true">
                    {initialsOf(coach.displayName)}
                  </span>
                  <span>
                    {href ? (
                      <Link href={href} className={styles.personLink}>
                        {coach.displayName}
                      </Link>
                    ) : (
                      <span className={styles.leadingName}>{coach.displayName}</span>
                    )}
                    <span className={styles.leadingRole}>
                      Coach{coach.since ? ` · since ${formatJoined(coach.since)}` : ""}
                    </span>
                  </span>
                </span>
                {canWrite ? (
                  <button
                    type="button"
                    className={shell.textButton}
                    disabled={pending}
                    aria-label={`Remove ${coach.displayName} as coach`}
                    onClick={() => onSet(coach.contactId, false)}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {canWrite ? (
        <button
          type="button"
          id="house-coach-change"
          className={`${shell.textButton} ${styles.addCoach}`}
          aria-expanded={choosing}
          onClick={() => setChoosing((open) => !open)}
        >
          {coaches.length > 0 ? "Add another coach" : "Choose a coach"}
        </button>
      ) : null}
      {canWrite && choosing ? (
        <div className={styles.coachPick}>
          <PeoplePicker
            people={people}
            pending={pending}
            label="Search Missio people"
            onPick={(person) => {
              setChoosing(false);
              onSet(person.contactId, true);
            }}
          />
          <p className={styles.quiet}>A coach is pastoral covering for the leaders. Nothing waits on them.</p>
        </div>
      ) : null}
    </div>
  );
}

/** One sentence on where the house stands, built from the same signals as the grid. */
function HealthNote({ house }: { house: HouseDetail }) {
  const signals = houseSignals(house);
  let sentence = "Healthy size, with a leader and co-leader in place.";
  if (signals.includes("ready")) {
    sentence = "The house is full and a co-leader is in place. This is the moment to talk about sending some people out.";
  } else if (signals.includes("no_leader")) {
    sentence = "This house has no leader yet. Add one below.";
  } else if (signals.includes("no_co_leader")) {
    sentence = "No co-leader yet. A co-leader is who leads the next house.";
  } else if (house.memberCount === 0) {
    sentence = "No one is in this house yet.";
  } else if (house.memberCount < MULTIPLY_AT) {
    sentence = `Room to grow. At ${MULTIPLY_AT} people with a co-leader, it’s ready to multiply.`;
  }
  return (
    <>
      {signals.length > 0 ? (
        <div className={styles.signals}>
          {signals.map((signal) => (
            <span key={signal} className={`${styles.signal} ${signal === "ready" ? styles.signalReady : styles.signalWarn}`}>
              {SIGNAL_LABEL[signal]}
            </span>
          ))}
        </div>
      ) : null}
      <p className={styles.healthNote}>{sentence}</p>
    </>
  );
}

/** The name opens the person card over the house page. */
function PersonName({ member }: { member: HouseMember }) {
  const [open, setOpen] = useState(false);
  const personId = member.orgPersonId?.trim();
  if (!personId) return <span className={shell.personName}>{member.displayName}</span>;
  return (
    <>
      <button
        type="button"
        className={`${shell.personName} ${styles.personLink} ${shell.personOpen}`}
        onClick={() => setOpen(true)}
      >
        {member.displayName}
      </button>
      {open ? <PersonCardDialog personId={personId} name={member.displayName} onClose={() => setOpen(false)} /> : null}
    </>
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

function MemberRow({
  member,
  canWrite,
  linkProfile,
  pending,
  onRole,
  onRemove,
}: {
  member: HouseMember;
  canWrite: boolean;
  /** Profiles are pastors only for now, so only pastors get the link. */
  linkProfile: boolean;
  pending: boolean;
  onRole: (role: HouseRole) => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className={styles.memberRow}>
      <div className={styles.memberName}>
        <span className={styles.face} aria-hidden="true">
          {initialsOf(member.displayName)}
        </span>
        {linkProfile ? <PersonName member={member} /> : <span className={shell.personName}>{member.displayName}</span>}
      </div>
      {canWrite ? (
        <div className={styles.memberEdit}>
        <Popover
          onOpenChange={(open) => {
            if (!open) setConfirming(false);
          }}
        >
          <PopoverTrigger asChild>
            <button type="button" className={shell.textButton} id={`house-edit-${member.contactId}`} aria-label={`Edit ${member.displayName}`}>
              Edit
            </button>
          </PopoverTrigger>
          <PopoverContent className={portaledMissioClass()} style={missioSkinVars()} align="end">
            <p className={styles.menuTitle}>{member.displayName}</p>
            <label className={shell.field}>
              Role
              <RoleSelect member={member} disabled={pending} onRole={onRole} />
            </label>
            {confirming ? (
              <div className={styles.menuActions}>
                <p className={styles.confirmCopy}>Remove {member.displayName} from this house?</p>
                <button
                  type="button"
                  className={shell.primary}
                  disabled={pending}
                  aria-label={`Confirm remove ${member.displayName}`}
                  onClick={onRemove}
                >
                  Remove
                </button>
                <button type="button" className={shell.ghost} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className={styles.menuActions}>
                <button
                  type="button"
                  className={shell.ghost}
                  disabled={pending}
                  aria-label={`Remove ${member.displayName} from house`}
                  onClick={() => setConfirming(true)}
                >
                  Remove from house
                </button>
              </div>
            )}
          </PopoverContent>
        </Popover>
        </div>
      ) : null}
      <div className={styles.memberMeta}>
        <span className={`${shell.tag} ${member.role === "member" ? shell.tagQuiet : ""}`}>{ROLE_LABEL[member.role]}</span>
        {member.startedAt ? <span className={styles.quiet}>Since {formatJoined(member.startedAt)}</span> : null}
      </div>
    </li>
  );
}
