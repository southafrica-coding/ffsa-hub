// The legal helper's tools. Server-only.
//
// Every tool runs through the SIGNED-IN PERSON'S Supabase client, so RLS
// (migrations 371, 374) decides what it can see and change — the helper
// can never reach a paper its user couldn't open on the page.
//
// It can READ documents, scans, applications and drafts, and it can SAVE
// or UPDATE A DRAFT. Nothing else. It cannot approve (only the owner can,
// in the Drafts tab, and the database enforces that), send, delete, or
// change a document's details.

import type Anthropic from "@anthropic-ai/sdk";
import { loadReminder } from "@/lib/legal/reminder-data";
import { todayInSA } from "@/lib/legal/status";
import { taskLimitProblem } from "./task-state";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const nullable = (type: string, description: string) => ({ type: [type, "null"], description });

export const LEGAL_HELPER_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_overview",
    description:
      "The folders (with ids and kinds), the document types, and what currently needs attention (expired, renew now, applications due). Call this first in a conversation to know where things live.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "search_legal",
    description:
      "Search documents (title, holder, issuer, reference number, notes), applications, drafts, and the text read from scans. Use plain words, e.g. 'PBO', 'tax clearance', 'passport', 'lease'.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Words to look for." } },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_document",
    description:
      "Everything about one document: its details, folder, type, every scan filed under it (with what was read), its applications and drafts.",
    input_schema: {
      type: "object",
      properties: { document_id: { type: "string", description: "The document's id." } },
      required: ["document_id"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "read_scan",
    description:
      "The full text read from one scan, with its summary and the details found. Use it to copy exact numbers, names and dates, and to see which fields a blank form asks for.",
    input_schema: {
      type: "object",
      properties: { file_id: { type: "string", description: "The scan's (file's) id." } },
      required: ["file_id"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "list_drafts",
    description: "Drafts saved so far, newest first, with their status (awaiting approval, sent back with a note, approved).",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "save_draft",
    description:
      "Save a new draft for the legal officer to approve. This never finalises or sends anything. Choose folder_id (and document_id / application_id when the draft belongs to one) so the approved PDF is filed in the right place.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title, e.g. 'Cover letter: PBO renewal 2027'." },
        kind: { type: "string", enum: ["letter", "form", "other"], description: "letter: prose. form: field-by-field answers. other: anything else." },
        folder_id: { type: "string", description: "Folder the final PDF is saved in." },
        document_id: nullable("string", "The document this draft belongs to, if any (must be in folder_id)."),
        application_id: nullable("string", "The application this draft is for, if any (must be in folder_id)."),
        body: { type: "string", description: "The full text. For a letter, the whole letter. For a form, a short covering note or empty." },
        fields: {
          type: "array",
          description: "For a form: one entry per field, in the form's order. Empty for a letter.",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "The field as printed on the form, with its section/number if it has one." },
              value: { type: "string", description: "The answer, or empty when missing." },
              source: { type: "string", description: "Where the value came from, e.g. 'NPO certificate scan' — or 'missing'." },
              missing: { type: "boolean", description: "true when the Hub doesn't hold this and the legal officer must fill it in." },
            },
            required: ["label", "value", "source", "missing"],
            additionalProperties: false,
          },
        },
        notes_for_approver: {
          type: "string",
          description: "What the legal officer should check before approving: missing details, assumptions, anything to confirm with the issuer.",
        },
      },
      required: ["title", "kind", "folder_id", "document_id", "application_id", "body", "fields", "notes_for_approver"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "update_draft",
    description:
      "Change a draft that is not approved yet (e.g. after it was sent back). Pass null for anything that stays the same. The draft goes back to 'awaiting approval'.",
    input_schema: {
      type: "object",
      properties: {
        draft_id: { type: "string", description: "The draft's id." },
        title: nullable("string", "New title."),
        body: nullable("string", "New full text."),
        fields: {
          type: ["array", "null"],
          description: "New full list of form fields, or null.",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "string" },
              source: { type: "string" },
              missing: { type: "boolean" },
            },
            required: ["label", "value", "source", "missing"],
            additionalProperties: false,
          },
        },
        notes_for_approver: nullable("string", "New notes for the legal officer."),
        folder_id: nullable("string", "Move the draft to another folder."),
        document_id: nullable("string", "Attach to a document in the draft's folder."),
      },
      required: ["draft_id", "title", "body", "fields", "notes_for_approver", "folder_id", "document_id"],
      additionalProperties: false,
    },
    strict: true,
  },
];

