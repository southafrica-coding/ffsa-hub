import type { CalendarShare } from "@/lib/missio/calendar/share-links";
import type { CalendarEvent, CalendarEventInput, FieldErrors } from "@/lib/missio/calendar/types";
import { MissioApiError } from "../api";

/** A failed write. `fieldErrors` are the only server strings the form shows. */
export class CalendarApiError extends MissioApiError {
  readonly fieldErrors: FieldErrors;
  constructor(status: number, code: string, fieldErrors: FieldErrors = {}) {
    super(status, "", null, code);
    this.fieldErrors = fieldErrors;
  }
}

async function call(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}) },
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (!res.ok) {
    const code = typeof body.code === "string" ? body.code : "server_error";
    const fieldErrors = body.fieldErrors && typeof body.fieldErrors === "object" ? (body.fieldErrors as FieldErrors) : {};
    throw new CalendarApiError(res.status, code, fieldErrors);
  }
  return body;
}

export type CalendarClient = {
  /** `available` is false until migration 395 is applied. */
  list(): Promise<{ available: boolean; events: CalendarEvent[] }>;
  create(input: CalendarEventInput): Promise<CalendarEvent>;
  update(id: string, input: CalendarEventInput): Promise<CalendarEvent>;
  remove(id: string): Promise<void>;
  share(reset: boolean): Promise<CalendarShare>;
};

export const calendarClient: CalendarClient = {
  async list() {
    const body = await call("/api/missio/calendar");
    return { available: body.available !== false, events: (body.events as CalendarEvent[]) ?? [] };
  },
  async create(input) {
    const body = await call("/api/missio/calendar/events", { method: "POST", body: JSON.stringify(input) });
    return body.event as CalendarEvent;
  },
  async update(id, input) {
    const body = await call(`/api/missio/calendar/events/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
    return body.event as CalendarEvent;
  },
  async remove(id) {
    await call(`/api/missio/calendar/events/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async share(reset) {
    const body = await call("/api/missio/calendar/share", { method: "POST", body: JSON.stringify({ reset }) });
    return body.share as CalendarShare;
  },
};

/** Fixed copy for a calendar error code. */
export function calendarErrorCopy(code: string | null | undefined): string {
  switch (code) {
    case "not_available":
      return "The calendar isn’t switched on yet, so this can’t be saved. Public holidays and school terms still show.";
    case "invalid_input":
      return "Check the details and try again.";
    case "not_found":
      return "That event isn’t there any more. It may have been deleted.";
    case "forbidden":
      return "Only pastors can change the calendar.";
    case "unauthenticated":
      return "Sign in to continue.";
    case "rate_limited":
      return "Too many changes at once. Wait a moment, then try again.";
    default:
      return "That didn’t go through. Please try again.";
  }
}
