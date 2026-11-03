"use client";

import { useState } from "react";
import { PUBLIC_SHELL_TOKENS } from "@/components/public-form-shell";
import type { DeletionRequestView } from "./load";

const T = PUBLIC_SHELL_TOKENS;


type Step = "idle" | "confirm" | "sending" | "cancel-confirm" | "cancelling";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  });
}

const pStyle = { fontSize: 15, lineHeight: 1.6, color: T.text, margin: "0 0 12px" } as const;

// Square, flat, 48px targets. The destructive action is the light outlined
// button with words that say what it does; colour is never the only signal.
function buttonStyle(kind: "primary" | "secondary" | "danger") {
  return {
    minHeight: 48,
    padding: "12px 18px",
    borderRadius: 0,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    cursor: "pointer",
    border: kind === "secondary" ? `1px solid ${T.borderSoft}` : `2px solid ${kind === "danger" ? T.red : T.yellow}`,
    background: kind === "primary" ? T.yellow : "transparent",
    color: kind === "primary" ? "#0A0A0A" : T.text,
  };
}

// Files / cancels the caller's request through the same API the phone app
// uses. Two steps, never one click: the first button only opens the
// confirmation.
export function DeletionRequestPanel({
  initial,
  contactEmail,
}: {
  initial: DeletionRequestView | null;
  contactEmail: string;
}) {
  const [request, setRequest] = useState<DeletionRequestView | null>(initial);
  const [step, setStep] = useState<Step>("idle");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notRecorded, setNotRecorded] = useState(false);

  async function send() {
    setStep("sending");
    setError(null);
    try {
      const res = await fetch("/api/account/deletion-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, reason: reason.trim() || null, source: "web" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Something went wrong. Please try again, or email ${contactEmail}.`);
        setStep("confirm");
        return;
      }
      setNotRecorded(body.recorded === false);
      setRequest({ requestedAt: body.request?.requestedAt ?? new Date().toISOString(), reason: body.request?.reason ?? null });
      setStep("idle");
    } catch {
      setError(`We couldn't reach FFSA Hub. Check your connection and try again, or email ${contactEmail}.`);
      setStep("confirm");
    }
  }

  async function cancel() {
    setStep("cancelling");
    setError(null);
    try {
      const res = await fetch("/api/account/deletion-request", { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 404) {
        setError(body.error ?? `Something went wrong. Please try again, or email ${contactEmail}.`);
        setStep("cancel-confirm");
        return;
      }
      setRequest(null);
      setReason("");
      setStep("idle");
    } catch {
      setError(`We couldn't reach FFSA Hub. Check your connection and try again, or email ${contactEmail}.`);
      setStep("cancel-confirm");
    }
  }

  const errorBox = error ? (
    <p role="alert" style={{ ...pStyle, borderLeft: `3px solid ${T.red}`, paddingLeft: 12 }}>
      <strong>Not sent. </strong>
      {error}
    </p>
  ) : null;

  if (request) {
    return (
      <div data-testid="requested" aria-live="polite">
        <p style={{ ...pStyle, borderLeft: `3px solid ${T.yellow}`, paddingLeft: 12 }}>
          <strong>Requested on {formatDate(request.requestedAt)}.</strong> We&apos;ll email you when it&apos;s done.
          {notRecorded ? " Our team has your request by email." : ""}
        </p>
        <p style={pStyle}>Your account keeps working until then. Changed your mind? You can cancel the request.</p>
        {errorBox}
        {step === "cancel-confirm" || step === "cancelling" ? (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button type="button" style={buttonStyle("primary")} disabled={step === "cancelling"} onClick={cancel}>
              {step === "cancelling" ? "Cancelling…" : "Yes, keep my account"}
            </button>
            <button type="button" style={buttonStyle("secondary")} onClick={() => setStep("idle")}>
              Go back
            </button>
          </div>
        ) : (
          <button type="button" style={buttonStyle("secondary")} onClick={() => setStep("cancel-confirm")}>
            Cancel my request
          </button>
        )}
      </div>
    );
  }

  return (
    <div data-testid="request-form">
      <label htmlFor="deletion-reason" style={{ display: "block", fontSize: 13, color: T.textDim, marginBottom: 6 }}>
        Why are you leaving? (optional)
      </label>
      <textarea
        id="deletion-reason"
        value={reason}
        maxLength={1000}
        rows={3}
        onChange={(e) => setReason(e.target.value)}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 0,
          border: `1px solid ${T.borderSoft}`,
          background: T.cardElev,
          color: T.text,
          fontSize: 15,
          marginBottom: 16,
        }}
      />
      {errorBox}
      {step === "confirm" || step === "sending" ? (
        <div role="group" aria-labelledby="deletion-confirm-heading">
          <p id="deletion-confirm-heading" style={pStyle}>
            <strong>Are you sure?</strong> Once our team deletes your account you can&apos;t sign in again, and
            we can&apos;t bring it back.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button type="button" style={buttonStyle("danger")} disabled={step === "sending"} onClick={send}>
              {step === "sending" ? "Sending…" : "Yes, send my request"}
            </button>
            <button type="button" style={buttonStyle("secondary")} onClick={() => setStep("idle")}>
              Go back
            </button>
          </div>
        </div>
      ) : (
        <button type="button" style={buttonStyle("danger")} onClick={() => setStep("confirm")}>
          Request account deletion
        </button>
      )}
    </div>
  );
}
