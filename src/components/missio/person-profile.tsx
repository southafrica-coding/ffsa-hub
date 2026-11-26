"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { JourneyEvent, PersonProfile, ProfileHouse } from "@/lib/missio/profile";
import { isMissioPastor, STATUS_LABEL } from "./access";
import { fetchHubAccess, fetchPersonProfile, MissioApiError, missioClient, saveHubRole, type MissioClient } from "./api";
import { EditPerson } from "./people-directory";
import type { MissioPerson } from "./types-shim";
import type { HubAccess } from "@/lib/missio/hub-access";
import content from "./content.module.css";
import { houseTitle, ROLE_LABEL } from "./house-churches/format";
import { useMissioLoad } from "./house-churches/load";
import { HouseStatus } from "./house-churches/status";
import { telHref, whatsAppHref } from "./follow-up/whatsapp";
import { whatsAppE164 } from "@/lib/missio/whatsapp/phone";
import { whatsAppThreadHref } from "./whatsapp/client";
import { useMissioViewer } from "./viewer";
import { householdsClient, type HouseholdsClient } from "./households/client";
import { HouseholdCard } from "./households/household-card";
import { ProfileCoupleSuggestion } from "./households/couple-suggestions";
import { suggestionsClient, type SuggestionsClient } from "./households/suggestions-client";
import shell from "./shell.module.css";
import styles from "./person-profile.module.css";

type Filter = "all" | "houses" | "follow_up";

const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "houses", label: "Houses" },
  { id: "follow_up", label: "Follow-up" },
];

const VISIT_LABEL = { first_time: "First time", been_a_while: "Been a while", regular: "Regular" } as const;

const dayFormat = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const monthFormat = new Intl.DateTimeFormat("en-ZA", { month: "short", year: "numeric", timeZone: "UTC" });

