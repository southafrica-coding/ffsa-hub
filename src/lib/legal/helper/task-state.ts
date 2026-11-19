// What state a background task is really in (migration 375). Pure and
// browser-safe: the screens import this; the runner is in tasks.ts.

/** A running task with no heartbeat for this long has stopped. */
export const STALE_MS = 6 * 60 * 1000;
/** A queued task nobody started within this long needs a Start press. */
export const QUEUE_WAIT_MS = 60 * 1000;

export type TaskRow = {
  id: string;
  title: string;
  request: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: string | null;
  result: string | null;
  draft_ids: string[];
  error: string | null;
  attempts: number;
  created_by: string;
  started_at: string | null;
  heartbeat_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type TaskState = "waiting" | "not_started" | "working" | "stalled" | "done" | "failed" | "cancelled";

export function taskState(t: Pick<TaskRow, "status" | "heartbeat_at" | "created_at">, now: number): TaskState {
  if (t.status === "queued") return now - Date.parse(t.created_at) > QUEUE_WAIT_MS ? "not_started" : "waiting";
  if (t.status === "running") {
    const beat = Date.parse(t.heartbeat_at ?? t.created_at);
    return now - beat > STALE_MS ? "stalled" : "working";
  }
  return t.status;
}

/** Spending guard: background tasks per person. */
export const MAX_RUNNING_TASKS = 2;
export const MAX_TASKS_PER_DAY = 15;

type Recent = Pick<TaskRow, "status" | "heartbeat_at" | "created_at">;

/** Room to run one more? `others` = this person's recent tasks, not counting the one starting. */
export function runningLimitProblem(others: Recent[], now: number): string | null {
  const running = others.filter((t) => {
    const s = taskState(t, now);
    return s === "working" || s === "waiting";
  }).length;
  return running >= MAX_RUNNING_TASKS
    ? `${running} background tasks are already working. Wait for one to finish, or stop one.`
    : null;
}

/** Why a NEW task can't be added now, or null. `mine` = this person's tasks from the last 24 h. */
export function taskLimitProblem(mine: Recent[], now: number): string | null {
  const room = runningLimitProblem(mine, now);
  if (room) return room;
  if (mine.length >= MAX_TASKS_PER_DAY) {
    return `That's ${MAX_TASKS_PER_DAY} background tasks in a day, the limit for now. Ask the helper directly instead, or try again tomorrow.`;
  }
  return null;
}

/** Whether "Run again" / "Start" makes sense. */
export const canRerun = (s: TaskState) => s === "not_started" || s === "stalled" || s === "failed" || s === "cancelled";

export const TASK_STATE_LABEL: Record<TaskState, string> = {
  waiting: "Starting",
  not_started: "Not started",
  working: "Working",
  stalled: "Stopped",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};
