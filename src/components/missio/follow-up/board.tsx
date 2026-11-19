"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MissioApiError, missioClient, type MissioClient } from "../api";
import { missioFixedCopy, matchActionCopy, shouldRefetch } from "../errors";
import { houseChurchesClient, type HouseChurchesClient } from "../house-churches/client";
import { NoAccess } from "../shell";
import { accessStatus } from "../house-churches/status";
import content from "../content.module.css";
import shell from "../shell.module.css";
import { followUpClient, type FollowUpClient } from "./client";
import { AddHouseDialog } from "./add-house";
import { TimelineSheet } from "./timeline-sheet";
import {
  STAGE_LABEL,
  STAGES,
  VISIT_LABEL,
  formatWhen,
  leaderMatches,
  readStage,
} from "./format";
import { telHref, whatsAppHref } from "./whatsapp";
import type { FollowUpItem, FollowUpListResponse, FollowUpStage, PersonRef } from "./types";
import styles from "./follow-up.module.css";

let declineHiddenForSession = false;

export function resetMatchReviewSession() {
  declineHiddenForSession = false;
}

type Board = {
  /** Every stage's list, so the desktop board can show all four columns. */
  lists: Record<FollowUpStage, FollowUpItem[]>;
  canWrite: boolean;
  leaders: PersonRef[];
  stage: FollowUpStage;
  leader: string;
};

async function fetchBoard(client: FollowUpClient, stage: FollowUpStage, leader: string): Promise<Board> {
  const stages = STAGES;
  const leaderQuery = leader || null;
  const [lists, leaderPage] = await Promise.all([
    Promise.all(stages.map((item) => client.list({ stage: item, leader: leaderQuery }))),
    client.leaders(),
  ]);
  const byStage: Record<FollowUpStage, FollowUpItem[]> = { new: [], contacted: [], visited_house: [], joined: [] };
  let active: FollowUpListResponse | null = null;
  for (let index = 0; index < stages.length; index += 1) {
    const item = stages[index];
    const page = lists[index];
    if (!item || !page) continue;
    byStage[item] = page.people;
    if (item === stage) active = page;
  }
  if (!active) throw new MissioApiError(500, "", null, "server_error");
  return {
    lists: byStage,
    canWrite: active.canWrite,
    leaders: leaderPage.leaders,
    stage,
    leader,
  };
}

/** Desktop shows the four stages side by side; phones get one stage at a time. */
function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(min-width: 1100px)");
    const update = () => setWide(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return wide;
}

const NEXT_STAGE: Partial<Record<FollowUpStage, FollowUpStage>> = { new: "contacted", contacted: "visited_house" };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function nextFocusId(people: FollowUpItem[], index: number): string {
  const next = people[index + 1] ?? people[index - 1];
  return next ? `follow-up-open-${next.key}` : "follow-up-filters";
}

