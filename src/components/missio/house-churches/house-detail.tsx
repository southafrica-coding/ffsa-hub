"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CAMPUS_LABEL, formatJoined, missioSkinVars } from "../access";
import { MissioApiError, missioClient, type MissioClient } from "../api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import shell from "../shell.module.css";
import type { MissioPerson } from "../types-shim";
import { houseChurchesClient, houseErrorCopy, type HouseChurchesClient } from "./client";
import {
  houseSignals,
  houseTitle,
  initialsOf,
  MULTIPLY_AT,
  meetingDayLabel,
  sizeWord,
  personHref,
  ROLE_LABEL,
  SIGNAL_LABEL,
  sortMembers,
} from "./format";
import { SizeDots } from "./house-grid";
import { PersonCardDialog } from "../person-card";
import { HouseFeedbackPanel } from "../feedback/history";
import { useMissioLoad } from "./load";
import { PeoplePicker } from "./people-picker";
import { HouseStatus } from "./status";
import type { CoachRef, HouseDetail, HouseMember, HouseRole, PersonRef } from "./types";
import styles from "./house-churches.module.css";
import hd from "./house-detail.module.css";
import ui from "./ui.module.css";

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

  const ready = house ? houseSignals(house).includes("ready") : false;
  const newCount = members.filter((member) => isRecent(member.startedAt)).length;

  return (
    <div className={`${ui.root} ${hd.page}`}>
      <Link href="/missio/house-churches" className={hd.back}>
        ← House churches
      </Link>
      {!house && state.phase === "loading" ? (
        <div className={`${ui.card} ${hd.state}`} data-state="loading" role="status">
          Loading this house…
        </div>
      ) : null}
      {!house && state.phase === "error" ? (
        <HouseStatus error={state.error} fallback="This house didn’t load." onRetry={retry} />
      ) : null}
      {house ? (
        <>
          <header className={hd.head}>
            <div className={hd.headText}>
              {house.name?.trim() ? <p className={hd.number}>House {house.number}</p> : null}
              <h1 className={`${ui.serif} ${hd.title}`}>{houseTitle(house)}</h1>
              <p className={hd.where}>
                {meetingDayLabel(house.meetingDay) ? (
                  <span className={hd.whereItem}>
                    <CalendarIcon />
                    {meetingDayLabel(house.meetingDay)}s
                  </span>
                ) : null}
                {house.location?.trim() ? (
                  <span className={hd.whereItem}>
                    <PinIcon />
                    {house.location.trim()}
                  </span>
                ) : null}
                <span className={ui.tag}>{CAMPUS_LABEL[house.campus]}</span>
              </p>
            </div>
            {canWrite ? (
              <a href="#house-add" className={`${ui.btn} ${ui.p} ${hd.headAction}`} aria-label="Add a person">
                <PlusIcon />
                <span className={hd.headActionText}>Add a person</span>
              </a>
            ) : null}
          </header>

          <div className={hd.layout}>
            <section className={`${ui.card} ${hd.leading}`} data-testid="house-leading">
              <h2 className={`${ui.sect} ${hd.sect}`}>Leading</h2>
              <LeadingList role="leader" people={house.leaders} members={house.members} linkProfile={canWrite} />
              <LeadingList role="co_leader" people={house.coLeaders} members={house.members} linkProfile={canWrite} />
              <CoachRow
                coaches={house.coaches}
                canWrite={canWrite}
                pending={pending}
                people={people}
                onSet={(contactId, on) => void setCoach(contactId, on)}
              />
            </section>

            <section className={`${ui.card} ${hd.health} ${ready ? hd.healthReady : ""}`} data-testid="house-health">
              <div className={hd.healthHead}>
                <h2 className={`${ui.sect} ${hd.sect}`}>Health</h2>
              </div>
              <div className={hd.size}>
                <span className={`${ui.num} ${hd.sizeCount}`}>{house.memberCount}</span>
                <span className={hd.sizeLabel}>{sizeWord(house)}</span>
              </div>
              <div className={hd.dots}>
                <SizeDots count={house.memberCount} leaders={house.leaders.length + house.coLeaders.length} />
              </div>
              <HealthNote house={house} />
            </section>

            <div className={hd.feedback}>
              <HouseFeedbackPanel houseId={house.id} client={client} canRotate={canWrite} />
            </div>

            <section className={hd.people}>
              <div className={hd.peopleHead}>
                <h2 className={`${ui.serif} ${hd.peopleTitle}`}>People in this house</h2>
                <span className={hd.peopleCount}>
                  {members.length}
                  {newCount > 0 ? ` · ${newCount} new` : ""}
                </span>
              </div>
              {notice ? (
                <p className={hd.alert} role="alert" tabIndex={-1} ref={errorRef} id="house-action-error">
                  {notice}
                </p>
              ) : null}
              {members.length === 0 ? <p className={`${ui.card} ${hd.state}`}>No one is in this house yet.</p> : null}
              {members.length > 0 ? (
                <div className={`${ui.card} ${hd.table}`}>
                  <div className={hd.thead} aria-hidden="true">
                    <span>Name</span>
                    <span>Role</span>
                    <span>In this house since</span>
                    <span />
                  </div>
                  <ul className={hd.rows} data-testid="house-members">
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
                </div>
              ) : null}
            </section>

            {house.leaderNotes?.trim() ? (
              <section className={`${ui.card} ${hd.notes}`}>
                <h2 className={`${ui.sect} ${hd.sect}`}>Leader notes</h2>
                <p>{house.leaderNotes.trim()}</p>
              </section>
            ) : null}

            {canWrite ? (
              <section className={`${ui.card} ${hd.add}`} data-testid="add-member" id="house-add">
                <h2 className={`${ui.serif} ${hd.addTitle}`}>Add someone</h2>
                <p className={ui.help}>Choose a role, then search the people list.</p>
                <label className={ui.field}>
                  Role
                  <select
                    className={ui.input}
                    aria-label="Role for the new person"
                    value={role}
                    onChange={(event) => setRole(event.target.value as HouseRole)}
                  >
                    <option value="leader">Leader</option>
                    <option value="co_leader">Co-leader</option>
                    <option value="member">Member</option>
                  </select>
                </label>
                <PeoplePicker people={people} pending={pending} onPick={(person) => void add(person)} />
              </section>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

const RECENT_DAYS = 30;

/** Joined in the last 30 days. Drives the "new" count only; it never invents a status. */
function isRecent(startedAt: string | null): boolean {
  if (!startedAt) return false;
  const at = Date.parse(startedAt);
  if (Number.isNaN(at)) return false;
  return Date.now() - at <= RECENT_DAYS * 24 * 60 * 60 * 1000;
}

const TINTS = ["a1", "a2", "a3", "a4", "a5"] as const;

function Avatar({ id, name, small = false }: { id: string; name: string; small?: boolean }) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const tint = TINTS[hash % TINTS.length];
  return (
    <span className={`${ui.av} ${small ? ui.avSm : ""} ${ui[tint]}`} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

function LeadingList({
  role,
  people,
  members,
  linkProfile,
}: {
  role: HouseRole;
  people: PersonRef[];
  members: HouseMember[];
  linkProfile: boolean;
}) {
  if (people.length === 0) {
    return (
      <p className={hd.nobody}>
        <span className={`${ui.av} ${hd.emptyFace}`} aria-hidden="true">
          ?
        </span>
        {role === "leader" ? "No leader yet" : "No co-leader yet"}
      </p>
    );
  }
  return (
    <ul className={hd.leaders}>
      {people.map((person) => {
        const since = members.find((member) => member.contactId === person.contactId)?.startedAt;
        const href = linkProfile ? personHref(person) : null;
        return (
          <li key={person.contactId} className={hd.leader}>
            <Avatar id={person.contactId} name={person.displayName} />
            <span className={hd.leaderText}>
              {href ? (
                <Link href={href} className={hd.leaderName}>
                  {person.displayName}
                </Link>
              ) : (
                <span className={hd.leaderName}>{person.displayName}</span>
              )}
              <span className={hd.leaderRole}>
                {ROLE_LABEL[role]}
                {since ? ` · since ${formatJoined(since)}` : ""}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
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
    <div className={hd.coach} data-testid="house-coach">
      <div className={hd.coachLine}>
        {coaches.length > 0 ? (
          <span className={hd.stack}>
            {coaches.map((coach) => (
              <Avatar key={coach.contactId} id={coach.contactId} name={coach.displayName} small />
            ))}
          </span>
        ) : null}
        <div className={hd.coachText}>
          <h3 className={hd.coachLabel}>{coaches.length > 1 ? "Coaches" : "Coached by"}</h3>{" "}
          {coaches.length === 0 ? <span className={ui.ink2}>No coach yet</span> : null}
          {coaches.length > 0 ? (
            <ul className={hd.coachNames}>
              {coaches.map((coach) => {
                const href = canWrite ? personHref(coach) : null;
                return (
                  <li key={coach.contactId}>
                    {href ? (
                      <Link href={href} className={hd.coachName}>
                        {coach.displayName}
                      </Link>
                    ) : (
                      <b className={hd.coachName}>{coach.displayName}</b>
                    )}
                    {coach.since ? <span className={ui.ink2}> · since {formatJoined(coach.since)}</span> : null}
                    {canWrite ? (
                      <button
                        type="button"
                        className={hd.textButton}
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
        </div>
      </div>
      {canWrite ? (
        <button
          type="button"
          id="house-coach-change"
          className={`${hd.textButton} ${hd.coachChange}`}
          aria-expanded={choosing}
          onClick={() => setChoosing((open) => !open)}
        >
          {coaches.length > 0 ? "Add another coach" : "Choose a coach"}
        </button>
      ) : null}
      {canWrite && choosing ? (
        <div className={hd.coachPick}>
          <PeoplePicker
            people={people}
            pending={pending}
            label="Search Missio people"
            onPick={(person) => {
              setChoosing(false);
              onSet(person.contactId, true);
            }}
          />
          <p className={ui.help}>A coach is pastoral covering for the leaders. Nothing waits on them.</p>
        </div>
      ) : null}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3.5V7M16 3.5V7M4 10h16" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z" />
      <circle cx="12" cy="11" r="2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** One sentence on where the house stands, built from the same signals as the grid. */
function HealthNote({ house }: { house: HouseDetail }) {
  const signals = houseSignals(house);
  let sentence = "Healthy size, with a leader and co-leader in place.";
  if (signals.includes("ready")) {
    sentence = "The house is full and someone is ready to lead. This is the moment to talk about sending some people out.";
  } else if (signals.includes("no_leader")) {
    sentence = "This house has no leader yet. Add one below.";
  } else if (signals.includes("no_co_leader")) {
    sentence = "No co-leader yet. A co-leader is who leads the next house.";
  } else if (house.memberCount === 0) {
    sentence = "No one is in this house yet.";
  } else if (house.memberCount < MULTIPLY_AT) {
    sentence = `Room to grow. At ${MULTIPLY_AT} people, with someone ready to lead, it’s ready to multiply.`;
  }
  return (
    <>
      {signals.length > 0 ? (
        <div className={hd.signals}>
          {signals.map((signal) => (
            <span key={signal} className={`${ui.chip} ${signal === "ready" ? hd.readyChip : ui.cGold}`}>
              {SIGNAL_LABEL[signal]}
            </span>
          ))}
        </div>
      ) : null}
      <p className={hd.healthNote}>
        {signals.length > 0 ? <b className={signals[0] === "ready" ? hd.leadReady : hd.leadWarn}>{SIGNAL_LABEL[signals[0]]}.</b> : null}{" "}
        {sentence}
      </p>
    </>
  );
}

/** The name opens the person card over the house page. */
function PersonName({ member }: { member: HouseMember }) {
  const [open, setOpen] = useState(false);
  const personId = member.orgPersonId?.trim();
  if (!personId) return <span className={hd.memberName}>{member.displayName}</span>;
  return (
    <>
      <button
        type="button"
        className={`${hd.memberName} ${hd.memberOpen}`}
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
    <li className={hd.row}>
      <div className={hd.cellName}>
        <Avatar id={member.contactId} name={member.displayName} small />
        <span className={hd.nameStack}>
          {linkProfile ? <PersonName member={member} /> : <span className={hd.memberName}>{member.displayName}</span>}
          <span className={hd.metaPhone}>
            {ROLE_LABEL[member.role]}
            {member.startedAt ? ` · since ${formatJoined(member.startedAt)}` : ""}
          </span>
        </span>
      </div>
      <span className={hd.cellRole}>{ROLE_LABEL[member.role]}</span>
      <span className={hd.cellSince}>{member.startedAt ? formatJoined(member.startedAt) : "—"}</span>
      <div className={hd.cellEdit}>
        {canWrite ? (
          <Popover
            onOpenChange={(open) => {
              if (!open) setConfirming(false);
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className={hd.more}
                id={`house-edit-${member.contactId}`}
                aria-label={`Edit ${member.displayName}`}
              >
                ···
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
        ) : null}
      </div>
    </li>
  );
}
