"use client";

import { SectionBar } from "@/components/ffsa";
import type { StoryTakedownResult } from "@/lib/evangelism/story-client";
import type { TakedownAccess } from "@/lib/evangelism/takedown";
import type { PresentedTestimony } from "@/services/evangelism";
import { StoryActions } from "./story-actions";
import { StoryCard } from "./story-card";

export function PublishedList({
  stories,
  access,
  onResult,
}: {
  stories: PresentedTestimony[];
  access: TakedownAccess;
  onResult: (result: StoryTakedownResult) => void;
}) {
  return (
    <>
      <SectionBar title="Published stories" meta={stories.length ? `${stories.length}` : undefined} />
      {stories.length === 0 ? (
        <p className="px-5 py-6 text-sm text-[color:var(--text-secondary)] md:px-8">
          No published stories yet.
        </p>
      ) : (
        stories.map((story) => (
          <StoryCard key={story.id} story={story}>
            <StoryActions story={story} surface="feed" access={access} onResult={onResult} />
          </StoryCard>
        ))
      )}
    </>
  );
}
