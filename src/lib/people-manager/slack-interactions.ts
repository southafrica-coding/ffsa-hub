// Slack clicks on a People Manager leave card (lib/slack/leave-approval).
// Called from /api/slack/interactions after its signature check, like the
// vehicle coordinator's buttons (lib/vehicles/slack-interactions).
//
//   Approve              decide now (approved, no note)
//   Approve with a note  open the note modal (note optional)
//   Deny                 open the note modal (note required, 421)
//   modal submit         decide with the note
//   Open in Hub          a link; nothing to do
//
// The clicker must be a Slack-linked Hub user whom 421 lets decide this
// request (leave_user_can_decide: another leader of the department, or an
// admin; never the requester). The first decision wins (lib/people-manager/
// decide: UPDATE … WHERE status = 'pending'); a later click is told who
// decided, privately. Slack wants an ACK within 3s: a button's decision runs
// in after(); a modal's decision runs before the ACK so the modal can say
// whether it counted. The modal opens before the ACK because its trigger_id
// expires in 3s.

import { after, NextResponse } from "next/server";
import * as slack from "@/lib/slack/client";
import {
  PM_LEAVE_APPROVE,
  PM_LEAVE_APPROVE_NOTE,
  PM_LEAVE_DENY,
  PM_LEAVE_NOTE_VIEW,
  isLeaveAction,
  isLeaveView,
  personName,
  runLeaveDecided,
  safely,
  type LeaveSlackDeps,
} from "@/lib/slack/leave-approval";
import { decideLeaveRequest, type DecideOutcome } from "./decide";
import { leaveErrorCode } from "./http";
import { isUuid } from "@/lib/departments/validate";
import { LEAVE_TABLES, PERSON_COLUMNS } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type LeaveInteraction = {
  type: string;
  user: { id: string };
  trigger_id?: string;
  response_url?: string;
  actions?: { action_id: string; block_id?: string; value?: string }[];
  view?: { callback_id: string; private_metadata: string; state: { values: Record<string, Record<string, { value?: string | null }>> } };
};

/** Is this payload one of ours? The dispatcher in /api/slack/interactions asks. */
export function isLeaveInteraction(p: { type?: string; actions?: { action_id: string }[]; view?: { callback_id?: string } }): boolean {
  return isLeaveView(p.view?.callback_id) || (p.type === "block_actions" && isLeaveAction(p.actions?.[0]?.action_id));
}

const ok = () => new NextResponse(null, { status: 200 });

/** Private reply under the card; only the clicker sees it. */
async function tell(responseUrl: string | undefined, text: string) {
  if (!responseUrl) return;
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text }),
  }).catch(() => {});
}

type Req = { id: string; department_id: string; requester_id: string; status: string; decided_by: string | null; cancelled_by: string | null };

/** The linked Hub user, if 421 lets them decide this request; else why not. */
async function decider(admin: Client, slackUserId: string, requestId: string): Promise<{ id: string; request: Req } | { error: string }> {
  const { data: user } = await admin.from("users").select("id").eq("slack_user_id", slackUserId).maybeSingle();
  if (!user) return { error: "Your Slack isn't linked to a Hub account yet. Link it on your Hub profile." };
  const { data: request } = await admin
    .from(LEAVE_TABLES.requests)
    .select("id, department_id, requester_id, status, decided_by, cancelled_by")
    .eq("id", requestId)
    .maybeSingle();
  if (!request) return { error: "That leave request no longer exists." };
  if (request.requester_id === user.id) return { error: "Nobody decides their own leave." };
  const can = await admin.rpc("leave_user_can_decide", {
    p_department_id: request.department_id,
    p_requester_id: request.requester_id,
    p_user: user.id,
  });
  if (can.error || can.data !== true) return { error: "Only another leader of this department, or an admin, can decide this." };
  return { id: user.id, request };
}

async function nameOf(admin: Client, userId: string | null): Promise<string> {
  if (!userId) return "someone";
  const { data } = await admin.from("users").select(PERSON_COLUMNS).eq("id", userId).maybeSingle();
  return personName(data);
}

/** "Already approved by Mia Fourie." / "Already cancelled by …". */
export async function alreadySettledText(admin: Client, r: Pick<Req, "status" | "decided_by" | "cancelled_by">): Promise<string> {
  if (r.status === "cancelled") return `This request was already cancelled by ${await nameOf(admin, r.cancelled_by)}.`;
  const verb = r.status === "approved" ? "approved" : "denied";
  return `Already ${verb} by ${await nameOf(admin, r.decided_by)}. The first decision counts.`;
}

function failureText(out: Extract<DecideOutcome, { outcome: "error" }>): string {
  const code = leaveErrorCode(out.error);
  if (code === "leave_request_decline_note_required") return "Say why when denying.";
  if (code === "leave_request_not_approver" || code === "leave_request_self_decision") return "You can't decide this request.";
  if (code === "leave_request_already_decided" || code === "leave_request_locked") return "This request has already been decided.";
  return "Couldn't save the decision. Try again in the Hub.";
}

