"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PresentedTestimony } from "@/services/evangelism";
import { StoryCard } from "../story-card";

function QueueItem({ story }: { story: PresentedTestimony }) {
  const router = useRouter();
  const [withholding, setWithholding] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function review(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/evangelism/testimonies/${story.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        toast.error((await res.json().catch(() => ({}))).error ?? "Couldn't save the review.");
        return;
      }
      toast.success(done);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <StoryCard story={story} showStatus>
      {!story.consent_to_share && (
        <p className="mt-3 text-sm text-red-700">No consent to share — this story can&apos;t be published.</p>
      )}
      {withholding ? (
        <div className="mt-4 space-y-3">
          <Textarea
            className="min-h-24 text-base md:text-sm"
            placeholder="Why is it being withheld? (optional, only publishers see this)"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <Button
              variant="destructive"
              className="min-h-11"
              disabled={busy}
              onClick={() => review({ action: "withhold", reason }, "Withheld")}
            >
              Confirm withhold
            </Button>
            <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => setWithholding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            className="min-h-11"
            disabled={busy || !story.consent_to_share}
            onClick={() => review({ action: "publish" }, "Published")}
          >
            Approve &amp; publish
          </Button>
          <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => setWithholding(true)}>
            Withhold
          </Button>
        </div>
      )}
    </StoryCard>
  );
}

export function QueueList({ stories }: { stories: PresentedTestimony[] }) {
  if (stories.length === 0) {
    return <p className="px-5 py-6 text-sm text-[color:var(--text-secondary)] md:px-8">Nothing waiting for review.</p>;
  }
  return (
    <>
      {stories.map((s) => (
        <QueueItem key={s.id} story={s} />
      ))}
    </>
  );
}
