"use client";

import { useState } from "react";
import type { NextLeader, NextLeaderStage, PipelineHouse } from "@/lib/missio/next-leaders";
import content from "../content.module.css";
import { MissioApiError } from "../api";
import { missioFixedCopy } from "../errors";
import { houseChurchesClient, type HouseChurchesClient } from "../house-churches/client";
import { houseTitle, MULTIPLY_AT } from "../house-churches/format";
import { useMissioLoad } from "../house-churches/load";
import { HouseStatus } from "../house-churches/status";
import type { HouseMember } from "../house-churches/types";
import { MissioDialog } from "../missio-dialog";
import shell from "../shell.module.css";
import { nextLeadersClient, type NextLeadersClient } from "./client";
import styles from "./next-leaders.module.css";

export const STAGE_LABEL: Record<NextLeaderStage, string> = {
  spotted: "Spotted",
  in_training: "In training",
  ready: "Ready to lead",
};
const ORDER: NextLeaderStage[] = ["spotted", "in_training", "ready"];

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Johannesburg" });
const monthYear = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "Africa/Johannesburg" });

function sinceLine(leader: NextLeader): string | null {
  if (!leader.since) return null;
  const date = new Date(leader.since);
  if (Number.isNaN(date.getTime())) return null;
  return leader.stage === "spotted" ? `Spotted ${dayMonth.format(date)}` : `Since ${monthYear.format(date)}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]![0]}${parts[parts.length - 1]![0]}` : (parts[0] ?? "?").slice(0, 2)).toUpperCase();
}

function tintFor(id: string): number {
  let sum = 0;
  for (const char of id) sum = (sum + char.charCodeAt(0)) % 5;
  return sum + 1;
}

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

const first = (name: string) => name.split(" ")[0] || name;

/** "2 houses can multiply now: House 5 has 24 people and Daniel is ready to lead." */
export function multiplyLine(houses: PipelineHouse[]): string | null {
  const ready = houses.filter((house) => house.ready.length > 0);
  if (ready.length === 0) return null;
  const now = ready.filter((house) => house.memberCount >= MULTIPLY_AT);
  const later = ready.filter((house) => house.memberCount < MULTIPLY_AT);
  const parts: string[] = [];
  if (now.length > 0) {
    parts.push(
      `${now.length === 1 ? "1 house can" : `${now.length} houses can`} multiply now: ${now
        .map((house) => `${houseTitle(house)} has ${house.memberCount} people and ${first(house.ready[0]!)} is ready to lead`)
        .join("; ")}.`
    );
  }
  for (const house of later) {
    parts.push(`${houseTitle(house)} has ${first(house.ready[0]!)} ready, but only ${house.memberCount} people, so it can grow first.`);
  }
  return parts.join(" ");
}