function noteModal(requestId: string, decision: "approved" | "declined") {
  const deny = decision === "declined";
  return {
    type: "modal",
    callback_id: PM_LEAVE_NOTE_VIEW,
    private_metadata: JSON.stringify({ id: requestId, decision }),
    title: { type: "plain_text", text: deny ? "Deny request" : "Approve with a note" },
    submit: { type: "plain_text", text: deny ? "Deny request" : "Approve" },
    close: { type: "plain_text", text: "Back" },
    blocks: [
      {
        type: "input",
        block_id: "note",
        optional: !deny,
        label: { type: "plain_text", text: "Note to them" },
        element: {
          type: "plain_text_input",
          action_id: "note",
          multiline: true,
          max_length: 1000,
          placeholder: { type: "plain_text", text: deny ? "Say why, and what would work instead" : "Anything they should know" },
        },
        hint: { type: "plain_text", text: "They see this in their Slack DM and in the Hub." },
      },
    ],
  };
}

const modalMessage = (title: string, text: string) => ({
  response_action: "update",
  view: {
    type: "modal",
    title: { type: "plain_text", text: title },
    close: { type: "plain_text", text: "Done" },
    blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
  },
});

export type LeaveInteractionDeps = { slack?: LeaveSlackDeps; env?: NodeJS.ProcessEnv };

export async function handleLeaveInteraction(admin: Client, p: LeaveInteraction, deps: LeaveInteractionDeps = {}): Promise<NextResponse> {
  const settle = (requestId: string) =>
    safely(`decided ${requestId}`, () => runLeaveDecided(admin, requestId, { deps: deps.slack, env: deps.env }));

  // ── The note modal was submitted ──
  if (p.type === "view_submission" && isLeaveView(p.view?.callback_id)) {
    let meta: { id?: unknown; decision?: unknown } = {};
    try {
      meta = JSON.parse(p.view!.private_metadata || "{}");
    } catch {
      /* falls through to the check below */
    }
    const decision = meta.decision === "declined" ? "declined" : meta.decision === "approved" ? "approved" : null;
    if (!isUuid(meta.id) || !decision) return NextResponse.json({ response_action: "errors", errors: { note: "This form is out of date. Open the request in the Hub." } });
    const requestId = meta.id;
    const note = (p.view!.state.values.note?.note?.value ?? "").trim() || null;
    if (decision === "declined" && !note) return NextResponse.json({ response_action: "errors", errors: { note: "Say why when denying" } });
    const who = await decider(admin, p.user.id, requestId);
    if ("error" in who) return NextResponse.json({ response_action: "errors", errors: { note: who.error } });
    const out = await decideLeaveRequest(admin, { requestId, deciderId: who.id, decision, note });
    if (out.outcome === "already-decided") return NextResponse.json(modalMessage("Already decided", await alreadySettledText(admin, out.request)));
    if (out.outcome === "not-found") return NextResponse.json(modalMessage("Not found", "That leave request no longer exists."));
    if (out.outcome === "error") {
      if (leaveErrorCode(out.error) === null) console.error("[leave/slack] decision failed", out.error);
      return NextResponse.json({ response_action: "errors", errors: { note: failureText(out) } });
    }
    after(() => settle(requestId));
    return ok(); // closes the modal
  }

  const action = p.actions?.[0];
  if (!action || ![PM_LEAVE_APPROVE, PM_LEAVE_APPROVE_NOTE, PM_LEAVE_DENY].includes(action.action_id)) return ok();
  const requestId = action.value ?? "";
  if (!isUuid(requestId)) return ok();

  const who = await decider(admin, p.user.id, requestId);
  if ("error" in who) {
    after(() => tell(p.response_url, who.error));
    return ok();
  }
  if (who.request.status !== "pending") {
    const settled = who.request;
    after(async () => {
      await tell(p.response_url, await alreadySettledText(admin, settled));
      if (settled.status !== "cancelled") await settle(requestId); // make sure this card shows it
    });
    return ok();
  }

  if (action.action_id === PM_LEAVE_DENY || action.action_id === PM_LEAVE_APPROVE_NOTE) {
    if (p.trigger_id) {
      await slack
        .openView(p.trigger_id, noteModal(requestId, action.action_id === PM_LEAVE_DENY ? "declined" : "approved"))
        .catch((err) => console.error("[leave/slack] views.open failed", err));
    }
    return ok();
  }

  // Approve
  after(async () => {
    const out = await decideLeaveRequest(admin, { requestId, deciderId: who.id, decision: "approved", note: null });
    if (out.outcome === "already-decided") return tell(p.response_url, await alreadySettledText(admin, out.request));
    if (out.outcome === "not-found") return tell(p.response_url, "That leave request no longer exists.");
    if (out.outcome === "error") {
      if (leaveErrorCode(out.error) === null) console.error("[leave/slack] approve failed", out.error);
      return tell(p.response_url, failureText(out));
    }
    await settle(requestId);
  });
  return ok();
}
