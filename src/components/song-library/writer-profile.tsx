"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import pw from "./pw.module.css";
import sl from "./sl.module.css";
import { songLibraryApi } from "./api";
import { NoAccessNote } from "./no-access";
import { errorCopy } from "./client";
import { initials } from "./format";
import { libraryPaths, type LibraryScope } from "./paths";
import { SongRow } from "./song-row";
import { HELP_LABEL, isFinished } from "./stages";
import type { SongListItem, WriterProfile as WriterProfileData } from "./types";

const FIRST = 3;

export function WriterProfile({ scope, userId, initial }: { scope: LibraryScope; userId: string; initial?: WriterProfileData | null }) {
  const paths = libraryPaths(scope);
  const [profile, setProfile] = useState<WriterProfileData | null>(initial ?? null);
  const [loading, setLoading] = useState(initial === undefined);
  const [denied, setDenied] = useState(false);
  const [subscribed, setSubscribed] = useState(initial?.viewerSubscribed ?? false);
  const [message, setMessage] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  useEffect(() => {
    if (initial !== undefined) return;
    const controller = new AbortController();
    songLibraryApi.writer(userId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setProfile(result.data);
      setSubscribed(result.data?.viewerSubscribed ?? false);
      setDenied(result.denied);
      setLoading(false);
    });
    return () => controller.abort();
  }, [userId, initial]);

  if (loading) return <p className={pw.hint}>Loading…</p>;
  if (denied) return <NoAccessNote />;
  if (!profile) {
    return (
      <div className={pw.empty}>
        <div className={pw.emptyTitle}>Writer not found</div>
        <p className={pw.emptyText}>They haven&apos;t uploaded a song yet, or the library isn&apos;t open yet.</p>
        <Link className={`${pw.btn} ${pw.block}`} href={paths.home} style={{ marginTop: 18 }}>
          Back to the library
        </Link>
      </div>
    );
  }

  const first = profile.person.name.split(/\s+/)[0] || profile.person.name;
  const all = [...profile.written, ...profile.coWritten];
  const finished = all.filter((i) => isFinished(i.song.stage)).length;

  async function toggle() {
    const next = !subscribed;
    setSubscribed(next);
    setMessage(null);
    const result = await songLibraryApi.subscribeWriter(userId, next);
    if (!result.ok) {
      setSubscribed(!next);
      setMessage(errorCopy(result.code));
    }
  }

  return (
    <>
      <div className={sl.wprof}>
        <span className={`${pw.avatar} ${sl.wprofAvatar}`} aria-hidden="true">
          {initials(profile.person.name)}
        </span>
        <div style={{ minWidth: 0 }}>
          <h2 className={sl.wprofName}>{profile.person.name}</h2>
        </div>
      </div>
      {profile.isSelf ? null : (
        <div className={`${pw.pad} ${pw.ruled}`} style={{ paddingTop: 0 }}>
          <button type="button" className={`${pw.btn} ${subscribed ? "" : pw.primary} ${pw.block}`} aria-pressed={subscribed} onClick={toggle}>
            <span aria-hidden="true">🔔</span> {subscribed ? `Subscribed to ${first}` : `Subscribe to ${first}`}
          </button>
          <p className={`${pw.small} ${pw.muted}`} style={{ marginTop: 8, textAlign: "center" }}>
            Get a Slack DM each time {first} uploads. {profile.subscriberCount} {profile.subscriberCount === 1 ? "person" : "people"} subscribed.
          </p>
          {message ? (
            <p className={pw.error} role="alert">
              {message}
            </p>
          ) : null}
        </div>
      )}
      <div className={pw.kpis}>
        <div className={pw.kpi}>
          <div className={pw.numeral}>{profile.written.length}</div>
          <div className={pw.kpiLabel}>Written</div>
        </div>
        <div className={pw.kpi}>
          <div className={pw.numeral}>{profile.coWritten.length}</div>
          <div className={pw.kpiLabel}>Co-written</div>
        </div>
        <div className={pw.kpi}>
          <div className={pw.numeral}>{finished}</div>
          <div className={pw.kpiLabel}>Finished</div>
        </div>
      </div>
      <SongSection
        title="Written"
        items={profile.written}
        now={now}
        hrefFor={paths.song}
        subline={(i) => {
          const others = i.writers.filter((w) => w.userId !== userId).map((w) => w.name);
          return others.length ? `with ${others.join(", ")}` : "solo";
        }}
      />
      <SongSection
        title="Co-written"
        items={profile.coWritten}
        now={now}
        hrefFor={paths.song}
        subline={(i) => (i.writers[0] ? `${i.writers[0].name} (lead)` : "")}
      />
      <div className={pw.sectionBar}>
        <h2 className={pw.sectionTitle}>Helps with</h2>
        <span className={pw.sectionMeta}>signed up</span>
      </div>
      <div className={pw.pad}>
        {profile.helpsWith.length ? (
          <div className={pw.chips}>
            {profile.helpsWith.map((c) => (
              <span key={c} className={pw.chipBtn}>
                {HELP_LABEL[c]}
              </span>
            ))}
          </div>
        ) : (
          <p className={`${pw.small} ${pw.muted}`}>Not signed up to help yet.</p>
        )}
      </div>
    </>
  );
}

function SongSection({
  title,
  items,
  now,
  hrefFor,
  subline,
}: {
  title: string;
  items: SongListItem[];
  now: Date;
  hrefFor: (id: string) => string;
  subline: (item: SongListItem) => string;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FIRST);
  return (
    <>
      <div className={pw.sectionBar}>
        <h2 className={pw.sectionTitle}>{title}</h2>
        <span className={pw.sectionMeta}>{items.length}</span>
      </div>
      {items.length === 0 ? <p className={pw.hint}>None yet.</p> : null}
      {shown.map((item) => (
        <SongRow key={item.song.id} item={item} href={hrefFor(item.song.id)} now={now} subline={subline(item)} />
      ))}
      {items.length > shown.length ? (
        <button type="button" className={pw.more} onClick={() => setAll(true)}>
          <span>{items.length - shown.length} more</span>
          <span aria-hidden="true">→</span>
        </button>
      ) : null}
    </>
  );
}
