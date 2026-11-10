"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { deleteStory, patchStory, storyListSignature } from "@/lib/evangelism/story-client";
import { decideTakedown, takedownSubject, type TakedownAccess } from "@/lib/evangelism/takedown";
import type { PresentedTestimony } from "@/services/evangelism";
import { StoryCard } from "../story-card";
import { WITHHELD_QUEUE_LIMIT, showWithheldQueue } from "./withheld-queue-rules";

const control = "min-h-11 w-full sm:w-auto";

/** Set when the withheld query returned a full page, so more may exist. */
export function withheldCapNote(count: number, limit = WITHHELD_QUEUE_LIMIT): string | null {
  if (count < limit) return null;
  return `Showing the first ${limit} withheld stories.`;
}

export function withoutStory<T extends { id: string }>(stories: T[], id: string): T[] {
  return stories.filter((story) => story.id !== id);
}

/** Drop the story locally, then refresh server data (section count included). */
export function afterWithheldSuccess(onDone: (id: string) => void, refresh: () => void, id: string) {
  onDone(id);
  refresh();
}

function QueueItem({
  story,
  access,
  onReviewed,
}: {
  story: PresentedTestimony;
  access: TakedownAccess;
  onReviewed?: (id: string) => void;
}) {
  const router = useRouter();
  const [withholding, setWithholding] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subject = takedownSubject(story);
  // Consent is shown as a disabled publish button, so ask the helper as if
  // consent were present and then disable on the real flag.
  const canWithhold = decideTakedown("withhold", access, subject).ok;
  const canPublish = decideTakedown("republish", access, { ...subject, consentToShare: true }).ok;

  async function review(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError(null);
    const result = await patchStory(story.id, body);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      toast.error(result.message);
      return;
    }
    toast.success(done);
    onReviewed?.(story.id);
    router.refresh();
  }

  return (
    <StoryCard story={story} showStatus>
      {!story.consent_to_share && (
        <p className="mt-3 text-sm text-red-700">No consent to share — this story can&apos;t be published.</p>
      )}
      {withholding ? (
        <div className="mt-4 min-w-0 space-y-3">
          <Textarea
            className="min-h-24 w-full max-w-full text-base md:text-sm"
            placeholder="Why is it being withheld? (optional — the author can see this)"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              variant="destructive"
              className="min-h-11 w-full sm:w-auto"
              disabled={busy}
              onClick={() => review({ action: "withhold", reason }, "Withheld")}
            >
              Confirm withhold
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11 w-full sm:w-auto"
              disabled={busy}
              onClick={() => setWithholding(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        (canPublish || canWithhold) && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {canPublish && (
              <Button
                type="button"
                className="min-h-11 w-full sm:w-auto"
                disabled={busy || !story.consent_to_share}
                onClick={() => review({ action: "publish" }, "Published")}
              >
                Approve &amp; publish
              </Button>
            )}
            {canWithhold && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full sm:w-auto"
                disabled={busy}
                onClick={() => setWithholding(true)}
              >
                Withhold
              </Button>
            )}
          </div>
        )
      )}
      {error && (
        <p role="alert" className="mt-3 break-words text-sm text-red-700">
          {error}
        </p>
      )}
    </StoryCard>
  );
}

export function QueueList({
  stories,
  access,
  onReviewed,
}: {
  stories: PresentedTestimony[];
  access: TakedownAccess;
  onReviewed?: (id: string) => void;
}) {
  if (stories.length === 0) {
    return <p className="px-5 py-6 text-sm text-[color:var(--text-secondary)] md:px-8">Nothing waiting for review.</p>;
  }
  return (
    <>
      {stories.map((s) => (
        <QueueItem key={s.id} story={s} access={access} onReviewed={onReviewed} />
      ))}
    </>
  );
}

function WithheldItem({
  story,
  access,
  onDone,
}: {
  story: PresentedTestimony;
  access: TakedownAccess;
  onDone: (id: string) => void;
}) {
  const subject = takedownSubject(story);
  const canRepublish = decideTakedown("republish", access, subject).ok;
  const canDelete = decideTakedown("delete", access, subject).ok;
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fail(message: string) {
    setError(message);
    toast.error(message);
  }

  async function republish() {
    setBusy(true);
    setError(null);
    const result = await patchStory(story.id, { status: "published" });
    setBusy(false);
    if (!result.ok) {
      fail(result.message);
      return;
    }
    toast.success("Published");
    afterWithheldSuccess(onDone, () => router.refresh(), story.id);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const result = await deleteStory(story.id);
    setBusy(false);
    if (!result.ok) {
      fail(result.message);
      return;
    }
    toast.success("Story deleted");
    setConfirming(false);
    afterWithheldSuccess(onDone, () => router.refresh(), story.id);
  }

  return (
    <StoryCard story={story} showStatus>
      {!story.consent_to_share && (
        <p className="mt-3 break-words text-sm text-red-700">No consent to share — this story can&apos;t be published.</p>
      )}
      {(canRepublish || canDelete) && (
        <div className="mt-4 flex min-w-0 max-w-full flex-col gap-2 break-words sm:flex-row sm:flex-wrap">
          {canRepublish && (
            <Button type="button" className={control} disabled={busy} onClick={() => void republish()}>
              Publish again
            </Button>
          )}
          {canDelete && (
            <Button
              type="button"
              variant="outline"
              className={`${control} text-red-700`}
              disabled={busy}
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
            >
              Delete
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 break-words text-sm text-red-700">
          {error}
        </p>
      )}
      <Dialog open={confirming} onOpenChange={(open) => { if (!busy) setConfirming(open); }}>
        <DialogContent>
          <DialogHeader className="text-left">
            <DialogTitle className="break-words pr-6 font-display text-xl font-black uppercase leading-tight">
              Delete this story?
            </DialogTitle>
            <DialogDescription className="break-words text-left text-sm">
              “{story.title}” will be removed. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" className={control} disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" className={control} disabled={busy} onClick={() => void remove()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StoryCard>
  );
}

/** Withheld stories a moderator can put back or delete. Hidden from everyone else. */
export function WithheldQueue({
  stories,
  access,
}: {
  stories: PresentedTestimony[];
  access: TakedownAccess;
}) {
  const sig = storyListSignature(stories);
  const applied = useRef(sig);
  const [items, setItems] = useState(stories);

  useEffect(() => {
    if (applied.current === sig) return;
    applied.current = sig;
    setItems(stories);
  }, [sig, stories]);

  if (!showWithheldQueue(access)) return null;
  const cap = withheldCapNote(stories.length);
  if (items.length === 0) {
    return <p className="px-5 py-6 text-sm text-[color:var(--text-secondary)] md:px-8">Nothing withheld.</p>;
  }
  return (
    <>
      {cap && (
        <p className="px-5 py-3 text-sm text-[color:var(--text-secondary)] md:px-8">{cap}</p>
      )}
      {items.map((story) => (
        <WithheldItem
          key={story.id}
          story={story}
          access={access}
          onDone={(id) => setItems((current) => withoutStory(current, id))}
        />
      ))}
    </>
  );
}
