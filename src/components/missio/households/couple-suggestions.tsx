"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isMissioPastor } from "../access";
import { MissioApiError } from "../api";
import content from "../content.module.css";
import { missioFixedCopy } from "../errors";
import { useMissioViewer } from "../viewer";
import { suggestionsClient, type HouseholdSuggestion, type SuggestionsClient } from "./suggestions-client";
import styles from "./suggestions.module.css";

/**
 * Couple suggestions from the house church sheet (migration 398). A pastor
 * links the pair as a household or says they're not a couple. Nothing is
 * linked without a tap, and when one of them already has a household the
 * pastor confirms a second time before the other joins it. Pastors only.
 */

type Stage =
  | { kind: "ask" }
  | { kind: "confirm"; householdTitle: string; joiningPersonId: string }
  | { kind: "linked" }
  | { kind: "dismissed" };

function copyFor(caught: unknown): string {
  return missioFixedCopy(caught instanceof MissioApiError ? caught.code : null);
}

function PersonName({ person, linked }: { person: HouseholdSuggestion["a"]; linked: boolean }) {
  if (!linked) return <>{person.firstName}</>;
  return (
    <Link href={`/missio/people/${encodeURIComponent(person.personId)}`} className={styles.personLink}>
      {person.firstName}
    </Link>
  );
}

