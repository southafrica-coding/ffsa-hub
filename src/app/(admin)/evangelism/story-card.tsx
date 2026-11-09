import { StatusPill, type Tone } from "@/components/ffsa";
import { OUTCOME_LABELS } from "@/lib/evangelism/validation";
import type { PresentedTestimony, TestimonyStatus } from "@/services/evangelism";

const STATUS: Record<TestimonyStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "quiet" },
  submitted: { label: "Waiting for review", tone: "warn" },
  published: { label: "Published", tone: "good" },
  withheld: { label: "Withheld", tone: "bad" },
};

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** One story. Author name only appears when the API included it. */
export function StoryCard({
  story,
  showStatus = false,
  children,
}: {
  story: PresentedTestimony;
  showStatus?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <article className="border-b border-rule px-5 py-5 md:px-8">
      <div className="flex flex-wrap items-center gap-2">
        {showStatus && <StatusPill tone={STATUS[story.status].tone}>{STATUS[story.status].label}</StatusPill>}
        <span className="mono-label">
          {formatDate(story.occurred_on)} · {story.location_label}
          {story.ministry_name ? ` · ${story.ministry_name}` : ""}
        </span>
      </div>
      <h3 className="mt-2 font-display text-[22px] font-black uppercase leading-tight text-ink">{story.title}</h3>
      {story.author_name && (
        <p className="mt-1 text-xs text-[color:var(--text-secondary)]">Shared by {story.author_name}</p>
      )}
      {story.photo?.url && (
        // Signed, short-lived URL from the private bucket — not a public path.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={story.photo.url}
          alt=""
          className="mt-3 max-h-80 w-full max-w-xl object-cover"
          loading="lazy"
        />
      )}
      <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed">{story.body}</p>
      <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.1em] text-[color:var(--text-secondary)]">
        {OUTCOME_LABELS[story.outcome]} · {story.people_reached} reached · {story.decisions} decision
        {story.decisions === 1 ? "" : "s"}
      </p>
      {story.status === "withheld" && story.withheld_reason && (
        <p className="mt-2 text-sm text-red-700">Withheld: {story.withheld_reason}</p>
      )}
      {children}
    </article>
  );
}
