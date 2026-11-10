"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyStoryTakedown,
  storyListSignature,
  type StoryLists,
  type StoryTakedownResult,
} from "@/lib/evangelism/story-client";
import type { TakedownAccess } from "@/lib/evangelism/takedown";
import type { PresentedTestimony } from "@/services/evangelism";
import { MyStories } from "./my-stories";
import { PublishedList } from "./published-list";
import type { MinistryOption } from "./upload-form";

/** Published feed and My stories, updated in place after a takedown. */
export function EvangelismBoard({
  published,
  mine,
  access,
  ministries,
}: {
  published: PresentedTestimony[];
  mine: PresentedTestimony[] | null;
  access: TakedownAccess;
  ministries: MinistryOption[];
}) {
  const router = useRouter();
  const serverSig = `${storyListSignature(published)}#${mine ? storyListSignature(mine) : ""}`;
  const applied = useRef(serverSig);
  const [lists, setLists] = useState<StoryLists>({ published, mine });

  useEffect(() => {
    if (applied.current === serverSig) return;
    applied.current = serverSig;
    setLists({ published, mine });
  }, [serverSig, published, mine]);

  function onResult(result: StoryTakedownResult) {
    setLists((current) => applyStoryTakedown(current, result));
    router.refresh();
  }

  return (
    <>
      {access.submit && lists.mine && (
        <MyStories ministries={ministries} mine={lists.mine} access={access} onResult={onResult} />
      )}
      <PublishedList stories={lists.published} access={access} onResult={onResult} />
    </>
  );
}
