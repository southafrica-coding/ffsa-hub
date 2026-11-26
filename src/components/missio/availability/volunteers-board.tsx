"use client";

import { Fragment, useEffect, useState } from "react";
import type { GridCounts } from "@/lib/missio/availability/grid";
import content from "@/components/missio/content.module.css";
import { formatServiceLabel, isIsoDate, sundaysBetween } from "@/lib/missio/availability/dates";
import type { VolunteersSnapshot } from "@/lib/missio/availability/service";
import { missingStarterTeams } from "@/lib/missio/availability/starter-teams";
import { volunteersClient, type NudgeDraft, type PeopleHit, type VolunteersClient } from "./client";
import styles from "./volunteers.module.css";

function johannesburgToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(now);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

function tintFor(id: string): number {
  let sum = 0;
  for (const char of id) sum = (sum + char.charCodeAt(0)) % 5;
  return sum + 1;
}

/**
 * A cell from boards M6b/M6c: the number in, the rest in words, and a bar
 * split in, maybe, out, no reply. The Hub has no weekly need per team yet,
 * so there is no "needs 2 / covered" chip.
 */
function CellCounts({ counts, compact = false }: { counts: GridCounts; compact?: boolean }) {
  const total = counts.available + counts.maybe + counts.unavailable + counts.unanswered;
  const label = `${counts.available} in, ${counts.maybe} maybe, ${counts.unavailable} out, ${counts.unanswered} no reply`;
  return (
    <span className={styles.cell}>
      <span className={styles.cellLine}>
        <b className={styles.cellNum}>{counts.available}</b>
        <span className={styles.cellRest}>
          in · {counts.maybe} maybe · {counts.unavailable} out{compact ? <br /> : " · "}
          {counts.unanswered} no reply
        </span>
      </span>
      <span className={styles.vbar} role="img" aria-label={label}>
        {total === 0 ? <span style={{ flex: 1 }} data-tone="none" /> : null}
        <span style={{ flex: counts.available }} data-tone="in" />
        <span style={{ flex: counts.maybe }} data-tone="maybe" />
        <span style={{ flex: counts.unavailable }} data-tone="out" />
        <span style={{ flex: counts.unanswered }} data-tone="none" />
      </span>
    </span>
  );
}

function CopyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: open ? "rotate(90deg)" : undefined, flex: "none" }}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function VolunteersBoard({
  client = volunteersClient,
  initial = null,
  live = initial == null,
}: {
  client?: VolunteersClient;
  initial?: VolunteersSnapshot | null;
  live?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<VolunteersSnapshot | null>(initial);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">(initial ? "ready" : "loading");
  const [requestId, setRequestId] = useState<string | undefined>(initial?.selectedRequestId ?? undefined);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [serviceDates, setServiceDates] = useState<string[]>([]);
  const [draftDate, setDraftDate] = useState("");
  const [teamName, setTeamName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ teamId: string; kind: "members" | "leaders" } | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PeopleHit[]>([]);
  const [links, setLinks] = useState<Record<string, { url: string; copied: boolean; replaced: boolean }>>({});
  const [nudge, setNudge] = useState<NudgeDraft | null>(null);
  const [copiedNudge, setCopiedNudge] = useState<"whatsapp" | "email" | null>(null);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [showAllDates, setShowAllDates] = useState(false);
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const [starterNote, setStarterNote] = useState<string | null>(null);

  useEffect(() => {
    if (!live) return;
    let active = true;
    setPhase("loading");
    client.load(requestId).then(
      (next) => {
        if (!active) return;
        setSnapshot(next);
        setPhase("ready");
        setError(null);
      },
      (caught: unknown) => {
        if (!active) return;
        setPhase("error");
        setError(caught instanceof Error ? caught.message : "Volunteers didn't load.");
      }
    );
    return () => {
      active = false;
    };
  }, [client, live, requestId, tick]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That change didn't save.");
    } finally {
      setBusy(false);
    }
  }

  function prepareNudge() {
    if (!selected) return;
    void run(async () => {
      setNudge(await client.nudge(selected.id));
      setCopiedNudge(null);
    });
  }

  const selected = snapshot?.requests.find((request) => request.id === snapshot.selectedRequestId) ?? null;
  const linkPeople = (() => {
    const seen = new Map<string, string>();
    for (const team of snapshot?.teams ?? []) {
      for (const person of [...team.leaders, ...team.members]) {
        if (!seen.has(person.contactId)) seen.set(person.contactId, person.name);
      }
    }
    return [...seen.entries()].map(([contactId, name]) => ({ contactId, name }));
  })();

  const dates = selected?.serviceDates ?? [];
  const today = johannesburgToday();
  const shownDate =
    (activeDate && dates.includes(activeDate) ? activeDate : null) ?? dates.find((date) => date >= today) ?? dates[0] ?? null;
  const visibleDates = showAllDates ? dates : dates.slice(0, 3);
  const extraDates = Math.max(0, dates.length - 3);
  const unanswered = snapshot?.unansweredPeople ?? 0;
  const peopleOnTeams = linkPeople.length;
  const teamsById = new Map((snapshot?.teams ?? []).map((team) => [team.id, team]));
  const missingStarters = missingStarterTeams((snapshot?.teams ?? []).map((team) => team.name));

  function copyButton(person: { contactId: string; name: string }) {
    return (
      <button
        type="button"
        className={styles.iconButton}
        aria-label={links[person.contactId]?.copied ? `Copied ${person.name}'s link` : `Copy ${person.name}'s link`}
        title="Copy link"
        disabled={!selected || busy}
        onClick={() => {
          if (!selected) return;
          void run(async () => {
            const issued = await client.copyLink(selected.id, person.contactId);
            const copied = await copyText(issued.url);
            setLinks((current) => ({
              ...current,
              [person.contactId]: { url: issued.url, copied, replaced: issued.replaced === true },
            }));
          });
        }}
      >
        {links[person.contactId]?.copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    );
  }

  function roster(teamId: string) {
    const team = teamsById.get(teamId);
    if (!team) return null;
    const people = [
      ...team.leaders.map((person) => ({ ...person, leads: true })),
      ...team.members.filter((person) => !team.leaders.some((leader) => leader.contactId === person.contactId)).map((person) => ({ ...person, leads: false })),
    ];
    if (people.length === 0) return <p className={styles.meta}>No one on this team yet.</p>;
    return (
      <ul className={styles.roster}>
        {people.map((person) => (
          <li key={person.contactId} className={styles.lrow}>
            <span className={styles.avatar} data-tint={tintFor(person.contactId)} aria-hidden>
              {initials(person.name)}
            </span>
            <div className={styles.lrowText}>
              <div className={styles.lrowName}>{person.name}</div>
              <div className={styles.lrowMeta}>{person.leads ? "Leads" : "On the team"}</div>
              {links[person.contactId] ? (
                <input className={styles.linkBox} readOnly value={links[person.contactId].url} aria-label={`Link for ${person.name}`} />
              ) : null}
              {links[person.contactId]?.replaced ? <p className={styles.meta}>The old link stopped working. This is a new one.</p> : null}
            </div>
            {copyButton(person)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className={`${content.page} ${styles.root}`} data-testid="volunteers-board">
      <div className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.title}>Volunteers</h1>
          {selected ? (
            <p className={styles.sub}>
              {dates.length === 1 ? "1 service" : `${dates.length} services`} · {peopleOnTeams === 1 ? "1 volunteer" : `${peopleOnTeams} volunteers`} ·{" "}
              {unanswered === 0 ? "everyone has answered" : `${unanswered} haven’t answered`}
            </p>
          ) : null}
        </div>
        {selected ? (
          <button
            type="button"
            className={`${styles.primary} ${styles.headNudge}`}
            disabled={busy || unanswered === 0}
            onClick={() => prepareNudge()}
          >
            <ChatIcon />
            {unanswered === 0 ? "Everyone has answered" : `Nudge ${unanswered === 1 ? "1 person" : `${unanswered} people`}`}
          </button>
        ) : null}
      </div>

      {phase === "loading" ? <p className={styles.meta}>Loading volunteers…</p> : null}
      {phase === "error" ? (
        <p className={styles.error} role="alert">
          {error}{" "}
          <button type="button" className={styles.ghost} onClick={() => setTick((value) => value + 1)}>
            Try again
          </button>
        </p>
      ) : null}

      {snapshot ? (
        <>
          {!selected ? (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>No serving request yet</p>
              <p className={styles.meta}>Pick the Sundays to ask about under “Requests and teams” below.</p>
            </div>
          ) : null}

          {selected ? (
            <div className={styles.dateBar}>
              <div className={styles.dchips} role="group" aria-label="Service date">
                {visibleDates.map((date) => {
                  const [weekday, ...rest] = formatServiceLabel(date, "long").split(" ");
                  const on = date === shownDate;
                  return (
                    <button
                      key={date}
                      type="button"
                      className={styles.dchip}
                      aria-pressed={on}
                      onClick={() => {
                        setActiveDate(date);
                        setOpenTeam(null);
                      }}
                    >
                      <b>{weekday.slice(0, 3)}</b>
                      {rest.join(" ")}
                    </button>
                  );
                })}
              </div>
              {extraDates > 0 ? (
                <div className={styles.dateMeta}>
                  <button type="button" className={styles.textButton} onClick={() => setShowAllDates((value) => !value)}>
                    {showAllDates ? "Fewer dates" : extraDates === 1 ? "1 more date" : `${extraDates} more dates`}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {selected && snapshot.grid.length === 0 ? (
            <p className={styles.meta}>Add a team under “Requests and teams” to see who’s in.</p>
          ) : null}

          {/* Phone (board M6c): the teams for one date. */}
          {selected && shownDate && snapshot.grid.length > 0 ? (
            <div className={styles.teamList} data-testid="volunteers-by-date">
              {snapshot.grid.map((team) => {
                const cell = team.dates.find((item) => item.serviceDate === shownDate);
                if (!cell) return null;
                const open = openTeam === team.teamId;
                return (
                  <div key={team.teamId} className={styles.teamCard}>
                    <button
                      type="button"
                      className={styles.teamButton}
                      aria-expanded={open}
                      onClick={() => setOpenTeam(open ? null : team.teamId)}
                    >
                      <span className={styles.vtn}>{team.name}</span>
                      <CellCounts counts={cell.counts} />
                    </button>
                    {open ? roster(team.teamId) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Desktop (board M6b): teams down the side, dates across the top. */}
          {selected && snapshot.grid.length > 0 ? (
            <div className={styles.desk}>
              <ul className={styles.legend}>
                <li><i data-tone="in" aria-hidden="true" />in</li>
                <li><i data-tone="maybe" aria-hidden="true" />maybe</li>
                <li><i data-tone="out" aria-hidden="true" />out</li>
                <li><i data-tone="none" aria-hidden="true" />no reply</li>
              </ul>
              <div className={styles.scroll} data-testid="volunteers-grid">
                <table className={styles.grid}>
                  <thead>
                    <tr>
                      <th className={styles.teamCol}>Team</th>
                      {dates.map((date) => (
                        <th key={date} className={styles.dateCol}>
                          {formatServiceLabel(date, "long").replace(/^([A-Za-z]{3})[A-Za-z]*/, "$1")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.grid.map((team) => {
                      const open = openTeam === team.teamId;
                      return (
                        <Fragment key={team.teamId}>
                          <tr>
                            <th className={styles.teamCol} scope="row">
                              <button
                                type="button"
                                className={styles.teamToggle}
                                aria-expanded={open}
                                onClick={() => setOpenTeam(open ? null : team.teamId)}
                              >
                                <ChevronIcon open={open} />
                                <span className={styles.vtn}>{team.name}</span>
                              </button>
                            </th>
                            {team.dates.map((cell) => (
                              <td key={cell.serviceDate}>
                                <CellCounts counts={cell.counts} compact />
                              </td>
                            ))}
                          </tr>
                          {open ? (
                            <tr>
                              <td colSpan={dates.length + 1} className={styles.rosterCell}>
                                {roster(team.teamId)}
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {nudge ? (
            <section className={styles.nudgePanel} aria-label="Nudge message">
              <h2 className={styles.panelTitle}>Nudge {nudge.count === 1 ? "1 person" : `${nudge.count} people`}</h2>
              <p className={styles.meta}>
                This reuses each person’s current link, and makes one only if they don’t have a live link. Nothing is sent from here: copy the text into WhatsApp or email.
              </p>
              {nudge.needsNewLink.length > 0 ? (
                <p className={styles.meta}>
                  {nudge.needsNewLink.length === 1 ? "1 person needs" : `${nudge.needsNewLink.length} people need`} a new
                  link, use Copy link for them: {nudge.needsNewLink.join(", ")}.
                </p>
              ) : null}
              {nudge.count > 0 ? (
                <div className={styles.stack}>
                  <label className={styles.field}>
                    WhatsApp
                    <textarea readOnly value={nudge.whatsapp} aria-label="WhatsApp text" />
                  </label>
                  <button
                    type="button"
                    className={styles.ghost}
                    onClick={() => {
                      void copyText(nudge.whatsapp).then((ok) => setCopiedNudge(ok ? "whatsapp" : null));
                    }}
                  >
                    {copiedNudge === "whatsapp" ? "Copied WhatsApp text" : "Copy WhatsApp text"}
                  </button>
                  <label className={styles.field}>
                    Email
                    <textarea readOnly value={nudge.email} aria-label="Email text" />
                  </label>
                  <button
                    type="button"
                    className={styles.ghost}
                    onClick={() => {
                      void copyText(nudge.email).then((ok) => setCopiedNudge(ok ? "email" : null));
                    }}
                  >
                    {copiedNudge === "email" ? "Copied email text" : "Copy email text"}
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}

          <details className={styles.manage}>
            <summary>Requests and teams</summary>
          {snapshot.requests.length > 1 ? (
            <label className={styles.field}>
              Request
              <select
                aria-label="Request"
                value={snapshot.selectedRequestId ?? ""}
                onChange={(event) => setRequestId(event.target.value)}
              >
                {snapshot.requests.map((request) => (
                  <option key={request.id} value={request.id}>
                    {formatServiceLabel(request.startsOn, "short")} to {formatServiceLabel(request.endsOn, "short")}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {selected ? (
            <p className={styles.meta}>
              {selected.serviceDates.length} service {selected.serviceDates.length === 1 ? "date" : "dates"} from{" "}
              {formatServiceLabel(selected.startsOn, "long")} to {formatServiceLabel(selected.endsOn, "long")}.
            </p>
          ) : null}
          {selected && !creating ? (
            <div className={styles.actions}>
              <button type="button" className={styles.ghost} onClick={() => setCreating(true)}>
                New request
              </button>
            </div>
          ) : (
          <form
            className={styles.stack}
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const created = await client.createRequest({ startsOn, endsOn, serviceDates });
                setServiceDates([]);
                setCreating(false);
                setRequestId(created.id);
                setTick((value) => value + 1);
              });
            }}
          >
            <div className={styles.range}>
              <label className={styles.field}>
                From
                <input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} required />
              </label>
              <label className={styles.field}>
                To
                <input type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} required />
              </label>
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.ghost}
                onClick={() => setServiceDates(sundaysBetween(startsOn, endsOn))}
              >
                Use the Sundays
              </button>
            </div>
            {serviceDates.length === 0 ? <p className={styles.meta}>Add at least one service date.</p> : null}
            <ul className={styles.results}>
              {serviceDates.map((date) => (
                <li key={date} className={styles.row}>
                  <span>{formatServiceLabel(date, "long")}</span>
                  <button
                    type="button"
                    className={styles.quiet}
                    onClick={() => setServiceDates((current) => current.filter((item) => item !== date))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <div className={styles.row}>
              <input
                type="date"
                aria-label="Service date"
                value={draftDate}
                onChange={(event) => setDraftDate(event.target.value)}
              />
              <button
                type="button"
                className={styles.ghost}
                onClick={() => {
                  if (!isIsoDate(draftDate) || serviceDates.includes(draftDate)) return;
                  setServiceDates((current) => [...current, draftDate].sort());
                  setDraftDate("");
                }}
              >
                Add date
              </button>
            </div>
            <button type="submit" className={styles.primary} disabled={busy || serviceDates.length === 0}>
              Create request
            </button>
          </form>
          )}

          <h2 className={styles.panelTitle}>Teams</h2>
          <form
            className={styles.row}
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await client.createTeam(teamName.trim());
                setTeamName("");
                setTick((value) => value + 1);
              });
            }}
          >
            <input
              aria-label="Team name"
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
            />
            <button type="submit" className={styles.primary} disabled={busy || teamName.trim().length === 0}>
              Add team
            </button>
          </form>
          {missingStarters.length > 0 ? (
            <div className={styles.starters} data-testid="starter-teams">
              <p className={styles.meta}>
                {missingStarters.length === 6 ? "Start with the usual teams: " : "Still to add: "}
                {missingStarters.join(", ")}. You can rename or remove any of them after.
              </p>
              <button
                type="button"
                className={styles.ghost}
                disabled={busy}
                onClick={() => {
                  void run(async () => {
                    const result = await client.addStarterTeams();
                    setStarterNote(
                      result.added.length === 0
                        ? "All the starter teams were already here."
                        : `Added ${result.added.join(", ")}.${result.alreadyPresent.length ? ` Already here: ${result.alreadyPresent.join(", ")}.` : ""}`
                    );
                    setTick((value) => value + 1);
                  });
                }}
              >
                Add starter teams
              </button>
            </div>
          ) : null}
          {starterNote ? (
            <p className={styles.meta} role="status">
              {starterNote}
            </p>
          ) : null}
          {snapshot.teams.length === 0 ? <p className={styles.meta}>No teams yet.</p> : null}
          {snapshot.teams.map((team) => (
            <section key={team.id} className={styles.card}>
              <h3>{team.name}</h3>
              <form
                className={styles.row}
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  const name = String(data.get("name") ?? "").trim();
                  void run(async () => {
                    await client.renameTeam(team.id, name);
                    setTick((value) => value + 1);
                  });
                }}
              >
                <input name="name" aria-label={`Rename ${team.name}`} defaultValue={team.name} />
                <button type="submit" className={styles.ghost} disabled={busy}>Rename</button>
              </form>
              <p className={styles.meta}>Leaders</p>
              {team.leaders.length === 0 ? <p className={styles.meta}>No leader yet.</p> : null}
              {team.leaders.map((person) => (
                <PersonRow
                  key={`leader-${person.contactId}`}
                  name={person.name}
                  teamName={team.name}
                  busy={busy}
                  onRemove={() => {
                    void run(async () => {
                      await client.removeLeader(team.id, person.contactId);
                      setTick((value) => value + 1);
                    });
                  }}
                />
              ))}
              <p className={styles.meta}>Members</p>
              {team.members.length === 0 ? <p className={styles.meta}>No one on this team yet.</p> : null}
              {team.members.map((person) => (
                <PersonRow
                  key={`member-${person.contactId}`}
                  name={person.name}
                  teamName={team.name}
                  busy={busy}
                  onRemove={() => {
                    void run(async () => {
                      await client.removeMember(team.id, person.contactId);
                      setTick((value) => value + 1);
                    });
                  }}
                />
              ))}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => {
                    setPicker({ teamId: team.id, kind: "leaders" });
                    setHits([]);
                    setQuery("");
                  }}
                >
                  Add leader
                </button>
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => {
                    setPicker({ teamId: team.id, kind: "members" });
                    setHits([]);
                    setQuery("");
                  }}
                >
                  Add member
                </button>
                <button
                  type="button"
                  className={styles.quiet}
                  onClick={() => {
                    if (confirming !== team.id) {
                      setConfirming(team.id);
                      return;
                    }
                    void run(async () => {
                      await client.deleteTeam(team.id);
                      setConfirming(null);
                      setTick((value) => value + 1);
                    });
                  }}
                >
                  {confirming === team.id ? "Confirm remove" : "Remove team"}
                </button>
              </div>
              {picker?.teamId === team.id ? (
                <form
                  className={styles.stack}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      setHits(await client.searchPeople(query));
                    });
                  }}
                >
                  <label className={styles.field}>
                    Find a person
                    <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Find a person" />
                  </label>
                  <button type="submit" className={styles.ghost} disabled={busy || query.trim().length === 0}>
                    Search
                  </button>
                  <ul className={styles.results}>
                    {hits.map((hit) => (
                      <li key={hit.contactId}>
                        <button
                          type="button"
                          className={styles.ghost}
                          onClick={() => {
                            void run(async () => {
                              if (picker.kind === "leaders") await client.addLeader(team.id, hit.contactId);
                              else await client.addMember(team.id, hit.contactId);
                              setPicker(null);
                              setTick((value) => value + 1);
                            });
                          }}
                        >
                          Add {hit.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </form>
              ) : null}
            </section>
          ))}
          <h2 className={styles.panelTitle}>Links</h2>
          <p className={styles.meta}>One link per person for this request, even when they are on more than one team.</p>
          {linkPeople.length === 0 ? <p className={styles.meta}>Add someone to a team to copy a link.</p> : null}
          {linkPeople.map((person) => (
            <div key={person.contactId} className={styles.person}>
              <div className={styles.personName}>{person.name}</div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.ghost}
                  disabled={!selected || busy}
                  onClick={() => {
                    if (!selected) return;
                    void run(async () => {
                      const issued = await client.copyLink(selected.id, person.contactId);
                      const copied = await copyText(issued.url);
                      setLinks((current) => ({
                        ...current,
                        [person.contactId]: { url: issued.url, copied, replaced: issued.replaced === true },
                      }));
                    });
                  }}
                >
                  {links[person.contactId]?.copied ? "Copied link" : "Copy link"}
                </button>
                <button
                  type="button"
                  className={styles.quiet}
                  disabled={!selected || busy}
                  onClick={() => {
                    if (!selected) return;
                    if (!window.confirm(`Reset ${person.name}'s link? The old link stops working.`)) return;
                    void run(async () => {
                      const issued = await client.resetLink(selected.id, person.contactId);
                      const copied = await copyText(issued.url);
                      setLinks((current) => ({
                        ...current,
                        [person.contactId]: { url: issued.url, copied, replaced: true },
                      }));
                    });
                  }}
                >
                  <span className={styles.resetFull}>Reset link (old link stops working)</span>
                  <span className={styles.resetShort}>Reset link</span>
                </button>
              </div>
              {links[person.contactId]?.replaced ? (
                <p className={styles.meta}>The old link stopped working. This is a new one.</p>
              ) : null}
              {links[person.contactId] ? (
                <input className={styles.linkBox} readOnly value={links[person.contactId].url} aria-label={`Link for ${person.name}`} />
              ) : null}
            </div>
          ))}

          </details>
          {error && phase === "ready" ? (
            <p className={styles.error} role="alert">{error}</p>
          ) : null}
          {selected ? (
            <div className={styles.pinned}>
              <button type="button" className={styles.primary} disabled={busy || unanswered === 0} onClick={() => prepareNudge()}>
                <ChatIcon />
                {unanswered === 0 ? "Everyone has answered" : `Nudge ${unanswered} who haven’t answered`}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function PersonRow({
  name,
  teamName,
  busy,
  onRemove,
}: {
  name: string;
  teamName: string;
  busy: boolean;
  onRemove: () => void;
}) {
  return (
    <div className={styles.person}>
      <div className={styles.personName}>{name}</div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.quiet}
          disabled={busy}
          onClick={() => {
            if (!window.confirm(`Remove ${name} from ${teamName}?`)) return;
            onRemove();
          }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}
