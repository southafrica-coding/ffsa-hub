"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import pw from "./pw.module.css";
import sl from "./sl.module.css";
import { EMPTY_HELPERS, songLibraryApi } from "./api";
import { NoAccessNote } from "./no-access";
import { errorCopy } from "./client";
import { ago } from "./format";
import { libraryPaths, type LibraryScope } from "./paths";
import { HELP_HINT, HELP_LABEL } from "./stages";
import { stuckDays } from "./stuck";
import { SONG_HELP_CATEGORIES, type HelpersPage, type SongHelpCategory } from "./types";

export function HelpersView({ scope, initial }: { scope: LibraryScope; initial?: HelpersPage }) {
  const paths = libraryPaths(scope);
  const [data, setData] = useState<HelpersPage>(initial ?? EMPTY_HELPERS);
  const [loading, setLoading] = useState(!initial);
  const [denied, setDenied] = useState(false);
  const [mine, setMine] = useState<SongHelpCategory[]>(initial?.mySignups ?? []);
  const [offered, setOffered] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    songLibraryApi.helpers(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setData(result.data);
      setMine(result.data.mySignups);
      setDenied(result.denied);
      setLoading(false);
    });
    return () => controller.abort();
  }, [initial]);

  async function toggle(category: SongHelpCategory) {
    const on = !mine.includes(category);
    setMine((cur) => (on ? [...cur, category] : cur.filter((c) => c !== category)));
    setMessage(null);
    const result = await songLibraryApi.helperSignup(category, on);
    if (!result.ok) {
      setMine((cur) => (on ? cur.filter((c) => c !== category) : [...cur, category]));
      setMessage(errorCopy(result.code));
    }
  }

  async function canHelp(requestId: string) {
    setMessage(null);
    const result = await songLibraryApi.canHelp(requestId);
    if (!result.ok) {
      setMessage(errorCopy(result.code));
      return;
    }
    setOffered((cur) => [...cur, requestId]);
  }

  if (denied) return <NoAccessNote />;

  return (
    <div aria-busy={loading || undefined}>
      <div className={`${pw.sectionBar} ${pw.flush}`}>
        <h2 className={pw.sectionTitle}>Open help requests</h2>
        <span className={pw.sectionMeta}>{data.openRequests.length} from writers</span>
      </div>
      {message ? (
        <p className={pw.status} role="alert">
          {message}
        </p>
      ) : null}
      {data.openRequests.length === 0 ? <p className={pw.hint}>{loading ? "Loading…" : "No open requests right now."}</p> : null}
      {data.openRequests.map((r) => (
        <div key={r.id} className={sl.help}>
          <div className={sl.helpTop}>
            <div className={pw.what}>
              <div className={pw.k}>{r.body}</div>
              <div className={pw.s}>{[r.songTitle, r.askedByName].filter(Boolean).join(" · ")}</div>
            </div>
            <span className={pw.mono}>{ago(stuckDays(r.created_at, now)).replace(" ago", "")}</span>
          </div>
          <div className={sl.meta}>
            <span className={pw.chip}>{r.categories.map((c) => HELP_LABEL[c]).join(" · ")}</span>
          </div>
          <div className={pw.btnrow} style={{ marginTop: 10 }}>
            <button type="button" className={`${pw.btn} ${pw.primary} ${pw.grow}`} onClick={() => canHelp(r.id)} disabled={offered.includes(r.id)}>
              {offered.includes(r.id) ? "Offered ✓" : "I can help"}
            </button>
            <Link className={`${pw.btn} ${pw.grow}`} href={paths.song(r.song_id)}>
              Listen
            </Link>
          </div>
        </div>
      ))}

      <div className={pw.sectionBar}>
        <h2 className={pw.sectionTitle}>Help writers finish songs</h2>
        <span className={pw.sectionMeta}>pick what you play</span>
      </div>
      <p className={pw.hint}>Sign up and you&apos;ll get a DM when a writer asks for that kind of help.</p>
      {SONG_HELP_CATEGORIES.map((c) => {
        const on = mine.includes(c);
        const count = data.categoryCounts[c] ?? 0;
        return (
          <div key={c} className={sl.cat}>
            <div className={pw.what}>
              <div className={pw.k}>{HELP_LABEL[c]}</div>
              <div className={pw.s} style={{ color: "var(--text-tertiary)", fontSize: 12.5 }}>
                {[HELP_HINT[c], `${count} ${count === 1 ? "helper" : "helpers"}`].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button type="button" className={`${pw.btn} ${on ? sl.on : ""}`} aria-pressed={on} onClick={() => toggle(c)}>
              {on ? "Signed up ✓" : "Sign me up"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
