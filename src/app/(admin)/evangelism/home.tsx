"use client";

import { useCallback, useEffect, useState } from "react";
import { Masthead, NeedsYou, NeedsYouAction, SectionBar, StatusPill, type Tone } from "@/components/ffsa";
import { isOffline, listTestimonies } from "./api";
import {
  LIMITS,
  formatStoryDate,
  johannesburgDate,
  outcomeLabel,
  readCanPublish,
  statusLabel,
  waitingCopy,
  type Testimony,
} from "./logic";
import { EvangelismNav } from "./nav";
import { StoryDrawer } from "./story-drawer";
import { UploadForm } from "./upload-form";

const TONE: Record<string, Tone> = {
  draft: "quiet",
  submitted: "warn",
  published: "good",
  withheld: "quiet",
};

export function EvangelismHome({ userId }: { userId: string }) {
  const today = johannesburgDate();
  const [waiting, setWaiting] = useState<number | null>(null);
  const [canPublish, setCanPublish] = useState(false);
  const [stories, setStories] = useState<Testimony[] | null>(null);
  const [offline, setOffline] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [queue, mine] = await Promise.all([
        listTestimonies({ status: "submitted", limit: LIMITS.listCap }),
        listTestimonies({ mine: true, limit: 50 }),
      ]);
      if (cancelled) return;

      const offlineResult = [queue, mine].find((result) => !result.ok && isOffline(result));
      setOffline(offlineResult && !offlineResult.ok ? offlineResult.message : null);

      // A 200 from the submitted list is not permission to publish. The band
      // appears only when that response includes can_publish: true.
      const publish = [queue, mine].some((result) => result.ok && readCanPublish(result.data));
      setCanPublish(publish);
      if (queue.ok && publish) setWaiting(queue.data.testimonies?.length ?? 0);
      else setWaiting(null);

      if (mine.ok) {
        const rows = mine.data.testimonies ?? [];
        setStories(rows.filter((row) => row.author_user_id === userId));
        setListError(null);
      } else if (!isOffline(mine)) {
        setStories([]);
        setListError(mine.message);
      } else {
        setStories([]);
        setListError(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick, userId]);

  const band = waitingCopy(waiting ?? 0);
  const openIndex = stories?.findIndex((row) => row.id === openId) ?? -1;
  const open = openIndex >= 0 && stories ? stories[openIndex] : null;

  return (
    <>
      <Masthead
        context="Sharing the gospel"
        title="Evangelism"
        actions={<EvangelismNav current="upload" />}
      />

      {band && (
        <NeedsYou action={<NeedsYouAction href="/evangelism/queue">Review</NeedsYouAction>}>
          {band}
        </NeedsYou>
      )}

      <div className="grid items-start gap-6 px-5 py-6 md:px-8 md:py-7 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
        <div className="space-y-4">
          {offline && <OfflineNotice message={offline} />}
          <UploadForm today={today} onSaved={reload} />
        </div>

        <section className="border border-ink bg-white">
          <SectionBar title="Your stories" meta={stories ? String(stories.length) : "…"} />
          {listError && <p className="px-4 py-4 text-[13px] text-destructive">{listError}</p>}
          {!listError && stories === null && (
            <p className="px-4 py-8 text-[13px] text-[color:var(--text-secondary)]">Loading your stories.</p>
          )}
          {!listError && stories?.length === 0 && (
            <div className="px-5 py-10">
              <p className="font-display text-[28px] font-black uppercase leading-none">
                {offline ? "Waiting on the API" : "No stories yet"}
              </p>
              <p className="mt-3 text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
                {offline
                  ? "Your stories will list here once testimonies are switched on."
                  : "When you save a draft or submit a story, it is listed here."}
              </p>
            </div>
          )}
          {stories && stories.length > 0 && (
            <ul>
              {stories.map((row) => (
                <li key={row.id} className="border-b border-rule last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setOpenId(row.id)}
                    className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-[#F7F5EE]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-sans text-[14px] font-medium normal-case tracking-normal">
                        {row.title}
                      </span>
                      <span className="mt-1 block font-sans text-[12px] font-normal normal-case tracking-normal text-[color:var(--text-secondary)]">
                        {formatStoryDate(row.occurred_on)} · {row.location_label} · {outcomeLabel(row.outcome)}
                      </span>
                    </span>
                    <StatusPill tone={TONE[row.status] ?? "quiet"}>{statusLabel(row.status)}</StatusPill>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <StoryDrawer
        story={open}
        userId={userId}
        canPublish={canPublish}
        onClose={() => setOpenId(null)}
        onPrev={openIndex > 0 ? () => stories && setOpenId(stories[openIndex - 1].id) : undefined}
        onNext={
          stories && openIndex >= 0 && openIndex < stories.length - 1
            ? () => setOpenId(stories[openIndex + 1].id)
            : undefined
        }
        onChanged={() => {
          setOpenId(null);
          reload();
        }}
      />
    </>
  );
}

function OfflineNotice({ message }: { message: string }) {
  return (
    <div className="border border-ink bg-bone px-5 py-4">
      <div className="mono-label mb-2">Not switched on</div>
      <p className="text-[15px] leading-relaxed">{message}</p>
      <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--text-secondary)]">
        You can read the form. Saving starts working once the testimony API and the tables are both on.
      </p>
    </div>
  );
}