/** One pair: the sentence, Link household and Not a couple. */
export function SuggestionCard({
  suggestion,
  selfPersonId,
  client = suggestionsClient,
  onDone,
}: {
  suggestion: HouseholdSuggestion;
  /** On a profile: this person is named first and isn't a link. */
  selfPersonId?: string;
  client?: SuggestionsClient;
  onDone?: (result: "linked" | "dismissed") => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: "ask" });
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const swap = selfPersonId !== undefined && suggestion.b.personId === selfPersonId;
  const first = swap ? suggestion.b : suggestion.a;
  const second = swap ? suggestion.a : suggestion.b;
  const linkNames = selfPersonId === undefined;
  const joining = stage.kind === "confirm" ? [suggestion.a, suggestion.b].find((p) => p.personId === stage.joiningPersonId) : undefined;

  async function act(run: () => Promise<void>) {
    setPending(true);
    setNotice(null);
    try {
      await run();
    } catch (caught) {
      setNotice(copyFor(caught));
    } finally {
      setPending(false);
    }
  }

  const accept = (addToExisting?: boolean) =>
    act(async () => {
      const outcome = await client.accept(suggestion.id, addToExisting ? { addToExisting: true } : undefined);
      if (outcome.kind === "confirm") {
        setStage({ kind: "confirm", householdTitle: outcome.householdTitle, joiningPersonId: outcome.joiningPersonId });
        return;
      }
      setStage({ kind: "linked" });
      onDone?.("linked");
    });

  const dismiss = () =>
    act(async () => {
      await client.dismiss(suggestion.id);
      setStage({ kind: "dismissed" });
      onDone?.("dismissed");
    });

  const kicker = `Family suggestion${suggestion.houseNumber ? ` · House ${suggestion.houseNumber}` : ""}`;

  return (
    <section className={styles.banner} data-testid="couple-suggestion" aria-label={`Family suggestion: ${first.firstName} and ${second.firstName}`}>
      <p className={styles.kicker}>{kicker}</p>
      {stage.kind === "linked" ? (
        <p className={styles.done} role="status">
          Linked. {first.firstName} and {second.firstName} are one household now.
        </p>
      ) : null}
      {stage.kind === "dismissed" ? (
        <p className={styles.done} role="status">
          Got it. They won’t be suggested again.
        </p>
      ) : null}
      {stage.kind === "ask" ? (
        <>
          <p className={styles.text}>
            <PersonName person={first} linked={linkNames} /> and <PersonName person={second} linked={linkNames} /> were listed together
            on the house church sheet. Link them as a household?
          </p>
          {suggestion.link === "same" ? <p className={styles.note}>They’re already in one household. Link marks this as done.</p> : null}
          {suggestion.link === "separate" ? (
            <p className={styles.note}>
              They’re each in a different household, so this can’t link them. Open their profiles to sort that out.
            </p>
          ) : null}
          <div className={styles.actions}>
            {suggestion.link !== "separate" ? (
              <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={pending} onClick={() => void accept()}>
                Link household
              </button>
            ) : null}
            <button type="button" className={`${styles.btn} ${styles.secondary}`} disabled={pending} onClick={() => void dismiss()}>
              Not a couple
            </button>
          </div>
        </>
      ) : null}
      {stage.kind === "confirm" ? (
        <>
          <p className={styles.text} data-testid="couple-suggestion-confirm">
            {joining?.firstName ?? "They"} would join {stage.householdTitle}. Nobody is taken out of it, and no children are added.
          </p>
          <div className={styles.actions}>
            <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={pending} onClick={() => void accept(true)}>
              Add {joining?.firstName ?? "them"}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.secondary}`}
              disabled={pending}
              onClick={() => {
                setNotice(null);
                setStage({ kind: "ask" });
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : null}
      {notice ? (
        <p className={styles.notice} role="alert">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

/** Pending suggestions for pastors; null until loaded, and for everyone else. */
function usePending(load: (() => Promise<HouseholdSuggestion[]>) | null, deps: unknown[]) {
  const [state, setState] = useState<{ phase: "loading" } | { phase: "ready"; list: HouseholdSuggestion[] } | { phase: "error" }>({
    phase: "loading",
  });
  useEffect(() => {
    if (!load) return;
    let live = true;
    load().then(
      (list) => live && setState({ phase: "ready", list }),
      () => live && setState({ phase: "error" })
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

/** True unless the shell has loaded a viewer who isn't a Missio pastor. The API checks again. */
function usePastor(): boolean {
  const me = useMissioViewer();
  return me === null || isMissioPastor(me);
}

/** Profile: the banner for this person's pending suggestion(s). Renders nothing otherwise. */
export function ProfileCoupleSuggestion({
  personId,
  client = suggestionsClient,
  onLinked,
}: {
  personId: string;
  client?: SuggestionsClient;
  /** Reload the household card after a link. */
  onLinked?: () => void;
}) {
  const pastor = usePastor();
  const state = usePending(pastor ? () => client.forPerson(personId) : null, [client, personId, pastor]);
  if (!pastor || state.phase !== "ready" || state.list.length === 0) return null;
  return (
    <>
      {state.list.map((suggestion) => (
        <SuggestionCard
          key={suggestion.id}
          suggestion={suggestion}
          selfPersonId={personId}
          client={client}
          onDone={(result) => {
            if (result === "linked") onLinked?.();
          }}
        />
      ))}
    </>
  );
}

export const EMPTY_SUGGESTIONS = "No pending suggestions. A pastor can load them from the house church sheet later.";

/** /missio/people/suggestions: every pending pair. */
export function FamilySuggestionsList({ client = suggestionsClient }: { client?: SuggestionsClient }) {
  const pastor = usePastor();
  const state = usePending(pastor ? () => client.list() : null, [client, pastor]);
  return (
    <div className={`${content.page} ${styles.page}`} data-testid="family-suggestions">
      <Link href="/missio/people" className={styles.back}>
        <span aria-hidden="true">←</span> People
      </Link>
      <h1 className={styles.title}>Family suggestions</h1>
      <p className={styles.sub}>Couples listed together on the house church sheet. Nothing is linked until you say so.</p>
      {!pastor ? <p className={styles.empty}>Pastors only.</p> : null}
      {pastor && state.phase === "loading" ? (
        <p className={styles.sub} role="status">
          Loading suggestions…
        </p>
      ) : null}
      {pastor && state.phase === "error" ? <p className={styles.empty}>The suggestions didn’t load. Please try again.</p> : null}
      {pastor && state.phase === "ready" && state.list.length === 0 ? (
        <p className={styles.empty} data-testid="family-suggestions-empty">
          {EMPTY_SUGGESTIONS}
        </p>
      ) : null}
      {pastor && state.phase === "ready" && state.list.length > 0 ? (
        <ul className={styles.list}>
          {state.list.map((suggestion) => (
            <li key={suggestion.id}>
              <SuggestionCard suggestion={suggestion} client={client} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** People: a quiet link to the list, with a count when there are pending pairs. */
export function FamilySuggestionsEntry({ client = suggestionsClient }: { client?: SuggestionsClient }) {
  const pastor = usePastor();
  const state = usePending(pastor ? () => client.list() : null, [client, pastor]);
  if (!pastor) return null;
  const count = state.phase === "ready" ? state.list.length : 0;
  return (
    <Link href="/missio/people/suggestions" className={styles.entry} data-testid="family-suggestions-entry">
      Family suggestions
      {count > 0 ? (
        <span className={styles.count} aria-label={`${count} pending`}>
          {count}
        </span>
      ) : null}
    </Link>
  );
}
