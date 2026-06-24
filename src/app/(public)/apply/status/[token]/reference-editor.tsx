"use client";

import { useState } from "react";

// Dark-shell palette (mirrors PUBLIC_SHELL_TOKENS — kept local so this client
// component doesn't pull the server shell module into the browser bundle).
const C = {
  text: "#F0EBE3",
  dim: "#A89F92",
  faint: "#6b6358",
  border: "#2a2420",
  inputBg: "#14110D",
  yellow: "#F5C518",
  green: "hsl(142 60% 60%)",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EditableReference = {
  id: string;
  status: string;
  referee_name: string;
  referee_email: string;
  slot_label: string;
};

export function ReferenceEditor({
  statusToken,
  references,
}: {
  statusToken: string;
  references: EditableReference[];
}) {
  const [rows, setRows] = useState<EditableReference[]>(references);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function startEdit(ref: EditableReference) {
    setEditingId(ref.id);
    setName(ref.referee_name ?? "");
    setEmail(ref.referee_email ?? "");
    setError(null);
    setNotice(null);
  }

  function cancel() {
    setEditingId(null);
    setName("");
    setEmail("");
    setError(null);
  }

  async function save(refId: string) {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) {
      setError("Please enter the reference's name.");
      return;
    }
    if (!EMAIL_RE.test(trimmedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/public/references", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status_token: statusToken,
          reference_request_id: refId,
          referee_name: trimmedName,
          referee_email: trimmedEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Couldn't save your change. Please try again.");
        return;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === refId
            ? { ...r, referee_name: trimmedName, referee_email: trimmedEmail }
            : r
        )
      );
      setNotice(
        data.email_changed
          ? data.emailed
            ? "Saved — we've emailed a fresh request to the new address. The previous link no longer works."
            : "Saved. We couldn't send the email just now, but you can update again to retry."
          : "Saved."
      );
      cancel();
    } catch {
      setError("Couldn't save your change. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (rows.length === 0) return null;

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: C.dim,
  };
  const inputStyle: React.CSSProperties = {
    width: "100%",
    marginTop: 4,
    padding: "8px 10px",
    fontSize: 14,
    color: C.text,
    background: C.inputBg,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    outline: "none",
  };

  return (
    <div style={{ marginTop: 8, marginBottom: 16 }}>
      <p style={{ ...labelStyle, marginBottom: 8 }}>Your references</p>

      {notice && (
        <div
          style={{
            marginBottom: 10,
            padding: "8px 10px",
            fontSize: 12,
            color: C.green,
            background: "hsl(142 60% 60% / 0.1)",
            border: "1px solid hsl(142 60% 60% / 0.3)",
            borderRadius: 8,
          }}
        >
          {notice}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((ref) => {
          const submitted = ref.status === "submitted";
          const isEditing = editingId === ref.id;
          return (
            <div
              key={ref.id}
              style={{
                padding: 12,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                    {ref.slot_label}
                  </p>
                  {!isEditing && (
                    <p
                      style={{
                        fontSize: 12,
                        color: C.dim,
                        marginTop: 2,
                        wordBreak: "break-word",
                      }}
                    >
                      {ref.referee_name} · {ref.referee_email}
                    </p>
                  )}
                </div>
                {submitted ? (
                  <span
                    style={{
                      flexShrink: 0,
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: C.green,
                    }}
                  >
                    Received
                  </span>
                ) : (
                  !isEditing && (
                    <button
                      type="button"
                      onClick={() => startEdit(ref)}
                      style={{
                        flexShrink: 0,
                        fontSize: 12,
                        fontWeight: 600,
                        color: C.yellow,
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      Fix details
                    </button>
                  )
                )}
              </div>

              {isEditing && (
                <div style={{ marginTop: 10 }}>
                  <label style={labelStyle}>
                    Name
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Reference's full name"
                      style={inputStyle}
                    />
                  </label>
                  <div style={{ height: 10 }} />
                  <label style={labelStyle}>
                    Email
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@example.com"
                      style={inputStyle}
                    />
                  </label>

                  <p style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>
                    Changing the email sends a fresh request to the new address;
                    the previous link will stop working.
                  </p>

                  {error && (
                    <p style={{ fontSize: 12, color: "hsl(0 75% 70%)", marginTop: 6 }}>
                      {error}
                    </p>
                  )}

                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => save(ref.id)}
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "#0D0B09",
                        background: C.yellow,
                        border: "none",
                        borderRadius: 8,
                        padding: "7px 16px",
                        cursor: saving ? "default" : "pointer",
                        opacity: saving ? 0.6 : 1,
                      }}
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={cancel}
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: C.dim,
                        background: "transparent",
                        border: `1px solid ${C.border}`,
                        borderRadius: 8,
                        padding: "7px 16px",
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
