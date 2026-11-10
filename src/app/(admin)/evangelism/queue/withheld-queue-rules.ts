import { canActOnOthersStory, type TakedownAccess } from "@/lib/evangelism/takedown";

/** Moderators only. Authors do not get this section of the queue. */
export function showWithheldQueue(access: TakedownAccess): boolean {
  return canActOnOthersStory(access);
}

export const WITHHELD_QUEUE_LIMIT = 100;
