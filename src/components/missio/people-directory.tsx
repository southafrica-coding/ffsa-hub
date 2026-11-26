"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import {
  DEFAULT_PEOPLE_LIMIT,
  missioSkinVars,
  STATUS_LABEL,
  formatJoined,
  type PeopleQuery,
} from "./access";
import { familyLine } from "@/lib/missio/family-format";
import { MissioApiError, missioClient, missioErrorCopy, type MissioClient } from "./api";
import { AddPersonDialog } from "./add-person";
import { MissioDialog } from "./missio-dialog";
import { HouseholdsView } from "./households/households-view";
import { FamilySuggestionsEntry } from "./households/couple-suggestions";
import type { SuggestionsClient } from "./households/suggestions-client";
import { missioPortalClass } from "./portal";
import people from "./people.module.css";
import type { MissioCampus, MissioPerson, MissioPersonHouse, MissioServingCounts, MissioStatus } from "./types-shim";
import content from "./content.module.css";
import styles from "./shell.module.css";

type ListState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; rows: MissioPerson[]; total: number };

type Serves = "" | "yes" | "no" | "interested";

const CAMPUS_SHORT: Record<MissioCampus, string> = { potch: "Potch", jhb: "JHB" };

const STAGE_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  visited_house: "Visited a house",
  joined: "Joined",
};

/** One of the five avatar tints (board M1b), fixed per person. */
export function avatarTint(id: string): 1 | 2 | 3 | 4 | 5 {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return ((hash % 5) + 1) as 1 | 2 | 3 | 4 | 5;
}

