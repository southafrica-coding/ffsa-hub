"use client";

import { useState } from "react";
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
import { takedownSubject, visibleTakedownControls, type TakedownAccess, type TakedownSurface } from "@/lib/evangelism/takedown";
import { deleteStory, patchStory, type StoryTakedownResult } from "@/lib/evangelism/story-client";
import type { PresentedTestimony } from "@/services/evangelism";

const control = "min-h-11 w-full sm:w-auto";

/**
 * Unpublish, delete, and republish. Buttons render only when
 * visibleTakedownControls says the server would allow them.
 */
export function StoryActions({
  story,
  surface,
  access,
  onResult,
  leading,
}: {
  story: PresentedTestimony;
  surface: TakedownSurface;
  access: TakedownAccess;
  onResult: (result: StoryTakedownResult) => void;
  leading?: React.ReactNode;
}) {
  const controls = visibleTakedownControls(surface, access, takedownSubject(story));
  const [withholding, setWithholding] = useState(false);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!leading && !controls.withhold && !controls.delete && !controls.republish) return null;

  function fail(message: string) {
    setError(message);
    toast.error(message);
  }

  async function withhold() {
    setBusy(true);
    setError(null);
    const result = await patchStory(story.id, { status: "withheld", reason: reason.trim() });
    setBusy(false);
    if (!result.ok) {
      fail(result.message);
      return;
    }
    toast.success("Taken off the feed");
    setWithholding(false);
    setReason("");
    onResult({ type: "withhold", testimony: result.testimony });
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
    onResult({ type: "republish", testimony: result.testimony });
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
    onResult({ type: "delete", id: story.id });
  }

  const reasonId = `withhold-reason-${story.id}`;

  return (
    <div className="mt-4 min-w-0 max-w-full space-y-3">
      {withholding ? (
        <div className="min-w-0 space-y-3">
          <label htmlFor={reasonId} className="block text-sm text-[color:var(--text-secondary)]">
            Taking it off the feed. A reason is optional — the author can see it.
          </label>
          <Textarea
            id={reasonId}
            className="min-h-24 w-full max-w-full text-base md:text-sm"
            placeholder="Why is it coming down?"
            maxLength={500}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button type="button" variant="destructive" className={control} disabled={busy} onClick={() => void withhold()}>
              Unpublish
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={control}
              disabled={busy}
              onClick={() => {
                setWithholding(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {leading}
          {controls.republish && (
            <Button type="button" className={control} disabled={busy} onClick={() => void republish()}>
              Publish again
            </Button>
          )}
          {controls.withhold && (
            <Button type="button" variant="outline" className={control} disabled={busy} onClick={() => setWithholding(true)}>
              Unpublish
            </Button>
          )}
          {controls.delete && (
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
        <p role="alert" className="break-words text-sm text-red-700">
          {error}
        </p>
      )}

      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!busy) setConfirming(open);
        }}
      >
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
    </div>
  );
}