/**
 * Offered in the chat and voice modes only (never inside a background
 * task, so a task can't spawn more tasks). Creates a task row as the
 * person; the route starts it after replying.
 */
export const START_TASK_TOOL: Anthropic.Tool = {
  name: "start_background_task",
  description:
    "Hand a bigger job to the background so the legal officer can carry on while you work: e.g. preparing a renewal pack, filling out several forms, or going through many scans. Use it when the job needs more than a few lookups and drafts, or when asked to 'work on it in the background'. Write the request so it stands on its own: the background run sees only this text, not this chat.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short title, e.g. 'PBO renewal pack'." },
      request: {
        type: "string",
        description: "The full instructions, with every detail from this conversation the work needs (which documents, folders, what to draft).",
      },
    },
    required: ["title", "request"],
    additionalProperties: false,
  },
  strict: true,
};

// ────────────────────────────────────────────────────────────
// EXECUTION
// ────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** Words for an ilike filter: PostgREST's or() syntax breaks on , ( ) and wildcards. */
function searchTerm(q: string): string {
  return q.replace(/[%_*,()\\"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function snippet(body: string | null, term: string): string | null {
  if (!body) return null;
  const i = body.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return null;
  return `…${body.slice(Math.max(0, i - 160), i + 240).replace(/\s+/g, " ")}…`;
}

type Field = { label: string; value: string; source: string; missing: boolean };
function cleanFields(v: unknown): Field[] | null {
  if (!Array.isArray(v)) return null;
  return v.slice(0, 200).map((f) => ({
    label: text(f?.label, 300),
    value: text(f?.value, 2000),
    source: text(f?.source, 200),
    missing: f?.missing === true,
  }));
}

/** A document or application must sit in the draft's folder. */
async function belongsIn(supabase: Client, table: string, id: string | null, folderId: string): Promise<string | null> {
  if (!id) return null;
  if (!isId(id)) return `${table === "legal_documents" ? "document_id" : "application_id"} is not a valid id`;
  const { data } = await supabase.from(table).select("folder_id").eq("id", id).maybeSingle();
  if (!data) return `No ${table === "legal_documents" ? "document" : "application"} with that id is visible`;
  if (data.folder_id !== folderId) return "It is in a different folder; use that folder_id";
  return null;
}

export type ToolOutcome = {
  output: unknown;
  draft?: { id: string; title: string };
  task?: { id: string; title: string };
};

export async function executeLegalTool(
  name: string,
  input: Record<string, unknown>,
  supabase: Client,
  userId: string
): Promise<ToolOutcome> {
  switch (name) {
    case "get_overview": {
      const [folders, types, reminder] = await Promise.all([
        supabase.from("legal_folders").select("id, name, kind, description, archived_at").order("sort_order"),
        supabase.from("legal_document_types").select("key, name, category, issuer, lead_days, is_confirmed").order("sort_order"),
        loadReminder(supabase, todayInSA()),
      ]);
      return {
        output: {
          today: todayInSA(),
          folders: folders.data ?? [],
          types: types.data ?? [],
          needs_attention: [...reminder.today, ...reminder.open].map(({ kind, id, title, folder, when }) => ({ kind, id, title, folder, when })),
        },
      };
    }

    case "search_legal": {
      const term = searchTerm(text(input.query, 200));
      if (term.length < 2) return { output: { error: "Search with at least two letters." } };
      const like = `%${term}%`;
      const [docs, files, apps, drafts] = await Promise.all([
        supabase
          .from("legal_documents")
          .select("id, title, holder, issuer, reference_no, expires_on, status, folder_id, notes")
          .or(`title.ilike.${like},holder.ilike.${like},issuer.ilike.${like},reference_no.ilike.${like},notes.ilike.${like}`)
          .limit(15),
        supabase
          .from("legal_files")
          .select("id, folder_id, document_id, original_name, extracted_fields, extracted_text")
          .ilike("extracted_text", like)
          .limit(10),
        supabase.from("legal_applications").select("id, title, status, lodge_by, folder_id, document_id").ilike("title", like).limit(10),
        supabase.from("legal_drafts").select("id, title, status, folder_id").ilike("title", like).limit(10),
      ]);
      return {
        output: {
          documents: (docs.data ?? []).map((d: Record<string, unknown>) => ({ ...d, notes: snippet(d.notes as string | null, term) })),
          scans: (files.data ?? []).map((f: Record<string, unknown>) => ({
            id: f.id,
            folder_id: f.folder_id,
            document_id: f.document_id,
            name: f.original_name,
            what_it_is: (f.extracted_fields as { document_kind?: string } | null)?.document_kind ?? null,
            snippet: snippet(f.extracted_text as string | null, term),
          })),
          applications: apps.data ?? [],
          drafts: drafts.data ?? [],
        },
      };
    }

    case "get_document": {
      if (!isId(input.document_id)) return { output: { error: "document_id is not a valid id" } };
      const id = input.document_id;
      const [doc, files, apps, drafts] = await Promise.all([
        supabase
          .from("legal_documents")
          .select("*, legal_document_types:type_id(key, name, lead_days), legal_folders:folder_id(id, name, kind)")
          .eq("id", id)
          .maybeSingle(),
        supabase.from("legal_files").select("id, original_name, mime_type, extraction_status, extracted_fields, created_at").eq("document_id", id),
        supabase.from("legal_applications").select("id, title, status, lodge_by, submitted_on, expected_on, reference_no, notes").eq("document_id", id),
        supabase.from("legal_drafts").select("id, title, kind, status, updated_at").eq("document_id", id),
      ]);
      if (!doc.data) return { output: { error: "No document with that id is visible to you." } };
      return {
        output: {
          document: doc.data,
          scans: (files.data ?? []).map((f: Record<string, unknown>) => {
            const r = (f.extracted_fields ?? {}) as Record<string, unknown>;
            return {
              id: f.id,
              name: f.original_name,
              read: f.extraction_status,
              what_it_is: r.document_kind ?? null,
              summary: r.summary ?? null,
              things_to_watch: r.things_to_watch ?? [],
            };
          }),
          applications: apps.data ?? [],
          drafts: drafts.data ?? [],
        },
      };
    }

    case "read_scan": {
      if (!isId(input.file_id)) return { output: { error: "file_id is not a valid id" } };
      const { data } = await supabase
        .from("legal_files")
        .select("id, folder_id, document_id, original_name, extraction_status, extracted_fields, extracted_text")
        .eq("id", input.file_id)
        .maybeSingle();
      if (!data) return { output: { error: "No scan with that id is visible to you." } };
      if (data.extraction_status !== "done") {
        return { output: { error: "This scan hasn't been read yet. Ask the legal officer to press Read on it in Documents." } };
      }
      return {
        output: {
          id: data.id,
          folder_id: data.folder_id,
          document_id: data.document_id,
          name: data.original_name,
          reading: data.extracted_fields,
          text: (data.extracted_text ?? "").slice(0, 30000),
        },
      };
    }

    case "list_drafts": {
      const { data } = await supabase
        .from("legal_drafts")
        .select("id, title, kind, status, sent_back_note, folder_id, document_id, application_id, updated_at")
        .order("updated_at", { ascending: false })
        .limit(30);
      return { output: { drafts: data ?? [] } };
    }

    case "save_draft": {
      if (!isId(input.folder_id)) return { output: { error: "folder_id is not a valid id. Call get_overview for the folders." } };
      const folderId = input.folder_id;
      const docId = (input.document_id as string | null) ?? null;
      const appId = (input.application_id as string | null) ?? null;
      for (const problem of [
        await belongsIn(supabase, "legal_documents", docId, folderId),
        await belongsIn(supabase, "legal_applications", appId, folderId),
      ]) {
        if (problem) return { output: { error: problem } };
      }
      const title = text(input.title, 200).trim();
      if (!title) return { output: { error: "A draft needs a title." } };
      const kind = ["letter", "form", "other"].includes(input.kind as string) ? (input.kind as string) : "other";
      const { data, error } = await supabase
        .from("legal_drafts")
        .insert({
          folder_id: folderId,
          document_id: docId,
          application_id: appId,
          title,
          kind,
          body: text(input.body, 60000),
          fields: cleanFields(input.fields) ?? [],
          notes_for_approver: text(input.notes_for_approver, 4000) || null,
          created_via: "helper",
          created_by: userId,
        })
        .select("id, title, status")
        .single();
      if (error) return { output: { error: `Could not save: ${error.message}` } };
      return {
        output: { saved: true, draft_id: data.id, status: "awaiting approval", where: "Documents → Drafts" },
        draft: { id: data.id, title: data.title },
      };
    }

    case "update_draft": {
      if (!isId(input.draft_id)) return { output: { error: "draft_id is not a valid id" } };
      const { data: current } = await supabase
        .from("legal_drafts")
        .select("id, folder_id, status")
        .eq("id", input.draft_id)
        .maybeSingle();
      if (!current) return { output: { error: "No draft with that id is visible to you." } };
      if (current.status === "approved") {
        return { output: { error: "That draft is approved and can't change. Save a new draft instead." } };
      }
      const change: Record<string, unknown> = { status: "awaiting_approval", sent_back_note: null };
      if (typeof input.title === "string" && input.title.trim()) change.title = text(input.title, 200).trim();
      if (typeof input.body === "string") change.body = text(input.body, 60000);
      const fields = cleanFields(input.fields);
      if (fields) change.fields = fields;
      if (typeof input.notes_for_approver === "string") change.notes_for_approver = text(input.notes_for_approver, 4000) || null;
      const folderId = isId(input.folder_id) ? input.folder_id : current.folder_id;
      if (folderId !== current.folder_id) {
        change.folder_id = folderId;
        // Its old document and application live in the old folder.
        change.document_id = null;
        change.application_id = null;
      }
      if (input.document_id !== null && input.document_id !== undefined) {
        const problem = await belongsIn(supabase, "legal_documents", input.document_id as string, folderId);
        if (problem) return { output: { error: problem } };
        change.document_id = input.document_id;
      }
      const { data, error } = await supabase
        .from("legal_drafts")
        .update(change)
        .eq("id", current.id)
        .select("id, title")
        .single();
      if (error) return { output: { error: `Could not update: ${error.message}` } };
      return { output: { updated: true, draft_id: data.id, status: "awaiting approval" }, draft: { id: data.id, title: data.title } };
    }

    case "start_background_task": {
      const title = text(input.title, 200).trim();
      const request = text(input.request, 20000).trim();
      if (!title || !request) return { output: { error: "A background task needs a title and a request." } };
      const { data: recent } = await supabase
        .from("legal_helper_tasks")
        .select("status, heartbeat_at, created_at")
        .eq("created_by", userId)
        .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
      const limit = taskLimitProblem(recent ?? [], Date.now());
      if (limit) return { output: { error: `${limit} Do it here in the chat instead, or tell the legal officer.` } };
      const { data, error } = await supabase
        .from("legal_helper_tasks")
        .insert({ title, request, created_by: userId })
        .select("id, title")
        .single();
      if (error) return { output: { error: `Could not start it: ${error.message}` } };
      return {
        output: { started: true, task_id: data.id, where: "Documents → Drafts, under Helper tasks" },
        task: { id: data.id, title: data.title },
      };
    }

    default:
      return { output: { error: `Unknown tool: ${name}` } };
  }
}