export function Avatar({ id, name, small = false }: { id: string; name: string; small?: boolean }) {
  return (
    <span className={`${people.av} ${small ? people.avSm : ""} ${people[`a${avatarTint(id)}`]}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

const ROLE_WORD: Record<MissioPersonHouse["role"], string> = { leader: "Leader", co_leader: "Co-leader", member: "Member" };

function houseName(house: MissioPersonHouse): string {
  return house.name?.trim() || `House ${house.number}`;
}

function inFollowUp(person: MissioPerson): boolean {
  return Boolean(stageLabel(person)) && person.currentStage?.trim().toLowerCase() !== "joined";
}

/**
 * The row's second line (board M2b): their house and role ("House 1 · Leader",
 * "House 4 + 1 more"), or "Not in a house yet" with their follow-up stage.
 * When the houses couldn't be read, status and when they joined instead.
 */
export function personMeta(person: MissioPerson): { text: string; follow: boolean } {
  if (person.houses) {
    const [first, ...rest] = person.houses;
    if (first) {
      const role = first.role === "member" ? "" : ` · ${ROLE_WORD[first.role]}`;
      return { text: `${houseName(first)}${role}${rest.length > 0 ? ` + ${rest.length} more` : ""}`, follow: false };
    }
    if (inFollowUp(person)) return { text: `Not in a house yet · ${stageLabel(person)}`, follow: true };
    if (person.status === "inactive") return { text: "Not in a house yet · Inactive", follow: false };
    return { text: "Not in a house yet", follow: person.status === "visitor" };
  }
  return statusMeta(person);
}

/** "Visitor · Contacted" while someone is in follow-up, otherwise status and when they joined. */
function statusMeta(person: MissioPerson): { text: string; follow: boolean } {
  const stage = stageLabel(person);
  if (stage && person.currentStage?.trim().toLowerCase() !== "joined") {
    return { text: `${STATUS_LABEL[person.status]} · ${stage}`, follow: true };
  }
  const joined = personJoined(person);
  return { text: joined ? `${STATUS_LABEL[person.status]} · Joined ${joined}` : STATUS_LABEL[person.status], follow: false };
}

function stageLabel(person: MissioPerson): string {
  const raw = personStage(person);
  if (!raw) return "";
  return STAGE_LABEL[raw.toLowerCase()] ?? raw;
}

function statusChip(status: MissioStatus): string {
  if (status === "active") return people.cOlive;
  if (status === "visitor") return people.cGold;
  return people.cSub;
}

export function PeopleDirectory({
  client = missioClient,
  suggestions,
}: {
  client?: MissioClient;
  /** Couple suggestions (the Family suggestions link). */
  suggestions?: SuggestionsClient;
}) {
  const params = useSearchParams();
  const [campus, setCampus] = useState<"" | MissioCampus>("");
  const [status, setStatus] = useState<"" | MissioStatus>("");
  const [draft, setDraft] = useState(() => params.get("q") ?? "");
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const [serves, setServes] = useState<Serves>("");
  const [team, setTeam] = useState("");
  // Kept across loads so the funnel doesn't flicker while a filter loads.
  const [serving, setServing] = useState<MissioServingCounts | null>(null);
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(0);
  const [list, setList] = useState<ListState>({ phase: "loading" });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MissioPerson | null>(null);
  const [filtering, setFiltering] = useState(false);
  // Households open from a person's household card (board M14a). An old
  // ?view=households link still lands on the list.
  const view: "people" | "households" = params.get("view") === "households" ? "households" : "people";
  const [focusPersonId, setFocusPersonId] = useState<string | null>(null);

  const query = useMemo<PeopleQuery>(
    () => ({ campus, status, q, serves, team, limit: DEFAULT_PEOPLE_LIMIT, offset }),
    [campus, status, q, serves, team, offset]
  );

  useEffect(() => {
    let active = true;
    setList({ phase: "loading" });
    client.listPeople(query).then(
      (page) => {
        if (!active) return;
        setList({ phase: "ready", rows: page.rows, total: page.total });
        setServing(page.serving ?? null);
      },
      (error: unknown) => {
        if (!active) return;
        const message = error instanceof MissioApiError ? error.message : "People didn’t load.";
        setList({ phase: "error", message });
      }
    );
    return () => {
      active = false;
    };
  }, [client, query, tick]);

  // Search as you type (no search button on the board), a beat after the last key.
  useEffect(() => {
    const next = draft.trim();
    if (next === q) return;
    const timer = window.setTimeout(() => {
      setOffset(0);
      setQ(next);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, q]);

  useEffect(() => {
    if (!focusPersonId || list.phase !== "ready") return;
    const row = list.rows.find((person) => person.id === focusPersonId);
    if (!row) return;
    setEditing(row);
    setFocusPersonId(null);
  }, [focusPersonId, list]);

  const total = list.phase === "ready" ? list.total : 0;
  const sorted = useMemo(() => (list.phase === "ready" ? byName(list.rows) : []), [list]);
  // The Family column shows once anyone on the page has a household. Rows
  // without one read "—" there; on the phone they simply have no line.
  const anyFamily = sorted.some((person) => Boolean(person.family));
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + DEFAULT_PEOPLE_LIMIT, total);
  const activeFilters = (campus ? 1 : 0) + (status ? 1 : 0);
  const servingFiltered = Boolean(serves || team);
  const filtered = Boolean(q || campus || status || servingFiltered);
  const pickCampus = (value: "" | MissioCampus) => {
    setCampus(value);
    setOffset(0);
  };
  const pickStatus = (value: "" | MissioStatus) => {
    setStatus(value);
    setOffset(0);
  };
  // One serving pick at a time (a segment, a team, or Interested). Tapping
  // the one that's on again clears it.
  const pickServing = (next: { serves?: Serves; team?: string }) => {
    const nextServes = next.serves ?? "";
    const nextTeam = next.team ?? "";
    const same = nextServes === serves && nextTeam === team;
    setServes(same ? "" : nextServes);
    setTeam(same ? "" : nextTeam);
    setOffset(0);
  };
  const clearFilters = () => {
    pickCampus("");
    pickStatus("");
    setServes("");
    setTeam("");
  };

  return (
    <div className={`${content.page} ${people.root}`}>
      <div className={people.head}>
        <div className={people.headText}>
          <h1 className={people.title}>People</h1>
          <p className={people.sub}>
            {list.phase === "ready" ? `${total} ${total === 1 ? "person" : "people"}${filtered ? " match" : ""}` : " "}
          </p>
        </div>
        <button type="button" className={people.btnP} onClick={() => setAdding(true)}>
          <PlusIcon />
          Add a person
        </button>
      </div>

      <form
        className={people.searchBlock}
        data-testid="people-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setOffset(0);
          setQ(String(data.get("q") ?? "").trim());
        }}
      >
        <div className={people.searchRow}>
          <label className={people.search}>
            <span className={people.searchIcon}>
              <SearchIcon />
            </span>
            <input
              className={people.searchInput}
              name="q"
              type="search"
              aria-label={view === "households" ? "Search households" : "Search names"}
              placeholder="Search by name"
              autoComplete="off"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          {view === "people" ? (
            <button
              type="button"
              className={`${people.btnS} ${people.phoneOnly}`}
              style={{ padding: "0 14px" }}
              onClick={() => setFiltering(true)}
              aria-haspopup="dialog"
            >
              Filter
              {activeFilters > 0 ? <span className={people.count}>{activeFilters}</span> : null}
            </button>
          ) : null}
          <button type="button" className={`${people.iconBtn} ${people.phoneOnly}`} aria-label="Add a person" onClick={() => setAdding(true)}>
            <PlusIcon />
          </button>
          <button type="submit" className={people.visuallyHidden} tabIndex={-1}>
            Search
          </button>
        </div>

        {view === "people" ? (
          <div className={`${people.activeRow} ${people.deskOnly}`}>
            <ChipSelect
              id="missio-campus"
              label="Campus"
              value={campus}
              onChange={(value) => pickCampus(value as "" | MissioCampus)}
              options={[
                ["", "All campuses"],
                ["potch", "Potch"],
                ["jhb", "JHB"],
              ]}
            />
            <ChipSelect
              id="missio-status"
              label="Status"
              value={status}
              onChange={(value) => pickStatus(value as "" | MissioStatus)}
              options={[
                ["", "All statuses"],
                ["visitor", "Visitor"],
                ["active", "Active"],
                ["inactive", "Inactive"],
              ]}
            />
          </div>
        ) : null}

        {view === "people" ? (
          <div className={`${people.activeRow} ${people.phoneOnly}`} data-testid="people-active-filters">
            {/* Campus pills under the search (board M2b): one tap filters, a second clears. */}
            {(["potch", "jhb"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={`${people.fchip} ${people.pill} ${campus === option ? people.fchipOn : ""}`}
                aria-pressed={campus === option}
                onClick={() => pickCampus(campus === option ? "" : option)}
              >
                {CAMPUS_SHORT[option]}
              </button>
            ))}
            {status ? (
              <button type="button" className={`${people.fchip} ${people.fchipOn} ${people.fchipActive}`} onClick={() => pickStatus("")} aria-label={`Remove ${STATUS_LABEL[status]} filter`}>
                {STATUS_LABEL[status]}
                <XIcon />
              </button>
            ) : null}
            {list.phase === "ready" && !serving ? (
              <span className={people.total}>
                {total} {total === 1 ? "person" : "people"}
              </span>
            ) : null}
          </div>
        ) : null}

        {view === "people" && serving ? (
          <ServingFunnel
            serving={serving}
            serves={serves}
            team={team}
            total={list.phase === "ready" ? total : null}
            onPick={pickServing}
          />
        ) : null}
      </form>

      {view === "people" ? <FamilySuggestionsEntry client={suggestions} /> : null}

      {view === "households" ? (
        <HouseholdsView filter={draft} />
      ) : (
        <>
          {list.phase === "loading" ? (
            <div className={`${people.card} ${people.stateCard}`} data-state="loading" role="status" aria-label="Loading people" style={{ padding: 0, gap: 0, alignItems: "stretch" }}>
              {[52, 44, 58].map((width, index) => (
                <div key={width} className={people.lrow} style={index === 2 ? { borderBottom: 0 } : undefined}>
                  <span className={people.skel} style={{ width: 36, height: 36, borderRadius: "50%" }} />
                  <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                    <span className={people.skel} style={{ width: `${width}%`, height: 12 }} />
                    <span className={people.skel} style={{ width: `${width - 18}%`, height: 10 }} />
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {list.phase === "error" ? (
            <div className={`${people.card} ${people.errorCard}`} data-state="error" role="alert">
              <span>
                <AlertIcon />
              </span>
              <div style={{ flex: 1 }}>
                <b>{list.message}</b>
              </div>
              <button type="button" className={`${people.btnS} ${people.sm}`} onClick={() => setTick((n) => n + 1)}>
                Try again
              </button>
            </div>
          ) : null}
          {list.phase === "ready" && list.rows.length === 0 ? (
            <div className={`${people.card} ${people.stateCard}`} data-state="empty">
              <span className={`${people.stateIcon} ${filtered ? "" : people.stateIconTerra}`}>{filtered ? <SearchIcon /> : <PeopleIcon />}</span>
              <p className={people.stateTitle}>{filtered ? (q ? `No one called “${q}”` : "No one matches those filters") : "No people yet"}</p>
              <p className={people.stateBody}>
                {filtered ? "They might be under another filter, or not on the list yet." : "Add the first person to Missio."}
              </p>
              <div className={people.stateActions}>
                {filtered && (campus || status || servingFiltered) ? (
                  <button type="button" className={`${people.btnS} ${people.sm}`} onClick={clearFilters}>
                    Clear filters
                  </button>
                ) : null}
                <button type="button" className={`${filtered ? people.btnG : people.btnP} ${people.sm}`} onClick={() => setAdding(true)}>
                  {filtered && q ? `Add ${q}` : "Add a person"}
                </button>
              </div>
            </div>
          ) : null}
          {list.phase === "ready" && list.rows.length > 0 ? (
            <>
              <ul className={`${people.list} ${people.bleed} ${people.phoneOnly}`} data-testid="people-cards">
                {sorted.map((person, index) => {
                  const letter = firstLetter(person.name);
                  const showLetter = index === 0 || firstLetter(sorted[index - 1].name) !== letter;
                  const meta = personMeta(person);
                  const chips = hasServingChips(person);
                  const family = familyLine(person.family);
                  return (
                    <li key={person.id}>
                      {showLetter ? (
                        <div className={people.sect} aria-hidden="true" data-testid="people-letter">
                          {letter}
                        </div>
                      ) : null}
                      <Link href={`/missio/people/${encodeURIComponent(person.id)}`} className={`${people.lrow} ${chips || family ? people.lrowTall : ""}`}>
                        <Avatar id={person.id} name={person.name} />
                        <span className={people.lrowText}>
                          <span className={people.nm} style={{ display: "block" }}>
                            {person.name}
                          </span>
                          <span className={`${people.meta} ${meta.follow ? people.metaFollow : ""}`} style={{ display: "block" }} data-testid="person-meta">
                            {meta.text}
                          </span>
                          {family ? (
                            <span className={people.family} title={family} data-testid="person-family">
                              {family}
                            </span>
                          ) : null}
                          {chips ? <ServingChips person={person} /> : null}
                        </span>
                        <span className={people.tag}>{CAMPUS_SHORT[person.campus]}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <div className={`${people.card} ${people.deskBlock} ${people.tableScroll}`}>
                <table className={people.table} data-testid="people-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>House church</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Follow-up stage</th>
                      {serving ? <th>Serves</th> : null}
                      {anyFamily ? <th>Family</th> : null}
                      <th>Campus</th>
                      <th>
                        <span className={people.visuallyHidden}>Edit</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((person) => (
                      <tr key={person.id}>
                        <td>
                          <Link href={`/missio/people/${encodeURIComponent(person.id)}`} className={people.nmcell}>
                            <Avatar id={person.id} name={person.name} small />
                            <span>{person.name}</span>
                          </Link>
                        </td>
                        <HouseCells person={person} />
                        <td>
                          <span className={`${people.chip} ${statusChip(person.status)}`} data-status={person.status}>
                            <span className={people.dot} />
                            {STATUS_LABEL[person.status]}
                          </span>
                        </td>
                        <td className={stageLabel(person) ? people.ink2 : people.ink3}>{stageLabel(person) || "—"}</td>
                        {serving ? (
                          <td className={`${people.servesCell} ${hasServingChips(person) ? "" : people.ink3}`}>
                            {hasServingChips(person) ? <ServingChips person={person} /> : "—"}
                          </td>
                        ) : null}
                        {anyFamily ? (
                          <td className={`${people.familyCell} ${familyLine(person.family) ? people.ink2 : people.ink3}`} data-testid="person-family-cell">
                            {familyLine(person.family) || "—"}
                          </td>
                        ) : null}
                        <td>
                          <span className={people.tag}>{CAMPUS_SHORT[person.campus]}</span>
                        </td>
                        <td>
                          <button type="button" className={`${people.btnG} ${people.sm}`} aria-label={`Edit ${person.name}`} onClick={() => setEditing(person)}>
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          {list.phase === "ready" && list.rows.length > 0 ? (
            <div className={people.foot}>
              <span>
                {total > DEFAULT_PEOPLE_LIMIT ? `${from}–${to} of ${total}` : `Showing ${total} ${total === 1 ? "person" : "people"}`}
              </span>
              {total > DEFAULT_PEOPLE_LIMIT ? (
                <div className={people.pagerActions}>
                  <button type="button" className={`${people.btnS} ${people.sm}`} disabled={offset === 0} onClick={() => setOffset((n) => Math.max(0, n - DEFAULT_PEOPLE_LIMIT))}>
                    Previous
                  </button>
                  <button
                    type="button"
                    className={`${people.btnS} ${people.sm}`}
                    disabled={offset + DEFAULT_PEOPLE_LIMIT >= total}
                    onClick={() => setOffset((n) => n + DEFAULT_PEOPLE_LIMIT)}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {filtering ? (
        <FilterSheet
          campus={campus}
          status={status}
          total={list.phase === "ready" ? total : null}
          onCampus={pickCampus}
          onStatus={pickStatus}
          onReset={clearFilters}
          onClose={() => setFiltering(false)}
        />
      ) : null}
      {adding ? (
        <AddPersonDialog
          client={client}
          onClose={() => setAdding(false)}
          onCreated={() => setTick((n) => n + 1)}
          onViewPerson={(personId, name) => {
            setAdding(false);
            setCampus("");
            setStatus("");
            setDraft(name);
            setQ(name);
            setOffset(0);
            setFocusPersonId(personId);
          }}
        />
      ) : null}
      {editing ? (
        <EditPerson
          person={editing}
          client={client}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setTick((n) => n + 1);
          }}
          onNotFound={() => setTick((n) => n + 1)}
        />
      ) : null}
    </div>
  );
}

function hasServingChips(person: MissioPerson): boolean {
  return (person.teams?.length ?? 0) + (person.interestTeams?.length ?? 0) > 0;
}

/**
 * Serving chips on a row: "Leads Kids" (terra), "Sound" (olive) for each
 * team they're on, then "Interested · Worship" (gold, dashed) for a new
 * WhatsApp interest. Text on every chip, so colour is never the only cue.
 */
export function ServingChips({ person }: { person: MissioPerson }) {
  const teams = person.teams ?? [];
  const interests = person.interestTeams ?? [];
  return (
    <span className={people.serveChips} data-testid="person-serving">
      {teams.map((item) =>
        item.leads ? (
          <span key={item.id} className={`${people.sChip} ${people.sLead}`} data-kind="leads">
            Leads {item.name}
          </span>
        ) : (
          <span key={item.id} className={people.sChip} data-kind="serves">
            <span className={people.visuallyHidden}>Serves </span>
            {item.name}
          </span>
        )
      )}
      {interests.map((item) => (
        <span key={`${item.teamId ?? "other"}-${item.name}`} className={`${people.sChip} ${people.sInterest}`} data-kind="interested">
          Interested · {item.name}
        </span>
      ))}
    </span>
  );
}

const SERVES_WORD: Record<Exclude<Serves, "">, string> = { yes: "Serves", no: "Doesn’t serve", interested: "Interested" };

function peopleWord(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

/**
 * The visible serving funnel under the search: All · Serves · Doesn't, then a
 * chip per roster team and Interested, each with its count. Counts follow
 * campus, status and search, and hold still while a serving pick is on.
 */
function ServingFunnel({
  serving,
  serves,
  team,
  total,
  onPick,
}: {
  serving: MissioServingCounts;
  serves: Serves;
  team: string;
  total: number | null;
  onPick: (next: { serves?: Serves; team?: string }) => void;
}) {
  const all = serving.serves + serving.doesnt;
  const activeTeam = serving.teams.find((item) => item.id === team);
  const segments: Array<{ value: Serves; label: string; count: number; on: boolean }> = [
    { value: "", label: "All", count: all, on: !serves && !team },
    { value: "yes", label: "Serves", count: serving.serves, on: serves === "yes" || (Boolean(team) && !serves) },
    { value: "no", label: "Doesn’t", count: serving.doesnt, on: serves === "no" },
  ];
  const pickedLabel = activeTeam?.name ?? (serves ? SERVES_WORD[serves] : "");
  const line =
    total == null
      ? " "
      : pickedLabel
        ? `${peopleWord(total)} ${total === 1 ? "matches" : "match"} · ${pickedLabel}`
        : `${peopleWord(total)} · ${serving.serves} ${serving.serves === 1 ? "serves" : "serve"}`;

  return (
    <div className={people.funnel} data-testid="serving-funnel">
      <div className={people.seg} role="group" aria-label="Serving">
        {segments.map((segment) => (
          <button
            key={segment.label}
            type="button"
            className={`${people.segBtn} ${segment.on ? people.segOn : ""}`}
            aria-pressed={segment.on}
            aria-label={`${segment.label === "Doesn’t" ? "Doesn’t serve" : segment.label}, ${peopleWord(segment.count)}`}
            onClick={() => {
              if (segment.value === "") onPick({});
              else if (segment.on) onPick({ serves: serves, team }); // second tap clears
              else onPick({ serves: segment.value });
            }}
          >
            <span className={people.segLabel}>{segment.label}</span>
            <span className={people.segCount}>{segment.count}</span>
          </button>
        ))}
      </div>
      {serving.teams.length > 0 || serving.interested > 0 || serves === "interested" ? (
        <div className={people.teamChips} role="group" aria-label="Serving teams">
          {serving.teams.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${people.fchip} ${people.tchip} ${team === item.id ? people.fchipOn : ""}`}
              aria-pressed={team === item.id}
              aria-label={`${item.name}, ${peopleWord(item.count)}`}
              onClick={() => onPick({ team: item.id })}
            >
              {item.name}
              <span className={people.tcount}>{item.count}</span>
            </button>
          ))}
          {serving.interested > 0 || serves === "interested" ? (
            <button
              type="button"
              className={`${people.fchip} ${people.tchip} ${people.tchipInterest} ${serves === "interested" ? people.fchipOn : ""}`}
              aria-pressed={serves === "interested"}
              aria-label={`Interested, ${peopleWord(serving.interested)}`}
              onClick={() => onPick({ serves: "interested" })}
            >
              Interested
              <span className={people.tcount}>{serving.interested}</span>
            </button>
          ) : null}
        </div>
      ) : null}
      <p className={people.funnelLine} data-testid="serving-count">
        {line}
      </p>
      {serving.teams.length === 0 ? (
        <p className={people.funnelNote} data-testid="serving-empty">
          No serving teams yet. <Link href="/missio/volunteers">Add teams on Volunteers</Link>
        </p>
      ) : null}
    </div>
  );
}

