/**
 * Tool catalog for the in-app Hub assistant (chat bubble).
 *
 * Each tool belongs to a Hub module. A user is only OFFERED tools for
 * modules they can open, and every tool re-checks access when it runs.
 * All queries use the signed-in user's Supabase client (RLS applies).
 *
 * The number-crunching tools reuse the Slack bot's implementations
 * (src/lib/slack/assistant/tools.ts), passing the user's client instead
 * of the service-role one.
 */

import type Anthropic from "@anthropic-ai/sdk";
import {
  ticketSales,
  checkinCount,
  applicationStats,
  countContactsByLabel,
  APPLICATION_STATUSES,
  type Period,
} from "@/lib/slack/assistant/tools";
import { getContacts } from "@/services/contacts";
import { getEvents } from "@/services/events";
import { canUseModule, type AssistantAccess } from "./access";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

type ToolDef = { module: string; tool: Anthropic.Tool };

const PERIOD_SCHEMA = {
  type: "string" as const,
  enum: ["today", "this_week", "this_month", "all"],
  description:
    "Time window in SAST. 'today' covers tonight/so-far-today. Omit or 'all' for all-time.",
};

const TOOL_DEFS: ToolDef[] = [
  // ── Events ──────────────────────────────────────────────
  {
    module: "events",
    tool: {
      name: "list_events",
      description:
        "Find events by name, or list upcoming published events. Returns title, dates, status, location and a Hub link.",
      input_schema: {
        type: "object",
        properties: {
          search: { type: "string", description: "Part of the event title, description or location." },
          upcoming_only: { type: "boolean", description: "Only upcoming published events." },
        },
        required: [],
      },
    },
  },
  {
    module: "events",
    tool: {
      name: "ticket_sales",
      description:
        "Tickets sold (paid orders) and revenue in Rand, optionally for one event and/or a time period.",
      input_schema: {
        type: "object",
        properties: {
          event: { type: "string", description: "Event title or slug. Omit for all events." },
          period: PERIOD_SCHEMA,
        },
        required: [],
      },
    },
  },
  {
    module: "events",
    tool: {
      name: "checkin_count",
      description:
        "Tickets checked in at the door, optionally for one event and/or period (defaults to today). For one event it also returns tickets issued.",
      input_schema: {
        type: "object",
        properties: {
          event: { type: "string", description: "Event title or slug. Omit for all events." },
          period: PERIOD_SCHEMA,
        },
        required: [],
      },
    },
  },
  // ── Contacts ────────────────────────────────────────────
  {
    module: "contacts",
    tool: {
      name: "search_contacts",
      description:
        "Look up contacts by name, email or phone. Returns up to 10 matches with email, phone, status, labels and a Hub link.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name, email or phone to search for." },
        },
        required: ["query"],
      },
    },
  },
  {
    module: "contacts",
    tool: {
      name: "count_contacts_by_label",
      description:
        "Count contacts with a given CRM label (e.g. 'The Send', 'Newsletter'), optionally listing names (up to 50).",
      input_schema: {
        type: "object",
        properties: {
          label: { type: "string", description: "Label name or slug." },
          include_names: {
            type: "boolean",
            description: "Also list names. Only when the user asks who, not how many.",
          },
        },
        required: ["label"],
      },
    },
  },
  // ── Training / schools ──────────────────────────────────
  {
    module: "schools",
    tool: {
      name: "application_stats",
      description:
        "Count training-school applications, optionally for one program (e.g. 'DTS'), one status and/or a period. Without a status it returns a breakdown by status.",
      input_schema: {
        type: "object",
        properties: {
          program: { type: "string", description: "Program name or code. Omit for all programs." },
          status: { type: "string", enum: [...APPLICATION_STATUSES] },
          period: PERIOD_SCHEMA,
        },
        required: [],
      },
    },
  },
];

/** Tools this user may use, based on the modules they can open. */
export function toolsFor(access: AssistantAccess): Anthropic.Tool[] {
  return TOOL_DEFS.filter((d) => canUseModule(access, d.module)).map((d) => d.tool);
}

// ────────────────────────────────────────────────────────────
// Implementations that are new for the bubble
// ────────────────────────────────────────────────────────────

async function listEvents(db: Client, input: { search?: string; upcoming_only?: boolean }) {
  const { data, error } = await getEvents(db, {
    search: input.search,
    upcoming: input.upcoming_only,
    limit: 15,
  });
  if (error) return { error: error.message };
  return {
    events: (data ?? []).map(
      (e: {
        id: string;
        title: string;
        start_date: string | null;
        end_date: string | null;
        status: string | null;
        location: string | null;
      }) => ({
        title: e.title,
        start_date: e.start_date,
        end_date: e.end_date,
        status: e.status,
        location: e.location,
        link: `/events/${e.id}`,
      })
    ),
  };
}

async function searchContacts(db: Client, input: { query: string }) {
  const q = (input.query ?? "").trim();
  if (q.length < 2) return { error: "Search needs at least 2 characters." };
  const { data, count, error } = await getContacts(db, { search: q, limit: 10 });
  if (error) return { error: error.message };
  return {
    total_matches: count ?? (data ?? []).length,
    contacts: (data ?? []).map(
      (c: {
        id: string;
        first_name: string | null;
        last_name: string | null;
        preferred_name: string | null;
        email: string | null;
        phone: string | null;
        status: string | null;
        contact_labels?: Array<{ labels: { name: string } | null }>;
      }) => ({
        name: `${c.preferred_name || c.first_name || ""} ${c.last_name ?? ""}`.trim(),
        email: c.email,
        phone: c.phone,
        status: c.status,
        labels: (c.contact_labels ?? []).map((l) => l.labels?.name).filter(Boolean),
        link: `/contacts/${c.id}`,
      })
    ),
  };
}

// ────────────────────────────────────────────────────────────
// Dispatcher — re-checks module access on every call
// ────────────────────────────────────────────────────────────

export async function executeAssistantTool(
  name: string,
  input: Record<string, unknown>,
  db: Client,
  access: AssistantAccess
): Promise<unknown> {
  const def = TOOL_DEFS.find((d) => d.tool.name === name);
  if (!def) return { error: `Unknown tool: ${name}` };
  if (!canUseModule(access, def.module)) {
    return { error: "You don't have access to that part of the Hub." };
  }

  try {
    switch (name) {
      case "list_events":
        return await listEvents(db, input as { search?: string; upcoming_only?: boolean });
      case "ticket_sales":
        return await ticketSales(input as { event?: string; period?: Period }, db);
      case "checkin_count":
        return await checkinCount(input as { event?: string; period?: Period }, db);
      case "search_contacts":
        return await searchContacts(db, input as { query: string });
      case "count_contacts_by_label":
        return await countContactsByLabel(
          input as { label: string; include_names?: boolean },
          db
        );
      case "application_stats":
        return await applicationStats(
          input as { program?: string; status?: string; period?: Period },
          db
        );
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
