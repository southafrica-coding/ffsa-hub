"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
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
  people: FollowUpItem[];
  canWrite: boolean;
  counts: Record<FollowUpStage, number>;
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
  const counts: Record<FollowUpStage, number> = { new: 0, contacted: 0, visited_house: 0, joined: 0 };
  let active: FollowUpListResponse | null = null;
  for (let index = 0; index < stages.length; index += 1) {
    const item = stages[index];
    const page = lists[index];
    if (!item || !page) continue;
    counts[item] = page.people.length;
    if (item === stage) active = page;
  }
  if (!active) throw new MissioApiError(500, "", null, "server_error");
  return {
    people: active.people,
    canWrite: active.canWrite,
    counts,
    leaders: leaderPage.leaders,
    stage,
    leader,
  };
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

  function applyPeople(people: FollowUpItem[]) {
    setBoard((current) => (current ? { ...current, people } : current));
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
      const stays = next === stage && leaderMatches(result.person.assignedLeader?.contactId ?? null, leader);
      const people = board.people;
      applyPeople(stays ? people.map((item) => (item.key === person.key ? result.person : item)) : people.filter((item) => item.key !== person.key));
      focusOn(stays ? `follow-up-stage-${person.key}` : nextFocusId(people, index));
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
      const stays = result.person.stage === stage && leaderMatches(result.person.assignedLeader?.contactId ?? null, leader);
      const people = board.people;
      applyPeople(stays ? people.map((item) => (item.key === person.key ? result.person : item)) : people.filter((item) => item.key !== person.key));
      focusOn(stays ? `follow-up-leader-${person.key}` : nextFocusId(people, index));
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
      if (result.person) {
        applyPeople((board?.people ?? []).map((item) => (item.key === person.key ? result.person! : item)));
      }
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
      if (result.person) {
        applyPeople((board?.people ?? []).map((item) => (item.key === person.key ? result.person! : item)));
      }
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
    if (board && stage !== "joined") {
      applyPeople(board.people.filter((item) => item.key !== person.key));
      focusOn(nextFocusId(board.people, index));
    } else {
      focusOn(`follow-up-add-${person.key}`);
    }
    void load(true);
  }

  const openPerson = board?.people.find((item) => item.key === openKey) ?? null;
  const adding = board?.people.find((item) => item.key === addingKey) ?? null;
  const countsReady = board != null && board.stage === stage && board.leader === leader;
  const showPeople = countsReady && !listPending;

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
      <p className={`${shell.eyebrow} ${content.eyebrow}`}>After a service</p>
      <h1 className={content.title}>Follow-up</h1>
      <p className={`${shell.lede} ${content.lede}`}>{stage === "joined" ? "In a house." : "Not in a house yet."}</p>

      <div className={styles.filters} id="follow-up-filters">
        <div className={styles.chipRow} role="group" aria-label="Stage">
          <div className={styles.chips}>
          {STAGES.map((item) => {
            const selected = item === stage;
            const count = countsReady ? board?.counts[item] : null;
            return (
              <button
                key={item}
                type="button"
                className={`${styles.chip} ${selected ? styles.chipOn : ""}`}
                aria-pressed={selected}
                onClick={() => {
                  setStage(item);
                  setNotice(null);
                }}
              >
                {STAGE_LABEL[item]}
                {count != null ? <span className={styles.count}>{count}</span> : null}
              </button>
            );
          })}
          </div>
        </div>
        <label className={styles.leaderFilter}>
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
      {stage !== "joined" ? (
        <p className={styles.joinedLink}>
          <Link
            href="/missio/follow-up?stage=joined"
            className={styles.joined}
            onClick={(event) => {
              event.preventDefault();
              setStage("joined");
            }}
          >
            People who joined
          </Link>
        </p>
      ) : null}

      {notice ? (
        <p className={styles.notice} role="alert">
          {notice}
        </p>
      ) : null}
      {booting && !board ? (
        <p className={shell.state} role="status">
          Loading follow-up…
        </p>
      ) : null}
      {showPeople && board && board.people.length === 0 ? <p className={styles.meta}>No one in this list.</p> : null}
      {listPending && board ? <p role="status">Loading this list…</p> : null}
      {showPeople && board && board.people.length > 0 ? (
        <ul className={styles.list} data-testid="follow-up-list">
          {board.people.map((person) => (
            <PersonCard
              key={person.key}
              person={person}
              canWrite={board.canWrite}
              onOpen={() => setOpenKey(person.key)}
              onAdd={() => setAddingKey(person.key)}
              onConfirm={() => void confirmMatch(person)}
              onDecline={() => void declineMatch(person)}
              declineHidden={declineHidden}
            />
          ))}
        </ul>
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
          onStage={(next) => changeStage(openPerson, next, board?.people.findIndex((item) => item.key === openPerson.key) ?? 0)}
          onLeader={(next) => changeLeader(openPerson, next, board?.people.findIndex((item) => item.key === openPerson.key) ?? 0)}
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
          onAdded={() => added(adding, board.people.findIndex((item) => item.key === adding.key))}
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

function PersonCard({
  person,
  canWrite,
  onOpen,
  onAdd,
  onConfirm,
  onDecline,
  declineHidden,
}: {
  person: FollowUpItem;
  canWrite: boolean;
  onOpen: () => void;
  onAdd: () => void;
  onConfirm: () => void;
  onDecline: () => void;
  declineHidden: boolean;
}) {
  const hasPhone = Boolean(person.phone?.trim());
  const phone = telHref(person.phone);
  const whatsApp = whatsAppHref(person.phone);
  const when = formatWhen(person.submittedAt);
  const meta = [person.visitType ? VISIT_LABEL[person.visitType] : null, when].filter(Boolean).join(" · ");
  const reviewing = person.matchStatus === "pending_confirm";
  const suggestion = reviewing ? person.suggestedContact : null;

  return (
    <li className={styles.card} data-testid="follow-up-card">
      <button type="button" className={styles.name} id={`follow-up-open-${person.key}`} onClick={onOpen}>
        {person.displayName}
      </button>
      {meta ? <p className={styles.meta}>{meta}</p> : null}
      {person.wantsHouseChurch || person.wantsPrayer ? (
        <div className={styles.badges}>
          {person.wantsHouseChurch ? <span className={styles.badge}>Wants a house church</span> : null}
          {person.wantsPrayer ? <span className={styles.badge}>Wants prayer</span> : null}
        </div>
      ) : null}
      <p className={styles.meta}>{person.assignedLeader ? `Leader · ${person.assignedLeader.displayName}` : "No leader yet"}</p>
      {reviewing ? (
        <div className={styles.confirm} data-testid="needs-review">
          <p>Needs review</p>
          {suggestion ? <p>Possible match: {suggestion.displayName}</p> : null}
          {suggestion && canWrite ? (
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={onConfirm}>
                Confirm
              </button>
              {declineHidden ? null : (
                <button type="button" className={styles.secondary} onClick={onDecline}>
                  Not this person
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={styles.actions}>
        {hasPhone && phone ? <a className={styles.secondary} href={phone}>Call</a> : null}
        {hasPhone && whatsApp ? (
          <a className={styles.secondary} href={whatsApp} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        ) : null}
        {!hasPhone ? <p className={styles.muted}>Phone isn’t shown here yet.</p> : null}
        {canWrite ? (
          <button type="button" id={`follow-up-add-${person.key}`} className={styles.secondary} onClick={onAdd}>
            Add to a house
          </button>
        ) : null}
      </div>
    </li>
  );
}