/** Board M2a: "House 4 + Oak Table" and the role there. "—" when they're in no house or it couldn't be read. */
function HouseCells({ person }: { person: MissioPerson }) {
  const [first, ...rest] = person.houses ?? [];
  if (!first) {
    return (
      <>
        <td className={people.ink3}>—</td>
        <td className={people.ink3}>—</td>
      </>
    );
  }
  return (
    <>
      <td className={people.ink2}>
        {houseName(first)}
        {rest.length > 0 ? <span className={people.ink3}> + {rest.map(houseName).join(", ")}</span> : null}
      </td>
      <td className={people.ink2}>{ROLE_WORD[first.role]}</td>
    </>
  );
}

/** A to Z by the name shown, so letter headings never repeat within a page. */
function byName(rows: MissioPerson[]): MissioPerson[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

function firstLetter(name: string): string {
  const letter = name.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(letter) ? letter : "#";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

function ChipSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <span className={`${people.chipSelect} ${value ? people.chipSelectOn : ""}`}>
      <span className={people.visuallyHidden} id={`${id}-label`}>
        {label}
      </span>
      <select id={id} aria-labelledby={`${id}-label`} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, text]) => (
          <option key={optionValue} value={optionValue}>
            {optionValue ? text : label}
          </option>
        ))}
      </select>
      <span className={people.chipCaret}>
        <UpDownIcon />
      </span>
    </span>
  );
}