function asDate(value: string): Date | null {
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function journeyDate(value: string): string {
  const date = asDate(value);
  return date ? dayFormat.format(date) : "";
}

export function since(value: string): string {
  const date = asDate(value);
  return date ? monthFormat.format(date) : "";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

function inFilter(event: JourneyEvent, filter: Filter): boolean {
  if (filter === "all") return true;
  const house = event.type === "joined_house" || event.type === "left_house" || event.type === "next_leader";
  if (filter === "houses") return house;
  return !house && event.type !== "added";
}

/** The headline and the quiet line for one journey step. */
export function journeyCopy(event: JourneyEvent): { title: string; detail: string | null; houseId?: string } {
  switch (event.type) {
    case "added":
      return { title: "Added to Missio", detail: null };
    case "joined_house": {
      const title = event.role === "member" ? "Joined" : `Became ${ROLE_LABEL[event.role].toLowerCase()} of`;
      return { title: `${title} ${houseTitle(event)}`, detail: null, houseId: event.houseId };
    }
    case "left_house":
      return { title: `Left ${houseTitle(event)}`, detail: null, houseId: event.houseId };
    case "followup_stage":
      if (event.stage === "contacted") return { title: "Contacted", detail: "Follow-up" };
      if (event.stage === "visited_house") return { title: "Visited a house church", detail: "Follow-up" };
      if (event.stage === "joined") return { title: "Follow-up closed", detail: "Joined a house church" };
      return { title: "Follow-up opened", detail: null };
    case "followup_note":
      return { title: "Follow-up note", detail: event.note };
    case "next_leader": {
      const where = houseTitle(event);
      if (event.stage === "spotted") return { title: "Spotted as a next leader", detail: where };
      if (event.stage === "in_training") return { title: event.trainer ? `In training with ${event.trainer}` : "In training to lead", detail: where };
      return { title: "Ready to lead", detail: where };
    }
    case "connect_card": {
      const parts: string[] = [];
      if (event.visitType) parts.push(VISIT_LABEL[event.visitType]);
      if (event.wantsHouseChurch) parts.push("would like a house church");
      if (event.wantsPrayer) parts.push("asked for prayer");
      return { title: "Filled in a connect card", detail: parts.length > 0 ? parts.join(" · ") : null };
    }
  }
}

export type AccessClient = {
  get: (id: string) => Promise<HubAccess>;
  set: (id: string, role: "coach" | "house_church_leader", on: boolean) => Promise<HubAccess>;
};

export const defaultAccess: AccessClient = {
  get: (id) => fetchHubAccess(id),
  set: (id, role, on) => saveHubRole(id, role, on),
};

export function PersonProfileView({
  personId,
  load = fetchPersonProfile,
  access = defaultAccess,
  households = householdsClient,
  suggestions = suggestionsClient,
  people = missioClient,
}: {
  personId: string;
  load?: (id: string) => Promise<PersonProfile>;
  access?: AccessClient;
  households?: HouseholdsClient;
  /** Couple suggestions from the house church sheet (pastors). */
  suggestions?: SuggestionsClient;
  /** Edit and mark inactive (the ··· menu). */
  people?: MissioClient;
}) {
  const { state, retry } = useMissioLoad(() => load(personId), [personId, load]);
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState(false);
  const [reviving, setReviving] = useState(false);
  // Bumped after a suggestion is linked, so the household card reloads.
  const [familyKey, setFamilyKey] = useState(0);
  const reload = retry;

  async function makeActive(person: MissioPerson) {
    setReviving(true);
    try {
      await people.updatePerson(person.id, { status: "active" });
      reload();
    } finally {
      setReviving(false);
    }
  }

  return (
    <div className={`${content.page} ${styles.root}`}>
      <div className={styles.topRow}>
        <Link href="/missio/people" className={styles.back}>
          <span aria-hidden="true">←</span> People
        </Link>
        {state.phase === "ready" ? (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnS} ${styles.btnIc} ${styles.phoneMore}`}
            aria-label="More: edit, mark inactive"
            onClick={() => setEditing(true)}
          >
            ···
          </button>
        ) : null}
      </div>
      {state.phase === "loading" ? (
        <div className={shell.state} data-state="loading" role="status">
          Loading person…
        </div>
      ) : null}
      {state.phase === "error" ? (
        <HouseStatus error={state.error} fallback="This person didn’t load." onRetry={retry} />
      ) : null}
      {state.phase === "ready" && state.data.person.status === "inactive" ? (
        <div className={styles.inactive} data-testid="profile-inactive">
          <span>
            <b>Inactive.</b>{" "}
            <span className={styles.ink2}>
              They stay on their houses’ history and in reports for the time they were here. They don’t appear in counts or nudges.
            </span>
          </span>
          <button type="button" className={`${styles.btn} ${styles.btnS} ${styles.sm}`} disabled={reviving} onClick={() => void makeActive(state.data.person)}>
            Make active
          </button>
        </div>
      ) : null}
      {state.phase === "ready" ? (
        <Profile
          profile={state.data}
          filter={filter}
          onFilter={setFilter}
          onMore={() => setEditing(true)}
          family={
            <>
              <ProfileCoupleSuggestion personId={personId} client={suggestions} onLinked={() => setFamilyKey((key) => key + 1)} />
              <HouseholdCard key={familyKey} personId={personId} name={state.data.person.name} client={households} />
            </>
          }
          aside={<HubAccessCard personId={personId} name={state.data.person.name} client={access} />}
        />
      ) : null}
      {editing && state.phase === "ready" ? (
        <EditPerson
          person={state.data.person}
          client={people}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
          onNotFound={reload}
        />
      ) : null}
    </div>
  );
}

const STATUS_CHIP: Record<MissioPerson["status"], string> = {
  active: styles.cOlive,
  visitor: styles.cGold,
  inactive: styles.cSub,
};

const CAMPUS_SHORT: Record<MissioPerson["campus"], string> = { potch: "Potch", jhb: "JHB" };

function Profile({
  profile,
  filter,
  onFilter,
  onMore,
  family,
  aside,
}: {
  profile: PersonProfile;
  filter: Filter;
  onFilter: (filter: Filter) => void;
  onMore: () => void;
  /** The household card. First under the header, so family is seen without scrolling on a phone. */
  family?: React.ReactNode;
  aside: React.ReactNode;
}) {
  const { person, contact, houses, journey } = profile;
  const current = houses.filter((house) => !house.endedAt);
  const past = houses.filter((house) => house.endedAt);
  const shown = journey.filter((event) => inFilter(event, filter));
  const summary = current.map((house) => `${ROLE_LABEL[house.role]} of ${houseTitle(house)}`).join(" · ");

  return (
    <>
      <header className={styles.head} data-testid="profile-head">
        <Avatar id={person.id} name={person.name} large />
        <div className={styles.headText}>
          <h1 className={styles.name}>{person.name || "No name"}</h1>
          <p className={styles.tags}>
            <span className={`${styles.chip} ${STATUS_CHIP[person.status]}`} data-status={person.status}>
              <span className={styles.dot} />
              {STATUS_LABEL[person.status]}
            </span>
            {summary ? <span className={`${styles.headSummary} ${styles.ink2}`}>{summary}</span> : null}
            <span className={styles.tag}>{CAMPUS_SHORT[person.campus]}</span>
          </p>
        </div>
        <div className={styles.headActions}>
          <ContactActions phone={contact.phone} email={contact.email} personId={person.id} />
          <button type="button" className={`${styles.btn} ${styles.btnS} ${styles.btnIc}`} aria-label="More: edit, mark inactive" onClick={onMore}>
            ···
          </button>
        </div>
      </header>

      <div className={styles.cols}>
        <div className={styles.side}>
          {family}
          <section className={`${styles.card} ${styles.flush}`} data-testid="profile-belongs">
            <h2 className={styles.sect}>Belongs to</h2>
            {current.length === 0 ? (
              <div className={styles.lrow}>
                <span className={`${styles.rowIcon} ${styles.iconTerra}`} aria-hidden="true">
                  <HouseIcon />
                </span>
                <span className={styles.lrowText}>
                  <span className={`${styles.nm} ${styles.terraInk}`}>Not in a house yet</span>
                  <span className={styles.meta}>A pastor places people from Follow-up.</span>
                </span>
              </div>
            ) : (
              <ul className={styles.rows}>
                {current.map((house) => (
                  <HouseRow key={house.membershipId} house={house} />
                ))}
              </ul>
            )}
            {past.length > 0 ? (
              <>
                <h3 className={styles.sect}>Before</h3>
                <ul className={styles.rows}>
                  {past.map((house) => (
                    <HouseRow key={house.membershipId} house={house} />
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          <section className={styles.card} data-testid="profile-contact">
            <h2 className={styles.visuallyHidden}>Details</h2>
            <dl className={styles.facts}>
              <dt>Phone</dt>
              <dd className={contact.phone ? styles.mono : styles.ink3}>
                {contact.phone ? <a href={telHref(contact.phone) ?? undefined}>{contact.phone}</a> : "Not on file"}
              </dd>
              <dt>Email</dt>
              <dd className={contact.email ? undefined : styles.ink3}>
                {contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : "Not on file"}
              </dd>
              {person.joinedAt ? (
                <>
                  <dt>Joined</dt>
                  <dd>{longDate(person.joinedAt)}</dd>
                </>
              ) : null}
              <dt>Campus</dt>
              <dd>{CAMPUS_SHORT[person.campus]}</dd>
            </dl>
          </section>

          {aside}
        </div>

        <section className={`${styles.card} ${styles.journey}`} data-testid="profile-journey">
          <div className={styles.journeyHead}>
            <h2>Journey</h2>
            <div className={styles.filters} role="group" aria-label="Show">
              {FILTERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`${styles.filter} ${filter === option.id ? styles.filterOn : ""}`}
                  aria-pressed={filter === option.id}
                  onClick={() => onFilter(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <p className={styles.quiet}>{journey.length === 0 ? "Nothing recorded yet." : "Nothing of that kind yet."}</p>
          ) : (
            <ol className={styles.timeline}>
              {shown.map((event, index) => {
                const copy = journeyCopy(event);
                const dot = stepDot(event);
                return (
                  <li key={event.id} className={styles.step} data-type={event.type}>
                    <span className={styles.tl} aria-hidden="true">
                      <span className={`${styles.tdot} ${dot.tone}`}>{dot.icon}</span>
                      {index < shown.length - 1 ? <span className={styles.tline} /> : null}
                    </span>
                    <div className={styles.tbody}>
                      <p className={styles.tt}>
                        {copy.houseId ? <Link href={`/missio/house-churches/${copy.houseId}`}>{copy.title}</Link> : copy.title}
                      </p>
                      {copy.detail ? <p className={styles.stepDetail}>{copy.detail}</p> : null}
                      <time className={styles.td} dateTime={event.at}>
                        {journeyDate(event.at)}
                      </time>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}

const longFormat = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function longDate(value: string): string {
  const date = asDate(value);
  return date ? longFormat.format(date) : "";
}

function stepDot(event: JourneyEvent): { tone: string; icon: React.ReactNode } {
  switch (event.type) {
    case "joined_house":
      return { tone: styles.tOlive, icon: event.role === "member" ? <CheckIcon /> : <HouseIcon /> };
    case "left_house":
      return { tone: styles.tSub, icon: <HouseIcon /> };
    case "followup_stage":
      if (event.stage === "visited_house") return { tone: styles.tGold, icon: <PinIcon /> };
      if (event.stage === "joined") return { tone: styles.tOlive, icon: <CheckIcon /> };
      return { tone: styles.tLink, icon: <ChatIcon /> };
    case "followup_note":
      return { tone: styles.tSub, icon: "✎" };
    case "next_leader":
      return { tone: styles.tGold, icon: <SproutIcon /> };
    case "connect_card":
    case "added":
      return { tone: styles.tTerra, icon: <PlusIcon /> };
  }
}

/** Five tints by person id (board M1b), the same everywhere. */
export function Avatar({ id, name, large = false }: { id: string; name: string; large?: boolean }) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const tint = [styles.a1, styles.a2, styles.a3, styles.a4, styles.a5][hash % 5];
  return (
    <span className={`${styles.avatar} ${large ? styles.avatarLg : ""} ${tint}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

function HouseRow({ house }: { house: ProfileHouse }) {
  const when = house.endedAt
    ? `${since(house.startedAt)} to ${since(house.endedAt)}`
    : `Since ${since(house.startedAt)}`;
  return (
    <li>
      <Link href={`/missio/house-churches/${house.houseId}`} className={`${styles.lrow} ${styles.row}`}>
        <span className={`${styles.rowIcon} ${house.endedAt ? styles.iconSub : styles.iconOlive}`} aria-hidden="true">
          <HouseIcon />
        </span>
        <span className={styles.lrowText}>
          <span className={`${styles.nm} ${styles.rowMain}`}>
            {houseTitle(house)} · {ROLE_LABEL[house.role]}
          </span>
          <span className={`${styles.meta} ${styles.rowMeta}`}>{when}</span>
        </span>
        <span className={styles.chev} aria-hidden="true">
          <ChevronIcon />
        </span>
      </Link>
    </li>
  );
}

/**
 * Call · WhatsApp · Email. For a pastor, WhatsApp opens the Hub conversation
 * and sends from Missio's number; for anyone else it stays a wa.me link that
 * sends from their own phone. No button when the number won't work on WhatsApp.
 */
export function ContactActions({ phone, email, personId }: { phone: string | null; email: string | null; personId?: string }) {
  const me = useMissioViewer();
  const hub = Boolean(personId && me && isMissioPastor(me));
  const call = telHref(phone);
  const chat = hub ? (whatsAppE164(phone) ? whatsAppThreadHref({ personId: personId as string }) : null) : whatsAppHref(phone);
  if (!call && !chat && !email) return null;
  const count = [call, chat, email].filter(Boolean).length;
  return (
    <div className={styles.actions} data-testid="profile-actions" style={{ "--n": count } as React.CSSProperties}>
      {call ? (
        <a className={`${styles.btn} ${styles.btnS} ${styles.action}`} href={call}>
          <PhoneIcon />
          Call
        </a>
      ) : null}
      {chat && hub ? (
        <Link className={`${styles.btn} ${styles.btnP} ${styles.action} ${styles.actionMain}`} href={chat} data-whatsapp="hub">
          <ChatIcon />
          WhatsApp
        </Link>
      ) : chat ? (
        <a className={`${styles.btn} ${styles.btnP} ${styles.action} ${styles.actionMain}`} href={chat} target="_blank" rel="noopener noreferrer">
          <ChatIcon />
          WhatsApp
        </a>
      ) : null}
      {email ? (
        <a className={`${styles.btn} ${styles.btnS} ${styles.action}`} href={`mailto:${email}`}>
          <MailIcon />
          Email
        </a>
      ) : null}
    </div>
  );
}

function Svg({ children, size = 16 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

function HouseIcon() {
  return (
    <Svg>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </Svg>
  );
}

function CheckIcon() {
  return (
    <Svg>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  );
}

function PlusIcon() {
  return (
    <Svg>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

function PinIcon() {
  return (
    <Svg>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </Svg>
  );
}

function ChatIcon() {
  return (
    <Svg size={20}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </Svg>
  );
}

function PhoneIcon() {
  return (
    <Svg size={20}>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />
    </Svg>
  );
}

function MailIcon() {
  return (
    <Svg size={20}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </Svg>
  );
}

function SproutIcon() {
  return (
    <Svg>
      <path d="M12 21v-9" />
      <path d="M12 12c0-4 3-7 7-7 0 4-3 7-7 7Z" />
      <path d="M12 14c0-3-2.5-5.5-6-5.5 0 3 2.5 5.5 6 5.5Z" />
    </Svg>
  );
}

function ChevronIcon() {
  return (
    <Svg size={20}>
      <path d="m9 18 6-6-6-6" />
    </Svg>
  );
}

const ROLE_ROWS: ReadonlyArray<{ role: "coach" | "house_church_leader"; label: string; help: string }> = [
  { role: "coach", label: "Coach", help: "Sees the houses they coach and can change roles there." },
  { role: "house_church_leader", label: "House church leader", help: "Sees the house they lead or co-lead." },
];

/** Board M10c: a pastor gives someone with a Hub login a Missio role. */
export function HubAccessCard({ personId, name, client }: { personId: string; name: string; client: AccessClient }) {
  const [access, setAccess] = useState<HubAccess | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    client.get(personId).then(
      (value) => live && setAccess(value),
      () => live && setFailed(true)
    );
    return () => {
      live = false;
    };
  }, [client, personId]);

  async function toggle(role: "coach" | "house_church_leader", on: boolean) {
    setPending(true);
    setNotice(null);
    try {
      setAccess(await client.set(personId, role, on));
    } catch (caught) {
      setNotice(
        caught instanceof MissioApiError && caught.code === "no_login"
          ? "They don’t have a Hub login yet."
          : "That didn’t work. Try again."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.card} data-testid="profile-access">
      <h2>Hub access</h2>
      {failed ? <p className={styles.quiet}>Access didn’t load.</p> : null}
      {!access && !failed ? <p className={styles.quiet}>Checking…</p> : null}
      {access && !access.hasLogin ? (
        <p className={styles.quiet}>
          {name || "This person"} doesn’t have a Hub login yet. Once an FFSA admin invites them with the email on
          their contact, you can make them a coach or leader here.
        </p>
      ) : null}
      {access?.hasLogin ? (
        <>
          {access.roles.includes("pastor") ? <p className={styles.quiet}>Pastor. Pastors see everything.</p> : null}
          <ul className={styles.rows}>
            {ROLE_ROWS.map((row) => {
              const on = access.roles.includes(row.role);
              return (
                <li key={row.role} className={styles.accessRow}>
                  <label className={styles.accessLabel}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={pending}
                      onChange={(event) => void toggle(row.role, event.target.checked)}
                    />
                    <span>
                      <span className={styles.rowMain}>{row.label}</span>
                      <span className={styles.rowMeta}>{row.help}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p className={styles.quiet}>
            Which houses they see comes from the house pages: who leads, co-leads and coaches each one.
            {access.lastSignInAt ? ` Last signed in ${journeyDate(access.lastSignInAt)}.` : " They haven’t signed in yet."}
          </p>
        </>
      ) : null}
      {notice ? (
        <p className={styles.quiet} role="alert">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
