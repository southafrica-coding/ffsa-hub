"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SectionBar } from "@/components/ffsa";
import { Button } from "@/components/ui/button";
import type { PresentedTestimony } from "@/services/evangelism";
import { StoryCard } from "./story-card";
import { UploadForm, type MinistryOption } from "./upload-form";

/** The submit form plus the caller's own stories (edit/delete while open). */
export function MyStories({ ministries, mine }: { ministries: MinistryOption[]; mine: PresentedTestimony[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<PresentedTestimony | null>(null);

  async function remove(story: PresentedTestimony) {
    if (!window.confirm(`Delete the draft "${story.title}"?`)) return;
    const res = await fetch(`/api/evangelism/testimonies/${story.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error ?? "Couldn't delete the draft.");
      return;
    }
    toast.success("Draft deleted");
    router.refresh();
  }

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
            {(story.status === "draft" || story.status === "submitted") && (
              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => {
                    setEditing(story);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  Edit
                </Button>
                {story.status === "draft" && (
                  <Button variant="ghost" className="min-h-11 text-red-700" onClick={() => remove(story)}>
                    Delete draft
                  </Button>
                )}
              </div>
            )}
          </StoryCard>
        ))
      )}
    </>
  );
}
