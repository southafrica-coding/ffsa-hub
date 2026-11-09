"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Masthead, SectionBar, StatusPill, type Tone } from "@/components/ffsa";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isOffline, listTestimonies } from "./api";
import {
  LIMITS,
  authorName,
  formatStoryDate,
  outcomeLabel,
  readCanPublish,
  statusLabel,
  type StoryStatus,
  type Testimony,
} from "./logic";
import { EvangelismNav } from "./nav";
import { StoryDrawer } from "./story-drawer";

const FILTERS: Array<{ key: StoryStatus; label: string }> = [
  { key: "submitted", label: "Waiting" },
  { key: "published", label: "Published" },
  { key: "withheld", label: "Withheld" },
  { key: "draft", label: "Drafts" },
];

const EMPTY: Record<StoryStatus, { title: string; body: string }> = {
  submitted: {
    title: "Nothing is waiting",
    body: "Submitted stories show up here for a publisher to put on the TV or hold back.",
  },
  published: {
    title: "Nothing published yet",
    body: "Stories you publish are listed here, and on the TV.",
  },
  withheld: {
    title: "Nothing held back",
    body: "Stories you withhold stay off the TV and are listed here.",
  },
  draft: {
    title: "No drafts",
    body: "Drafts saved by the team are listed here.",
  },
};

const TONE: Record<string, Tone> = {
  draft: "quiet",
  submitted: "warn",
  published: "good",
  withheld: "quiet",
};

export function PublishQueue({ userId }: { userId: string }) {
  const [filter, setFilter] = useState<StoryStatus>("submitted");
  const [rows, setRows] = useState<Testimony[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [canPublish, setCanPublish] = useState(false);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setMessage(null);
    void (async () => {
      const result = await listTestimonies({ status: filter, limit: LIMITS.listCap });
      if (cancelled) return;
      if (!result.ok) {
        setRows([]);
        setOffline(isOffline(result));
        setForbidden(result.status === 403);
        setMessage(result.message);
        // Team status lists are 403 for people who cannot publish. A miss is
        // not a reason to keep publisher controls on.
        if (result.status === 403) setCanPublish(false);
        return;
      }
      setCanPublish(readCanPublish(result.data));
      setOffline(false);
      setForbidden(false);
      setRows(result.data.testimonies ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, tick]);

  const openIndex = rows?.findIndex((row) => row.id === openId) ?? -1;
  const open = openIndex >= 0 && rows ? rows[openIndex] : null;
  const empty = EMPTY[filter];

  return (
    <>
      <Masthead
        context="Sharing the gospel"
        title="Publish queue"
        actions={<EvangelismNav current="queue" />}
      />

      <div className="px-5 py-6 md:px-8 md:py-7">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {FILTERS.filter((item) => item.key !== "draft" || canPublish).map((item) => (
            <button
              key={item.key}
              type="button"
              className="chip bg-white"
              data-active={filter === item.key ? "true" : undefined}
              onClick={() => {
                setFilter(item.key);
                setOpenId(null);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="border border-ink bg-white">
          <SectionBar
            title={FILTERS.find((item) => item.key === filter)?.label ?? "Stories"}
            meta={rows ? `${rows.length}${rows.length >= LIMITS.listCap ? "+" : ""}` : "…"}
          />

          {rows === null && (
            <p className="px-5 py-10 text-[13px] text-[color:var(--text-secondary)]">Loading stories.</p>
          )}

          {rows && message && (
            <div className="px-5 py-10">
              <p className="font-display text-[28px] font-black uppercase leading-none">
                {offline ? "Not switched on" : forbidden ? "Publishers only" : "Couldn't load stories"}
              </p>
              <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
                {message}
              </p>
              {forbidden && (
                <p className="mt-3 text-[14px]">
                  <Link href="/evangelism" className="underline">
                    Upload a story
                  </Link>
                </p>
              )}
            </div>
          )}

          {rows && !message && rows.length === 0 && (
            <div className="px-5 py-12">
              <p className="font-display text-[32px] font-black uppercase leading-none">{empty.title}</p>
              <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-[color:var(--text-secondary)]">
                {empty.body}
              </p>
            </div>
          )}

          {rows && !message && rows.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead>Story</TableHead>
                    <TableHead>Where</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead className="text-right">Reached</TableHead>
                    <TableHead className="text-right">Decisions</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap">{formatStoryDate(row.occurred_on)}</TableCell>
                      <TableCell className="max-w-[280px] font-medium">{row.title}</TableCell>
                      <TableCell>{row.location_label}</TableCell>
                      <TableCell className="whitespace-nowrap">{outcomeLabel(row.outcome)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.people_reached}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.decisions}</TableCell>
                      <TableCell className="whitespace-nowrap">{authorName(row)}</TableCell>
                      <TableCell>
                        <StatusPill tone={TONE[row.status] ?? "quiet"}>{statusLabel(row.status)}</StatusPill>
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          type="button"
                          className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] underline"
                          onClick={() => setOpenId(row.id)}
                        >
                          Review
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rows.length >= LIMITS.listCap && (
                <p className="border-t border-rule px-4 py-3 text-[13px] text-[color:var(--text-secondary)]">
                  Showing the latest {LIMITS.listCap}. The list stops there.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <StoryDrawer
        story={open}
        userId={userId}
        canPublish={canPublish}
        onClose={() => setOpenId(null)}
        onPrev={openIndex > 0 && rows ? () => setOpenId(rows[openIndex - 1].id) : undefined}
        onNext={
          rows && openIndex >= 0 && openIndex < rows.length - 1
            ? () => setOpenId(rows[openIndex + 1].id)
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
