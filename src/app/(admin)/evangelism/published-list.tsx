import { SectionBar } from "@/components/ffsa";
import type { PresentedTestimony } from "@/services/evangelism";
import { StoryCard } from "./story-card";

export function PublishedList({ stories }: { stories: PresentedTestimony[] }) {
  return (
    <>
      <SectionBar title="Published stories" meta={stories.length ? `${stories.length}` : undefined} />
      {stories.length === 0 ? (
        <p className="px-5 py-6 text-sm text-[color:var(--text-secondary)] md:px-8">
          No published stories yet.
        </p>
      ) : (
        stories.map((story) => <StoryCard key={story.id} story={story} />)
      )}
    </>
  );
}