/** Board M12d. Spotted → In training → Ready to lead, house by house. */
export function NextLeadersBoard({
  client = nextLeadersClient,
  houses = houseChurchesClient,
}: {
  client?: NextLeadersClient;
  houses?: Pick<HouseChurchesClient, "getHouse">;
}) {
  const { state, retry } = useMissioLoad(() => client.list(), [client]);
  const [nominating, setNominating] = useState(false);
  const [editing, setEditing] = useState<NextLeader | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<NextLeaderStage>("spotted");

  async function move(leader: NextLeader, change: Parameters<NextLeadersClient["move"]>[1]) {
    setBusy(leader.id);
    setNotice(null);
    try {
      await client.move(leader.id, change);
      retry();
    } catch (caught) {
      setNotice(missioFixedCopy(caught instanceof MissioApiError ? caught.code : null));
    } finally {
      setBusy(null);
    }
  }

  const data = state.phase === "ready" ? state.data : null;
  const banner = data ? multiplyLine(data.houses) : null;

  return (
    <div className={content.page}>
      <div className={styles.head}>
        <div>
          <h1 className={`${content.title} ${styles.title}`}>Next leaders</h1>
          <p className={`${shell.lede} ${content.lede}`}>Who’s being trained up, house by house</p>
        </div>
        {data && data.houses.length > 0 ? (
          <button type="button" className={shell.primary} onClick={() => setNominating(true)}>
            Nominate someone
          </button>
        ) : null}
      </div>
      {state.phase === "loading" ? <p className={shell.state}>Loading…</p> : null}
      {state.phase === "error" ? <HouseStatus error={state.error} fallback="Next leaders didn’t load." onRetry={retry} /> : null}
      {banner ? (
        <div className={styles.banner}>
          <CheckIcon />
          <p data-testid="multiply-banner">
            {banner.includes("multiply now:") ? (
              <>
                <b>{banner.slice(0, banner.indexOf("multiply now:") + "multiply now:".length)}</b>
                {banner.slice(banner.indexOf("multiply now:") + "multiply now:".length)}
              </>
            ) : (
              banner
            )}
          </p>
        </div>
      ) : null}
      {notice ? (
        <p className={shell.alert} role="alert">
          {notice}
        </p>
      ) : null}
      {data && data.houses.length === 0 ? <p className={shell.state}>No houses yet.</p> : null}
      {data && data.houses.length > 0 ? (
        <>
        <div className={styles.stabs} role="group" aria-label="Show">
          {ORDER.map((stage) => (
            <button key={stage} type="button" className={styles.stab} aria-pressed={tab === stage} onClick={() => setTab(stage)}>
              <b>{data.leaders.filter((leader) => leader.stage === stage).length}</b>
              {STAGE_LABEL[stage]}
            </button>
          ))}
        </div>
        <div className={styles.columns}>
          {ORDER.map((stage, index) => {
            const cards = data.leaders.filter((leader) => leader.stage === stage);
            return (
              <section
                key={stage}
                className={styles.column}
                data-active={tab === stage}
                aria-labelledby={`nl-${stage}`}
                data-testid={`nl-${stage}`}
              >
                <h2 id={`nl-${stage}`}>
                  <span className={styles.colChip} data-stage={stage}>
                    {STAGE_LABEL[stage]}
                  </span>{" "}
                  <span className={styles.colCount}>{cards.length}</span>
                </h2>
                {cards.length === 0 ? <p className={styles.empty}>No one yet.</p> : null}
                <ul>
                  {cards.map((leader) => {
                    const next = ORDER[index + 1];
                    const back = ORDER[index - 1];
                    const since = sinceLine(leader);
                    return (
                      <li key={leader.id} className={styles.card} data-testid="nl-card">
                        <div className={styles.cardTop}>
                          <span className={styles.avatar} data-tint={tintFor(leader.id)} aria-hidden="true">
                            {initials(leader.name)}
                          </span>
                          <div>
                            <b>{leader.name}</b>
                            <span className={styles.meta}>
                              {houseTitle(leader.house)}
                              {leader.trainer ? ` · with ${first(leader.trainer.name)}` : ""}
                            </span>
                          </div>
                        </div>
                        {leader.note ? <p className={styles.note}>{leader.note}</p> : null}
                        {since ? <p className={styles.since}>{since}</p> : null}
                        <div className={styles.actions}>
                          {next ? (
                            <button type="button" className={styles.move} disabled={busy === leader.id} onClick={() => void move(leader, { stage: next })}>
                              {STAGE_LABEL[next]} →
                            </button>
                          ) : null}
                          {back ? (
                            <button type="button" className={styles.link} disabled={busy === leader.id} onClick={() => void move(leader, { stage: back })}>
                              ← Back
                            </button>
                          ) : null}
                          <button type="button" className={styles.link} onClick={() => setEditing(leader)}>
                            Note
                          </button>
                          {!leader.virtual ? (
                            <button
                              type="button"
                              className={styles.link}
                              disabled={busy === leader.id}
                              aria-label={`Take ${leader.name} off the list`}
                              onClick={() => void move(leader, { remove: true })}
                            >
                              Not now
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
        </>
      ) : null}
      <p className={styles.footnote}>
        Leaders nominate in their own house, coaches across their houses, pastors anywhere. Co-leaders show as In training until
        someone moves them.
      </p>
      {nominating && data ? (
        <NominateDialog
          pipelineHouses={data.houses}
          already={new Set(data.leaders.map((leader) => leader.contactId))}
          client={client}
          houses={houses}
          onClose={() => setNominating(false)}
          onSaved={() => {
            setNominating(false);
            retry();
          }}
        />
      ) : null}
      {editing ? (
        <NoteDialog
          leader={editing}
          onClose={() => setEditing(null)}
          onSave={async (note) => {
            await move(editing, { note });
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function NominateDialog({
  pipelineHouses,
  already,
  client,
  houses,
  onClose,
  onSaved,
}: {
  pipelineHouses: PipelineHouse[];
  already: Set<string>;
  client: NextLeadersClient;
  houses: Pick<HouseChurchesClient, "getHouse">;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [houseId, setHouseId] = useState(pipelineHouses.length === 1 ? pipelineHouses[0]!.id : "");
  const { state } = useMissioLoad(
    () => (houseId ? houses.getHouse(houseId).then((body) => body.house.members) : Promise.resolve([] as HouseMember[])),
    [houseId, houses]
  );
  const members = state.phase === "ready" ? state.data : [];
  const candidates = members.filter((member) => member.role !== "leader" && !already.has(member.contactId));
  const trainers = members.filter((member) => member.role !== "member");
  const [contactId, setContactId] = useState("");
  const [trainer, setTrainer] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const trainerId = trainer || trainers.find((member) => member.role === "leader")?.contactId || "";

  async function save() {
    if (!houseId || !contactId || pending) return;
    setPending(true);
    setNotice(null);
    try {
      await client.nominate({ houseId, contactId, trainerContactId: trainerId || null, ...(note.trim() ? { note: note.trim() } : {}) });
      onSaved();
    } catch (caught) {
      setNotice(missioFixedCopy(caught instanceof MissioApiError ? caught.code : null));
      setPending(false);
    }
  }

  return (
    <MissioDialog onClose={onClose} title="Nominate someone" testId="nl-nominate">
      <div className={shell.fields}>
        <label className={shell.field}>
          House
          <select
            value={houseId}
            onChange={(event) => {
              setHouseId(event.target.value);
              setContactId("");
              setTrainer("");
            }}
          >
            <option value="">Choose a house</option>
            {pipelineHouses.map((house) => (
              <option key={house.id} value={house.id}>
                {houseTitle(house)}
              </option>
            ))}
          </select>
        </label>
        {houseId ? (
          <>
            <label className={shell.field}>
              Who
              <select value={contactId} onChange={(event) => setContactId(event.target.value)} disabled={state.phase !== "ready"}>
                <option value="">{state.phase === "ready" ? (candidates.length ? "Choose someone" : "Everyone here is on the list") : "Loading…"}</option>
                {candidates.map((member) => (
                  <option key={member.contactId} value={member.contactId}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className={shell.field}>
              Training them
              <select value={trainerId} onChange={(event) => setTrainer(event.target.value)}>
                <option value="">No one yet</option>
                {trainers.map((member) => (
                  <option key={member.contactId} value={member.contactId}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className={shell.field}>
              What do you see in them? (optional)
              <textarea className={styles.textarea} value={note} maxLength={280} rows={3} onChange={(event) => setNote(event.target.value)} />
            </label>
          </>
        ) : null}
      </div>
      {notice ? (
        <p className={shell.alert} role="alert">
          {notice}
        </p>
      ) : null}
      <div className={shell.actions}>
        <button type="button" className={shell.ghost} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={shell.primary} disabled={!contactId || pending} onClick={() => void save()}>
          Nominate
        </button>
      </div>
    </MissioDialog>
  );
}

function NoteDialog({ leader, onClose, onSave }: { leader: NextLeader; onClose: () => void; onSave: (note: string | null) => Promise<void> }) {
  const [note, setNote] = useState(leader.note ?? "");
  const [pending, setPending] = useState(false);
  return (
    <MissioDialog onClose={onClose} title={`A note on ${first(leader.name)}`} testId="nl-note">
      <label className={shell.field}>
        Note
        <textarea className={styles.textarea} value={note} maxLength={280} rows={4} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className={shell.actions}>
        <button type="button" className={shell.ghost} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={shell.primary}
          disabled={pending}
          onClick={() => {
            setPending(true);
            void onSave(note.trim() || null);
          }}
        >
          Save
        </button>
      </div>
    </MissioDialog>
  );
}