export function FollowUpBoard({
  client = followUpClient,
  houses = houseChurchesClient,
  people = missioClient,
}: {
  client?: FollowUpClient;
  houses?: Pick<HouseChurchesClient, "listHouses" | "addMember">;
  people?: Pick<MissioClient, "listPeople">;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const [stage, setStage] = useState<FollowUpStage>(() => readStage(params.get("stage")));
  const [leader, setLeader] = useState(() => params.get("leader") ?? "");
  const [board, setBoard] = useState<Board | null>(null);
  const [fatal, setFatal] = useState<unknown>(null);
  const [booting, setBooting] = useState(true);
  const [listPending, setListPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [declineHidden, setDeclineHidden] = useState(declineHiddenForSession);
  const wide = useWide();
  const requestId = useRef(0);
  const focusN = useRef(0);

  const load = useCallback(
    async (background: boolean) => {
      const id = requestId.current + 1;
      requestId.current = id;
      if (!background) setListPending(true);
      try {
        const next = await fetchBoard(client, stage, leader);
        if (requestId.current !== id) return;
        setBoard(next);
        setFatal(null);
      } catch (caught) {
        if (requestId.current !== id) return;
        if (!background || accessStatus(caught)) setFatal(caught);
        else setNotice(missioFixedCopy(caught instanceof MissioApiError ? caught.code : null, caught instanceof MissioApiError ? caught.retryAfterSeconds : null));
      } finally {
        if (requestId.current === id) {
          setListPending(false);
          setBooting(false);
        }
      }
    },
    [client, stage, leader]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (typeof window === "undefined" || window.location.pathname !== "/missio/follow-up") return;
    const query = new URLSearchParams();
    if (stage !== "new") query.set("stage", stage);
    if (leader) query.set("leader", leader);
    const href = query.size ? `/missio/follow-up?${query}` : "/missio/follow-up";
    router.replace(href);
  }, [stage, leader, router]);

  useEffect(() => {
    if (!focus) return;
    document.getElementById(focus.id)?.focus();
  }, [focus]);

  function focusOn(id: string) {
    focusN.current += 1;
    setFocus({ id, n: focusN.current });
  }

  /** Put a changed person where they now belong, or drop them if the filter hides them. */
  function place(person: FollowUpItem, keep: boolean) {
    setBoard((current) => {
      if (!current) return current;
      const lists = { ...current.lists };
      let placed = false;
      for (const item of STAGES) {
        lists[item] = lists[item].flatMap((row) => {
          if (row.key !== person.key) return [row];
          if (keep && item === person.stage) {
            placed = true;
            return [person];
          }
          return [];
        });
      }
      if (keep && !placed) lists[person.stage] = [person, ...lists[person.stage]];
      return { ...current, lists };
    });
  }

  function drop(key: string) {
    setBoard((current) => {
      if (!current) return current;
      const lists = { ...current.lists };
      for (const item of STAGES) lists[item] = lists[item].filter((row) => row.key !== key);
      return { ...current, lists };
    });
  }

  function listOf(person: FollowUpItem): FollowUpItem[] {
    return board?.lists[person.stage] ?? [];
  }

  function writeCopy(caught: unknown): string {
    if (!(caught instanceof MissioApiError)) return missioFixedCopy(null);
    return missioFixedCopy(caught.code, caught.retryAfterSeconds);
  }

  async function changeStage(person: FollowUpItem, next: FollowUpStage, index: number): Promise<boolean> {
    if (!board?.canWrite || next === person.stage) return true;
    setNotice(null);
    try {
      const result = await client.setStage(person.key, { stage: next });
      const matches = leaderMatches(result.person.assignedLeader?.contactId ?? null, leader);
      const stays = (wide || next === stage) && matches;
      const people = listOf(person);
      place(result.person, matches);
      // On a phone the person leaves this tab, so their sheet closes with them.
      if (!stays && openKey === person.key) setOpenKey(null);
      const here = openKey === person.key ? `follow-up-stage-${person.key}` : `follow-up-open-${person.key}`;
      focusOn(stays ? here : nextFocusId(people, index));
      void load(true);
      return true;
    } catch (caught) {
      if (accessStatus(caught)) setFatal(caught);
      else setNotice(writeCopy(caught));
      if (shouldRefetch(caught instanceof MissioApiError ? caught.code : null)) void load(true);
      focusOn(`follow-up-stage-${person.key}`);
      return false;
    }
  }

  async function changeLeader(person: FollowUpItem, leaderContactId: string | null, index: number): Promise<boolean> {
    if (!board?.canWrite) return false;
    if ((person.assignedLeader?.contactId ?? null) === leaderContactId) return true;
    setNotice(null);
    try {
      const result = await client.setLeader(person.key, leaderContactId);
      const matches = leaderMatches(result.person.assignedLeader?.contactId ?? null, leader);
      const stays = (wide || result.person.stage === stage) && matches;
      const people = listOf(person);
      place(result.person, matches);
      if (!stays && openKey === person.key) setOpenKey(null);
      const here = openKey === person.key ? `follow-up-leader-${person.key}` : `follow-up-open-${person.key}`;
      focusOn(stays ? here : nextFocusId(people, index));
      void load(true);
      return true;
    } catch (caught) {
      if (accessStatus(caught)) setFatal(caught);
      else setNotice(writeCopy(caught));
      if (shouldRefetch(caught instanceof MissioApiError ? caught.code : null)) void load(true);
      focusOn(`follow-up-leader-${person.key}`);
      return false;
    }
  }

  async function confirmMatch(person: FollowUpItem) {
    setNotice(null);
    try {
      const result = await client.confirmMatch(person.key);
      if (result.person) place(result.person, true);
      focusOn(`follow-up-open-${person.key}`);
      void load(true);
    } catch (caught) {
      noteMatchError(caught, person.key);
    }
  }

  async function declineMatch(person: FollowUpItem) {
    setNotice(null);
    try {
      const result = await client.declineMatch(person.key);
      if (result.person) place(result.person, true);
      focusOn(`follow-up-open-${person.key}`);
      void load(true);
    } catch (caught) {
      const code = caught instanceof MissioApiError ? caught.code : null;
      if (code === "not_available" || (caught instanceof MissioApiError && caught.status === 501)) {
        declineHiddenForSession = true;
        setDeclineHidden(true);
      }
      noteMatchError(caught, person.key);
    }
  }

  function noteMatchError(caught: unknown, key: string) {
    if (accessStatus(caught)) {
      setFatal(caught);
      return;
    }
    const code = caught instanceof MissioApiError ? caught.code : null;
    setNotice(matchActionCopy(code));
    if (shouldRefetch(code)) void load(true);
    focusOn(`follow-up-open-${key}`);
  }

  function added(person: FollowUpItem, index: number) {
    setAddingKey(null);
    if (board && person.stage !== "joined") {
      const people = listOf(person);
      drop(person.key);
      focusOn(nextFocusId(people, index));
    } else {
      focusOn(`follow-up-add-${person.key}`);
    }
    void load(true);
  }

  const everyone = board ? STAGES.flatMap((item) => board.lists[item]) : [];
  const openPerson = everyone.find((item) => item.key === openKey) ?? null;
  const adding = everyone.find((item) => item.key === addingKey) ?? null;
  const countsReady = board != null && board.leader === leader && (wide || board.stage === stage);
  const showPeople = countsReady && !listPending;
  const counts = (item: FollowUpStage) => board?.lists[item].length ?? 0;
  const waiting = counts("new") + counts("contacted") + counts("visited_house");
  const reviews = board
    ? (["new", "contacted", "visited_house"] as const).flatMap((item) =>
        board.lists[item].filter((person) => person.matchStatus === "pending_confirm")
      )
    : [];
  const indexIn = (person: FollowUpItem) => listOf(person).findIndex((item) => item.key === person.key);
  const card = (person: FollowUpItem) => (
    <PersonCard
      key={person.key}
      person={person}
      canWrite={board?.canWrite ?? false}
      onOpen={() => setOpenKey(person.key)}
      onAdd={() => setAddingKey(person.key)}
      onNext={(next) => void changeStage(person, next, indexIn(person))}
    />
  );

  const denied = accessStatus(fatal);
  if (denied) {
    return (
      <div className={`${content.page} ${styles.root}`}>
        <NoAccess status={denied} />
      </div>
    );
  }

  if (fatal && !board) {
    return (
      <div className={`${content.page} ${styles.root}`}>
        <p className={styles.notice} role="alert">
          {missioFixedCopy(fatal instanceof MissioApiError ? fatal.code : null, fatal instanceof MissioApiError ? fatal.retryAfterSeconds : null)}
        </p>
        <button type="button" className={styles.ghost} onClick={() => void load(false)}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className={`${content.page} ${styles.root}`}>
      <div className={styles.head}>
        <div>
          <h1 className={content.title}>Follow-up</h1>
          <p className={`${shell.lede} ${content.lede}`} data-testid="follow-up-lede">
            {countsReady ? `${waiting} ${waiting === 1 ? "person" : "people"} not in a house yet.` : "Not in a house yet."}
          </p>
        </div>
        <label className={styles.leaderFilter} id="follow-up-filters">
          Leader
          <select
            aria-label="Leader"
            value={leader}
            onChange={(event) => {
              setLeader(event.target.value);
              setNotice(null);
            }}
          >
            <option value="">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {(board?.leaders ?? []).map((item) => (
              <option key={item.contactId} value={item.contactId}>
                {item.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>

      {notice ? (
        <p className={styles.notice} role="alert">
          {notice}
        </p>
      ) : null}

      {showPeople && reviews.length > 0 ? (
        <section className={styles.review} data-testid="needs-review-panel" aria-labelledby="follow-up-review-heading">
          <h2 id="follow-up-review-heading">Needs review · {reviews.length}</h2>
          <p className={styles.reviewLede}>These connect cards share a phone number with someone already in People.</p>
          <ul className={styles.reviewList}>
            {reviews.map((person) => (
              <ReviewCard
                key={person.key}
                person={person}
                canWrite={board?.canWrite ?? false}
                declineHidden={declineHidden}
                onConfirm={() => void confirmMatch(person)}
                onDecline={() => void declineMatch(person)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {!wide ? (
        <div className={styles.tabs} role="group" aria-label="Stage">
          {STAGES.map((item) => {
            const selected = item === stage;
            return (
              <button
                key={item}
                type="button"
                className={`${styles.tab} ${selected ? styles.tabOn : ""}`}
                aria-pressed={selected}
                onClick={() => {
                  setStage(item);
                  setNotice(null);
                }}
              >
                <span className={styles.tabCount}>{countsReady ? counts(item) : "–"}</span>
                <span>{item === "visited_house" ? "Visited" : STAGE_LABEL[item]}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {booting && !board ? (
        <p className={shell.state} role="status">
          Loading follow-up…
        </p>
      ) : null}
      {listPending && board ? <p role="status">Loading this list…</p> : null}

      {showPeople && board && !wide ? (
        board.lists[stage].length === 0 ? (
          <EmptyStage stage={stage} />
        ) : (
          <ul className={styles.list} data-testid="follow-up-list">
            {board.lists[stage].map(card)}
          </ul>
        )
      ) : null}

      {showPeople && board && wide ? (
        <div className={styles.columns} data-testid="follow-up-columns" aria-label="Stage">
          {STAGES.map((item) => (
            <section key={item} className={styles.column} aria-labelledby={`follow-up-col-${item}`}>
              <h2 id={`follow-up-col-${item}`} className={styles.columnHead}>
                <span>{STAGE_LABEL[item]}</span>
                <span className={styles.columnCount}>{counts(item)}</span>
              </h2>
              {item === "joined" ? (
                <p className={styles.columnNote}>Moves here by itself when someone is added to a house.</p>
              ) : null}
              {board.lists[item].length === 0 ? (
                <p className={styles.columnEmpty}>No one here.</p>
              ) : (
                <ul className={styles.list} data-testid={`follow-up-list-${item}`}>
                  {board.lists[item].map(card)}
                </ul>
              )}
            </section>
          ))}
        </div>
      ) : null}

      {openPerson ? (
        <TimelineSheet
          person={openPerson}
          canWrite={board?.canWrite ?? false}
          leaders={board?.leaders ?? []}
          client={client}
          onClose={() => {
            setOpenKey(null);
            focusOn(`follow-up-open-${openPerson.key}`);
          }}
          onStage={(next) => changeStage(openPerson, next, indexIn(openPerson))}
          onLeader={(next) => changeLeader(openPerson, next, indexIn(openPerson))}
        />
      ) : null}
      {adding && board ? (
        <AddHouseDialog
          person={adding}
          followUp={client}
          houses={houses}
          people={people}
          onClose={() => {
            setAddingKey(null);
            focusOn(`follow-up-add-${adding.key}`);
          }}
          onAdded={() => added(adding, indexIn(adding))}
          onConflict={() => {
            setAddingKey(null);
            setNotice(missioFixedCopy("already_resolved"));
            focusOn(`follow-up-add-${adding.key}`);
            void load(true);
          }}
        />
      ) : null}
    </div>
  );
}

function EmptyStage({ stage }: { stage: FollowUpStage }) {
  if (stage === "joined") return <p className={styles.empty}>No one has joined a house from follow-up yet.</p>;
  if (stage !== "new") return <p className={styles.empty}>No one in {STAGE_LABEL[stage].toLowerCase()} right now.</p>;
  return (
    <div className={styles.empty} data-testid="follow-up-empty">
      <p className={styles.emptyTitle}>No new connect cards.</p>
      <p>New connect cards from Sunday will show up here.</p>
    </div>
  );
}

function PersonCard({
  person,
  canWrite,
  onOpen,
  onAdd,
  onNext,
}: {
  person: FollowUpItem;
  canWrite: boolean;
  onOpen: () => void;
  onAdd: () => void;
  onNext: (next: FollowUpStage) => void;
}) {
  const hasPhone = Boolean(person.phone?.trim());
  const phone = telHref(person.phone);
  const whatsApp = whatsAppHref(person.phone);
  const when = formatWhen(person.submittedAt);
  const meta = [when, person.visitType ? VISIT_LABEL[person.visitType].toLowerCase() : null].filter(Boolean).join(" · ");
  const reviewing = person.matchStatus === "pending_confirm";
  const next = NEXT_STAGE[person.stage];
  const leaderName = person.assignedLeader?.displayName ?? null;

  return (
    <li className={styles.card} data-testid="follow-up-card" data-stage={person.stage}>
      <div className={styles.cardTop}>
        <span className={styles.avatar} aria-hidden="true">
          {initials(person.displayName)}
        </span>
        <div className={styles.cardText}>
          <button type="button" className={styles.name} id={`follow-up-open-${person.key}`} onClick={onOpen}>
            {person.displayName}
          </button>
          {meta ? <p className={styles.meta}>{meta}</p> : null}
        </div>
      </div>
      <div className={styles.badges}>
        {person.wantsHouseChurch ? <span className={`${styles.badge} ${styles.badgeHouse}`}>Wants a house church</span> : null}
        {person.wantsHouseChurch === false ? <span className={`${styles.badge} ${styles.badgeQuiet}`}>Not yet</span> : null}
        {person.wantsPrayer ? <span className={styles.badge}>Wants prayer</span> : null}
        {reviewing ? <span className={`${styles.badge} ${styles.badgeReview}`}>Needs review</span> : null}
      </div>
      <div className={styles.cardFoot}>
        {leaderName ? (
          <span className={styles.leader} title={`Leader · ${leaderName}`}>
            <span className={styles.leaderDot} aria-hidden="true">
              {initials(leaderName)}
            </span>
            <span>
              <span className={shell.visuallyHidden}>Leader · </span>
              {firstName(leaderName)}
            </span>
          </span>
        ) : canWrite && person.stage !== "joined" ? (
          <button type="button" id={`follow-up-assign-${person.key}`} className={styles.secondary} onClick={onOpen}>
            Assign
          </button>
        ) : (
          <span className={styles.muted}>No leader yet</span>
        )}
        {canWrite && next ? (
          <button
            type="button"
            id={`follow-up-next-${person.key}`}
            className={styles.secondary}
            onClick={() => onNext(next)}
          >
            Next stage
          </button>
        ) : null}
        {canWrite && person.stage !== "joined" ? (
          <button
            type="button"
            id={`follow-up-add-${person.key}`}
            className={person.stage === "visited_house" ? styles.primaryButton : styles.secondary}
            onClick={onAdd}
          >
            Add to a house
          </button>
        ) : null}
      </div>
      {hasPhone && (phone || whatsApp) ? (
        <div className={styles.reach}>
          {phone ? <a href={phone}>Call</a> : null}
          {whatsApp ? (
            <a href={whatsApp} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function ReviewCard({
  person,
  canWrite,
  declineHidden,
  onConfirm,
  onDecline,
}: {
  person: FollowUpItem;
  canWrite: boolean;
  declineHidden: boolean;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const suggestion = person.suggestedContact;
  const when = formatWhen(person.submittedAt);
  const meta = [
    person.visitType ? VISIT_LABEL[person.visitType] : null,
    person.wantsHouseChurch ? "wants a house church" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className={styles.compare} data-testid="needs-review">
      <div className={styles.compareSide}>
        <p className={styles.compareLabel}>Connect card{when ? ` · ${when}` : ""}</p>
        <p className={styles.compareName}>{person.displayName}</p>
        {person.phone ? <p className={styles.meta}>{person.phone}</p> : null}
        {meta ? <p className={styles.meta}>{meta}</p> : null}
      </div>
      <span className={styles.compareMark} aria-hidden="true">
        =?
      </span>
      <div className={styles.compareSide}>
        <p className={styles.compareLabel}>In People</p>
        {suggestion ? (
          <p className={styles.compareName}>{suggestion.displayName}</p>
        ) : (
          <p className={styles.muted}>No one suggested yet.</p>
        )}
      </div>
      {suggestion && canWrite ? (
        <div className={styles.compareActions}>
          <button type="button" className={styles.primaryButton} onClick={onConfirm}>
            Confirm, it’s {firstName(suggestion.displayName)}
          </button>
          {declineHidden ? null : (
            <button type="button" className={styles.secondary} onClick={onDecline}>
              Not this person
            </button>
          )}
        </div>
      ) : null}
    </li>
  );
}
