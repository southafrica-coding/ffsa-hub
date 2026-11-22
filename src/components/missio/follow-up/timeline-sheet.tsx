"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { missioSkinVars } from "../access";
import { MissioApiError } from "../api";
import { missioFixedCopy } from "../errors";
import { missioPortalClass } from "../portal";
import { entryText, formatWhen, newestFirst, STAGE_LABEL, STAGES } from "./format";
import type { FollowUpClient } from "./client";
import type { FollowUpItem, FollowUpStage, PersonRef, TimelineEntry } from "./types";
import styles from "./follow-up.module.css";

export function TimelineSheet({
  person,
  canWrite,
  leaders,
  client,
  onClose,
  onStage,
  onLeader,
}: {
  person: FollowUpItem;
  canWrite: boolean;
  leaders: PersonRef[];
  client: FollowUpClient;
  onClose: () => void;
  onStage: (stage: FollowUpStage) => Promise<boolean>;
  onLeader: (leaderContactId: string | null) => Promise<boolean>;
}) {
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stageValue, setStageValue] = useState(person.stage);
  const [leaderValue, setLeaderValue] = useState(person.assignedLeader?.contactId ?? "");

  useEffect(() => {
    let active = true;
    client.timeline(person.key).then(
      (page) => {
        if (active) setEntries(newestFirst(page.entries));
      },
      (caught: unknown) => {
        if (!active) return;
        setError(missioFixedCopy(caught instanceof MissioApiError ? caught.code : null, caught instanceof MissioApiError ? caught.retryAfterSeconds : null));
      }
    );
    return () => {
      active = false;
    };
  }, [client, person.key]);

  useEffect(() => {
    setStageValue(person.stage);
    setLeaderValue(person.assignedLeader?.contactId ?? "");
  }, [person.stage, person.assignedLeader?.contactId]);

  async function addNote(event: React.FormEvent) {
    event.preventDefault();
    const body = note.trim();
    if (!body) {
      setNoteError("Write a note.");
      return;
    }
    if (body.length > 2000) {
      setNoteError("Use 2,000 characters or fewer.");
      return;
    }
    setBusy(true);
    setNoteError(null);
    try {
      const saved = await client.addNote(person.key, body);
      setEntries((current) => newestFirst([saved.entry, ...(current ?? [])]));
      setNote("");
      document.getElementById("follow-up-note")?.focus();
    } catch (caught) {
      setNoteError(missioFixedCopy(caught instanceof MissioApiError ? caught.code : null, caught instanceof MissioApiError ? caught.retryAfterSeconds : null));
      document.getElementById("follow-up-note")?.focus();
    } finally {
      setBusy(false);
    }
  }

  const ordered = entries ? newestFirst(entries) : [];

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className={missioPortalClass(styles.sheet)}
        style={missioSkinVars()}
        data-skin="missio"
        data-testid="follow-up-timeline"
      >
        <SheetTitle className={styles.sheetTitle}>{person.displayName}</SheetTitle>
        <SheetDescription className={styles.muted}>What happened</SheetDescription>
        {canWrite ? (
          <div className={styles.sheetControls}>
            <label>
              Stage
              <select
                id={`follow-up-stage-${person.key}`}
                aria-label={`Stage for ${person.displayName}`}
                value={stageValue}
                onChange={(event) => {
                  const next = event.target.value as FollowUpStage;
                  setStageValue(next);
                  void onStage(next).then((ok) => {
                    if (!ok) setStageValue(person.stage);
                  });
                }}
              >
                {STAGES.map((item) => (
                  <option key={item} value={item}>
                    {STAGE_LABEL[item]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Leader
              <select
                id={`follow-up-leader-${person.key}`}
                aria-label={`Leader for ${person.displayName}`}
                value={leaderValue}
                onChange={(event) => {
                  const next = event.target.value;
                  setLeaderValue(next);
                  void onLeader(next || null).then((ok) => {
                    if (!ok) setLeaderValue(person.assignedLeader?.contactId ?? "");
                  });
                }}
              >
                <option value="">Unassigned</option>
                {leaders.map((item) => (
                  <option key={item.contactId} value={item.contactId}>
                    {item.displayName}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        {entries == null && !error ? <p role="status">Loading the timeline…</p> : null}
        {error ? (
          <p className={styles.notice} role="alert">
            {error}
          </p>
        ) : null}
        {ordered.length > 0 ? (
          <ol className={styles.timeline}>
            {ordered.map((entry) => {
              const when = formatWhen(entry.at, true);
              const who = entry.by?.displayName;
              return (
                <li key={entry.id} className={styles.entry}>
                  <p className={styles.entryBody}>{entryText(entry)}</p>
                  <p className={styles.entryMeta}>{[who, when].filter(Boolean).join(" · ")}</p>
                </li>
              );
            })}
          </ol>
        ) : null}
        {entries && ordered.length === 0 && !error ? <p>Nothing here yet.</p> : null}
        {canWrite ? (
          <form className={styles.noteBox} onSubmit={(event) => void addNote(event)}>
            <label>
              Add a note
              <textarea name="note" value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            {noteError ? (
              <p className={styles.notice} role="alert">
                {noteError}
              </p>
            ) : null}
            <button id="follow-up-note" type="submit" className={styles.primary} disabled={busy}>
              {busy ? "Adding…" : "Add note"}
            </button>
          </form>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
