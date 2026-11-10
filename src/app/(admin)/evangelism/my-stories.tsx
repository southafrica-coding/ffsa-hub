"use client";

import { useState } from "react";
import { SectionBar } from "@/components/ffsa";
import { Button } from "@/components/ui/button";
import type { StoryTakedownResult } from "@/lib/evangelism/story-client";
import type { TakedownAccess } from "@/lib/evangelism/takedown";
import type { PresentedTestimony } from "@/services/evangelism";
import { StoryActions } from "./story-actions";
import { StoryCard } from "./story-card";
import { UploadForm, type MinistryOption } from "./upload-form";

/** The submit form plus the caller's own stories (edit while open, delete when allowed). */
export function MyStories({
  ministries,
  mine,
  access,
  onResult,
}: {
  ministries: MinistryOption[];
  mine: PresentedTestimony[];
  access: TakedownAccess;
  onResult: (result: StoryTakedownResult) => void;
}) {
  const [editing, setEditing] = useState<PresentedTestimony | null>(null);

  return (
    <>
      <SectionBar title={editing ? "Edit your story" : "Share a story"} />
      <UploadForm
        key={editing?.id ?? "new"}
        ministries={ministries}
        editing={editing}
        onDone={editing ? () => setEditing(null) : undefined}
      />

      <SectionBar title="My stories" meta={mine.length ? `${mine.length}` : undefined} />
      {mine.length === 0 ? (
        <p className="px-5 py-6 text-sm text-[color:var(--text-secondary)] md:px-8">Nothing yet.</p>
      ) : (
        mine.map((story) => (
          <StoryCard key={story.id} story={story} showStatus>
            <StoryActions
              story={story}
              surface="mine"
              access={access}
              onResult={onResult}
              leading={
                story.is_mine && (story.status === "draft" || story.status === "submitted") ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 w-full sm:w-auto"
                    onClick={() => {
                      setEditing(story);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    Edit
                  </Button>
                ) : null
              }
            />
          </StoryCard>
        ))
      )}
    </>
  );
}
