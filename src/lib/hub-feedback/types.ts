// Shapes the hub-feedback routes send to the browser. Names are resolved
// server-side so the client never needs to read users rows.

export type FeedbackListItem = {
  id: string;
  ref: number;
  kind: string;
  title: string;
  severity: string | null;
  status: string;
  status_note: string | null;
  status_changed_at: string;
  module_id: string | null;
  module_label: string | null;
  source: string;
  submitted_by: string;
  submitter_name: string;
  assigned_to: string | null;
  assignee_name: string | null;
  duplicate_of: string | null;
  /** Items merged into this one. */
  duplicate_count: number;
  created_at: string;
};

export type FeedbackDetail = {
  item: FeedbackListItem & {
    details: string | null;
    page_path: string | null;
    user_agent: string | null;
    viewport: string | null;
  };
  /** For a duplicate: the item it was merged into (ref, title, status only). */
  merged_into: { id: string; ref: number; title: string; status: string } | null;
  duplicates: { id: string; ref: number; title: string; submitter_name: string; created_at: string }[];
  comments: { id: string; author_name: string; mine: boolean; visibility: "team" | "submitter"; body: string; created_at: string }[];
  events: { id: string; actor_name: string | null; kind: string; from_status: string | null; to_status: string | null; note: string | null; created_at: string }[];
  files: { id: string; file_name: string | null; content_type: string | null; url: string | null }[];
  /** What the viewer may do with it. */
  can_triage: boolean;
  is_team: boolean;
};
