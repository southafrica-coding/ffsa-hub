"use client";

import { useEffect, useState } from "react";
import content from "@/components/missio/content.module.css";
import { formatServiceLabel, isIsoDate, sundaysBetween } from "@/lib/missio/availability/dates";
import type { VolunteersSnapshot } from "@/lib/missio/availability/service";
import { volunteersClient, type NudgeDraft, type PeopleHit, type VolunteersClient } from "./client";
import styles from "./volunteers.module.css";

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

  return (
    <div className={`${content.page} ${styles.root}`} data-testid="volunteers-board">
      <p className={`${content.eyebrow}`}>Serving</p>
      <h1 className={content.title}>Volunteers</h1>
      <p className={content.lede}>Build the teams, pick the Sundays, and copy a personal link.</p>

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
          <h2>This week</h2>
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
              {snapshot.unansweredPeople === 0
                ? " Everyone on a team has answered."
                : ` ${snapshot.unansweredPeople} ${snapshot.unansweredPeople === 1 ? "person has" : "people have"} not answered every service date.`}
            </p>
          ) : (
            <p className={styles.meta}>No serving request yet.</p>
          )}

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

          <h2>Who is in</h2>
          {snapshot.grid.length === 0 || !selected ? (
            <p className={styles.meta}>The grid shows once a team and a request both exist.</p>
          ) : (
            <>
              <ul className={styles.legend}>
                <li><i data-tone="in" aria-hidden="true" />In</li>
                <li><i data-tone="maybe" aria-hidden="true" />Maybe</li>
                <li><i data-tone="out" aria-hidden="true" />Out</li>
                <li><i data-tone="none" aria-hidden="true" />No answer</li>
              </ul>
              <div className={styles.scroll} data-testid="volunteers-grid">
                <table className={styles.grid}>
                  <thead>
                    <tr>
                      <th className={styles.teamCol}>Team</th>
                      {selected.serviceDates.map((date) => (
                        <th key={date} className={styles.dateCol}>
                          {formatServiceLabel(date, "short")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.grid.map((team) => (
                      <tr key={team.teamId}>
                        <th className={styles.teamCol} scope="row">
                          <span className={styles.teamName}>{team.name}</span>
                        </th>
                        {team.dates.map((cell) => (
                          <td key={cell.serviceDate}>
                            <span className={styles.count} data-tone="in">{cell.counts.available} in</span>
                            <span className={styles.count} data-tone="maybe">{cell.counts.maybe} maybe</span>
                            <span className={styles.count} data-tone="out">{cell.counts.unavailable} out</span>
                            <span className={styles.count} data-tone="none">{cell.counts.unanswered} no answer</span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <h2>Messages</h2>
          <p className={styles.meta}>
            Preparing a message reuses each person’s current link, and makes one only if they do not have a live link. It does not send anything.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={busy || !selected || snapshot.unansweredPeople === 0}
              onClick={() => {
                if (!selected) return;
                void run(async () => {
                  setNudge(await client.nudge(selected.id));
                  setCopiedNudge(null);
                });
              }}
            >
              Prepare messages
            </button>
          </div>
          {selected && snapshot.unansweredPeople === 0 ? <p className={styles.meta}>Everyone on a team has answered.</p> : null}
          {nudge && nudge.count > 0 ? (
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

          <h2>Links</h2>
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

          <h2>Teams</h2>
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
          {error && phase === "ready" ? (
            <p className={styles.error} role="alert">{error}</p>
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