/** Board M2b · 2: one sheet for every filter. Each tap applies straight away. */
function FilterSheet({
  campus,
  status,
  total,
  onCampus,
  onStatus,
  onReset,
  onClose,
}: {
  campus: "" | MissioCampus;
  status: "" | MissioStatus;
  total: number | null;
  onCampus: (value: "" | MissioCampus) => void;
  onStatus: (value: "" | MissioStatus) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={people.scrim} />
        <Dialog.Content className={missioPortalClass(people.sheet)} style={missioSkinVars() as CSSProperties} aria-describedby={undefined} data-testid="people-filter-sheet">
          <span className={people.grab} aria-hidden="true" />
          <div className={people.sheetHead}>
            <Dialog.Title className={people.sheetTitle}>Filter</Dialog.Title>
            <button type="button" className={people.btnG} onClick={onReset}>
              Reset
            </button>
          </div>
          <div className={people.sheetBody}>
            <fieldset className={people.group}>
              <legend className={people.flabel}>Campus</legend>
              <div className={people.chipsWrap}>
                {(["potch", "jhb"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`${people.fchip} ${campus === option ? people.fchipOn : ""}`}
                    aria-pressed={campus === option}
                    onClick={() => onCampus(campus === option ? "" : option)}
                  >
                    {campus === option ? <CheckIcon /> : null}
                    {CAMPUS_SHORT[option]}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className={people.group}>
              <legend className={people.flabel}>Status</legend>
              <div className={people.chipsWrap}>
                {(["visitor", "active", "inactive"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`${people.fchip} ${status === option ? people.fchipOn : ""}`}
                    aria-pressed={status === option}
                    onClick={() => onStatus(status === option ? "" : option)}
                  >
                    {status === option ? <CheckIcon /> : null}
                    {STATUS_LABEL[option]}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
          <div className={people.sheetFoot}>
            <button type="button" className={people.btnP} onClick={onClose}>
              {total == null ? "Show people" : `Show ${total} ${total === 1 ? "person" : "people"}`}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function UpDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
      <path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.8.8 3 2.6 3.5 5.2" />
    </svg>
  );
}

function personStage(person: MissioPerson): string {
  return person.currentStage?.trim() ?? "";
}

function personJoined(person: MissioPerson): string {
  return person.joinedAt ? formatJoined(person.joinedAt) : "";
}

export function EditPerson({
  person,
  client,
  onClose,
  onSaved,
  onNotFound,
}: {
  person: MissioPerson;
  client: MissioClient;
  onClose: () => void;
  onSaved: () => void;
  onNotFound: () => void;
}) {
  const [campus, setCampus] = useState<MissioCampus>(person.campus);
  const [status, setStatus] = useState<MissioStatus>(person.status);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: { campus?: MissioCampus; status?: MissioStatus }) {
    setPending(true);
    setError(null);
    try {
      await client.updatePerson(person.id, patch);
      onSaved();
    } catch (caught) {
      const missing = caught instanceof MissioApiError && caught.code === "not_found";
      setError(missing ? "This person couldn’t be found" : caught instanceof MissioApiError ? missioErrorCopy(caught, "submit") : "Couldn’t save.");
      if (missing) onNotFound();
      setPending(false);
    }
  }

  return (
    <MissioDialog onClose={onClose} title={`Edit ${person.name}`} testId="edit-person">
        <p className={styles.help}>Campus and status only. There’s no delete — mark someone inactive when they leave.</p>
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.fields}>
          <label className={styles.field}>
            Campus
            <select aria-label="Edit campus" value={campus} onChange={(event) => setCampus(event.target.value as MissioCampus)}>
              <option value="potch">Missio Potch</option>
              <option value="jhb">Missio JHB</option>
            </select>
          </label>
          <label className={styles.field}>
            Status
            <select aria-label="Edit status" value={status} onChange={(event) => setStatus(event.target.value as MissioStatus)}>
              <option value="visitor">Visitor</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>
        <div className={styles.actions}>
          {person.status !== "inactive" ? (
            <button
              type="button"
              className={styles.markInactive}
              disabled={pending}
              onClick={() => void save({ status: "inactive" })}
            >
              Mark inactive
            </button>
          ) : (
            <span className={styles.spacer} />
          )}
          <button type="button" className={styles.ghost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.primary} disabled={pending} onClick={() => void save({ campus, status })}>
            Save
          </button>
        </div>
    </MissioDialog>
  );
}
