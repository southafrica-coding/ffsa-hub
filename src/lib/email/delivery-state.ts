// How an email's delivery is shown.
//
// Open and click tracking is off for ffsahub.com, so a missing open or click
// is the normal case. Sent and delivered are success. Only a bounce, a
// complaint, a drop, or a failed send is a problem. Nothing in here treats
// "not opened" or "no click" as a warning.

export type DeliveryTone = "success" | "problem" | "neutral";

export type DeliveryPresentation = {
  label: string;
  tone: DeliveryTone;
};

type MessageSignals = {
  status?: string | null;
  sent_at?: string | null;
  delivered_at?: string | null;
  opened_at?: string | null;
  first_clicked_at?: string | null;
  bounced_at?: string | null;
  complained_at?: string | null;
  unsubscribed_at?: string | null;
};

export function presentationForStatus(
  status: string | null | undefined
): DeliveryPresentation {
  switch (status) {
    case "delivered":
      return { label: "Delivered", tone: "success" };
    case "sent":
      return { label: "Sent", tone: "success" };
    case "opened":
      // Historical rows only. Still a successful delivery.
      return { label: "Delivered", tone: "success" };
    case "bounced":
      return { label: "Bounced", tone: "problem" };
    case "failed":
      return { label: "Failed", tone: "problem" };
    case "complained":
      return { label: "Spam", tone: "problem" };
    case "dropped":
      return { label: "Dropped", tone: "problem" };
    case "unsubscribed":
      return { label: "Unsubscribed", tone: "neutral" };
    case "queued":
      return { label: "Queued", tone: "neutral" };
    default: {
      const label = status
        ? status.charAt(0).toUpperCase() + status.slice(1)
        : "Queued";
      return { label, tone: "neutral" };
    }
  }
}

/**
 * One label for a ledger row or a campaign recipient. `opened_at` and
 * `first_clicked_at` are accepted so callers can pass the row straight
 * through, and then ignored: their absence is not a worse state.
 */
export function presentationForMessage(row: MessageSignals): DeliveryPresentation {
  if (row.complained_at || row.status === "complained") {
    return presentationForStatus("complained");
  }
  if (row.status === "failed" || row.status === "dropped") {
    return presentationForStatus(row.status);
  }
  const delivered =
    !!row.delivered_at || row.status === "delivered" || row.status === "opened";
  // A bounce that was later delivered (a transient retry) is not the problem.
  const bounced =
    row.status === "bounced" || (!!row.bounced_at && !delivered && row.status !== "sent");
  if (bounced) return presentationForStatus("bounced");
  if (delivered) return { label: "Delivered", tone: "success" };
  if (row.sent_at || row.status === "sent") {
    return { label: "Sent", tone: "success" };
  }
  if (row.unsubscribed_at) return presentationForStatus("unsubscribed");
  return presentationForStatus(row.status ?? "queued");
}

/** Campaign recipient table tones. Sent without a click is success, not a warning. */
export function recipientLogStatus(row: MessageSignals): {
  label: string;
  tone: "good" | "bad" | "quiet";
  at: string | null;
} {
  const view = presentationForMessage(row);
  const tone = view.tone === "success" ? "good" : view.tone === "problem" ? "bad" : "quiet";
  const at =
    (view.tone === "problem" ? row.bounced_at ?? row.complained_at : null) ??
    row.delivered_at ??
    row.sent_at ??
    row.unsubscribed_at ??
    null;
  return { label: view.label, tone, at };
}

export function badgeVariant(
  tone: DeliveryTone
): "secondary" | "destructive" | "outline" {
  if (tone === "problem") return "destructive";
  if (tone === "success") return "secondary";
  return "outline";
}
