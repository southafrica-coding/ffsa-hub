// Browser calls for testimony takedown, plus the list update that follows
// a success. Permission lives in takedown.ts — this module only speaks HTTP
// and reshapes the lists the page is already showing.

import { moderatorWithheldClientMessage } from "@/lib/evangelism/takedown";
import type { PresentedTestimony } from "@/services/evangelism";

export const TESTIMONY_NETWORK_ERROR = "Couldn't reach the Hub. Check your connection and try again.";

/** Friendly copy for a failed testimony request. Prefers the server's own sentence. */
export function testimonyFailureMessage(status: number, serverError: unknown): string {
  const server = typeof serverError === "string" ? serverError.trim() : "";
  const withheld = moderatorWithheldClientMessage(server);
  if (withheld) return withheld;
  if (server) return server;
  if (status === 400) return "That change wasn't accepted.";
  if (status === 401) return "You're signed out. Sign in and try again.";
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "That story isn't here anymore.";
  if (status === 409) return "This story changed, so that action isn't available anymore.";
  if (status >= 500) return "Something went wrong. Try again in a moment.";
  return "Couldn't complete that. Try again.";
}

export async function messageFromResponse(res: Response): Promise<string> {
  let server: unknown;
  try {
    const body = (await res.json()) as { error?: unknown } | null;
    server = body && typeof body === "object" ? body.error : undefined;
  } catch {
    server = undefined;
  }
  return testimonyFailureMessage(res.status, server);
}

export type StoryPatchResult =
  | { ok: true; testimony: PresentedTestimony }
  | { ok: false; message: string };

export async function patchStory(id: string, body: Record<string, unknown>): Promise<StoryPatchResult> {
  try {
    const res = await fetch(`/api/evangelism/testimonies/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, message: await messageFromResponse(res) };
    const data = (await res.json().catch(() => null)) as { testimony?: PresentedTestimony } | null;
    if (!data?.testimony || typeof data.testimony !== "object") {
      return { ok: false, message: "The story was updated, but the page didn't get it back." };
    }
    return { ok: true, testimony: data.testimony };
  } catch {
    return { ok: false, message: TESTIMONY_NETWORK_ERROR };
  }
}

export async function deleteStory(id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch(`/api/evangelism/testimonies/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) return { ok: false, message: await messageFromResponse(res) };
    return { ok: true };
  } catch {
    return { ok: false, message: TESTIMONY_NETWORK_ERROR };
  }
}

export type StoryLists = {
  published: PresentedTestimony[];
  mine: PresentedTestimony[] | null;
};

export type StoryTakedownResult =
  | { type: "delete"; id: string }
  | { type: "withhold"; testimony: PresentedTestimony }
  | { type: "republish"; testimony: PresentedTestimony };

/** Drop or replace one story in the lists already on screen. */
export function applyStoryTakedown(lists: StoryLists, result: StoryTakedownResult): StoryLists {
  if (result.type === "delete") {
    return {
      published: lists.published.filter((story) => story.id !== result.id),
      mine: lists.mine ? lists.mine.filter((story) => story.id !== result.id) : null,
    };
  }
  const story = result.testimony;
  if (result.type === "withhold") {
    const published = lists.published.filter((item) => item.id !== story.id);
    if (!lists.mine) return { published, mine: null };
    const rest = lists.mine.filter((item) => item.id !== story.id);
    const mine = story.is_mine && story.status === "withheld" ? [story, ...rest] : rest;
    return { published, mine };
  }
  const published =
    story.status === "published"
      ? [story, ...lists.published.filter((item) => item.id !== story.id)]
      : lists.published.filter((item) => item.id !== story.id);
  return {
    published,
    mine: lists.mine ? lists.mine.map((item) => (item.id === story.id ? story : item)) : null,
  };
}

/** Stable across fresh array identities, so a server re-render doesn't wipe an in-place edit. */
export function storyListSignature(stories: PresentedTestimony[]): string {
  return stories
    .map(
      (story) =>
        `${story.id}:${story.status}:${story.updated_at}:${story.withheld_reason ?? ""}:${story.withheld_by_other ? "1" : "0"}`,
    )
    .join("|");
}
