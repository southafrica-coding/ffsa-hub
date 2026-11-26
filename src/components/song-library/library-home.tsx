"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SearchIcon } from "@/components/departments/songwriting/icons";
import pw from "./pw.module.css";
import sl from "./sl.module.css";
import { EMPTY_HOME, songLibraryApi } from "./api";
import { NoAccessNote } from "./no-access";
import { errorCopy } from "./client";
import { libraryPaths, type LibraryScope } from "./paths";
import { SongRow } from "./song-row";
import { libraryState, PLACEMENT_LABEL, type LibraryState } from "./stages";
import { SONG_PLACEMENTS, type LibraryHome as LibraryHomeData, type SongListItem, type SongPlacement } from "./types";

const STATE_LABEL: Record<LibraryState, string> = {
  finished: "Finished",
  in_process: "In process",
  needs_demo: "Needs demo",
};
const STATES: LibraryState[] = ["finished", "in_process", "needs_demo"];
const FIRST_PAGE = 4;

function matches(item: SongListItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    item.song.title.toLowerCase().includes(q) ||
    item.writers.some((w) => w.name.toLowerCase().includes(q)) ||
    (item.song.lyrics_md ?? "").toLowerCase().includes(q)
  );
}

const byRecent = (a: SongListItem, b: SongListItem) => b.song.last_activity_at.localeCompare(a.song.last_activity_at);

export function LibraryHome({ scope, canManage, initial }: { scope: LibraryScope; canManage: boolean; initial?: LibraryHomeData }) {
  const paths = libraryPaths(scope);
  const [data, setData] = useState<LibraryHomeData>(initial ?? EMPTY_HOME);
  const [loading, setLoading] = useState(!initial);
  const [denied, setDenied] = useState(false);
  const [state, setState] = useState<LibraryState>("in_process");
  const [placement, setPlacement] = useState<SongPlacement | "all">("all");
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [subscribed, setSubscribed] = useState(initial?.subscribedAllUploads ?? false);
  const [message, setMessage] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    songLibraryApi.home(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setData(result.data);
      setSubscribed(result.data.subscribedAllUploads);
      setDenied(result.denied);
      setLoading(false);
    });
    return () => controller.abort();
  }, [initial]);

  const filtered = useMemo(
    () => data.songs.filter((item) => (placement === "all" || item.song.placement === placement) && matches(item, query.trim())),
    [data.songs, placement, query]
  );
  const counts = useMemo(() => {
    const c: Record<LibraryState, number> = { finished: 0, in_process: 0, needs_demo: 0 };
    for (const item of filtered) c[libraryState(item.song.stage)] += 1;
    return c;
  }, [filtered]);
  const list = filtered.filter((item) => libraryState(item.song.stage) === state).sort(byRecent);
  const shown = showAll ? list : list.slice(0, FIRST_PAGE);
  const finished = state === "in_process" ? filtered.filter((i) => libraryState(i.song.stage) === "finished").sort(byRecent).slice(0, 2) : [];

  async function toggleSubscribe() {
    const next = !subscribed;
    setSubscribed(next);
    setMessage(null);
    const result = await songLibraryApi.subscribeAll(next);
    if (!result.ok) {
      setSubscribed(!next);
      setMessage(errorCopy(result.code));
    }
  }

  if (denied) return <NoAccessNote />;

  return (
    <div aria-busy={loading || undefined}>
      <div className={sl.search}>
        <label className={sl.searchBox}>
          <SearchIcon />
          <span className={pw.srOnly}>Search songs, writers, lyrics</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search songs, writers, lyrics" />
        </label>
      </div>
      <div className={sl.states} role="group" aria-label="Song state">
        {STATES.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={state === key}
            onClick={() => {
              setState(key);
              setShowAll(false);
            }}
          >
            <span className={sl.stateN}>{counts[key]}</span>
            <span className={sl.stateL}>{STATE_LABEL[key]}</span>
          </button>
        ))}
      </div>
      <div className={sl.selectrow}>
        <label className={sl.select}>
          <span className={sl.selectLabel}>Placement</span>
          <select value={placement} onChange={(e) => setPlacement(e.target.value as SongPlacement | "all")}>
            <option value="all">All placements</option>
            {SONG_PLACEMENTS.map((p) => (
              <option key={p} value={p}>
                {PLACEMENT_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <Link className={`${pw.btn} ${pw.primary}`} href={paths.upload()}>
          + Upload
        </Link>
      </div>
      <div className={sl.subAll}>
        <div>
          <div id="sl-sub-all" className={pw.k} style={{ fontSize: 14.5 }}>
            DM me every new upload
          </div>
          <div className={pw.s} style={{ color: "var(--text-tertiary)", fontSize: 12.5 }}>
            Or subscribe to one writer from their page
          </div>
        </div>
        <span className={pw.switchHit}>
          <button type="button" role="switch" className={pw.switch} aria-checked={subscribed} aria-labelledby="sl-sub-all" onClick={toggleSubscribe} />
        </span>
      </div>
      {message ? (
        <p className={pw.status} role="alert">
          {message}
        </p>
      ) : null}

      {data.songs.length === 0 ? (
        <div className={pw.empty}>
          <div className={pw.emptyTitle}>{loading ? "Loading…" : "No songs yet"}</div>
          {loading ? null : (
            <>
              <p className={pw.emptyText}>Upload a voice memo, a verse and chorus, or a finished demo. The whole base can hear it straight away.</p>
              <Link className={`${pw.btn} ${pw.primary} ${pw.block}`} href={paths.upload()} style={{ marginTop: 18 }}>
                + Upload the first song
              </Link>
            </>
          )}
        </div>
      ) : (
        <>
          <div className={pw.mgroup}>{STATE_LABEL[state]} · recent first</div>
          {shown.length === 0 ? <p className={pw.hint}>Nothing here with these filters.</p> : null}
          {shown.map((item) => (
            <SongRow key={item.song.id} item={item} href={paths.song(item.song.id)} now={now} />
          ))}
          {list.length > shown.length ? (
            <button type="button" className={pw.more} onClick={() => setShowAll(true)}>
              <span>
                {list.length - shown.length} more {STATE_LABEL[state].toLowerCase()}
              </span>
              <span aria-hidden="true">→</span>
            </button>
          ) : null}
          {finished.length ? (
            <>
              <div className={pw.sectionBar}>
                <h2 className={pw.sectionTitle}>Recently finished</h2>
                <span className={pw.sectionMeta}>demo ready or later</span>
              </div>
              {finished.map((item) => (
                <SongRow key={item.song.id} item={item} href={paths.song(item.song.id)} now={now} />
              ))}
            </>
          ) : null}
        </>
      )}

      <div className={`${pw.pad} ${pw.btnrow}`}>
        <Link className={`${pw.btn} ${pw.grow}`} href={paths.helpers}>
          Helpers
        </Link>
        {canManage ? (
          <Link className={`${pw.btn} ${pw.grow}`} href={paths.board}>
            Lead board
          </Link>
        ) : null}
      </div>
    </div>
  );
}
