"use client";

import type { WaiverSlot, WaiverSlotValues } from "@/lib/ticketing/waivers";

// Brand-agnostic waiver-signing block on a storefront: one card per ticket
// of a tier that requires a waiver. The parent/guardian opens the uploaded
// form (PDF) in a new tab, fills their details, types their name to sign,
// and ticks agreement. Answer state is namespaced per slot key so two
// tickets keep separate signatures.
//
// `variant` matches the host storefront: most brands render on a dark
// background (default), while the camps storefront is light. The card
// blends into whichever it's placed on rather than punching a bright
// panel through a dark page.

type Variant = "dark" | "light";

type Palette = {
  card: string;
  border: string;
  kicker: string;
  title: string;
  body: string;
  label: string;
  link: string;
  input: React.CSSProperties;
  agreeText: string;
};

const PALETTES: Record<Variant, Palette> = {
  dark: {
    card: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(233,206,143,0.45)",
    kicker: "#e6c67a",
    title: "#f6f2e8",
    body: "rgba(246,242,232,0.75)",
    label: "rgba(246,242,232,0.72)",
    link: "#7fb2ff",
    agreeText: "#f6f2e8",
    input: {
      background: "rgba(0,0,0,0.35)",
      border: "1px solid rgba(255,255,255,0.22)",
      color: "#f6f2e8",
    },
  },
  light: {
    card: "#fbf8ef",
    border: "2px solid #d7cca8",
    kicker: "#8a7a3d",
    title: "#1a1a1a",
    body: "#4b5563",
    label: "#33404f",
    link: "#1d4ed8",
    agreeText: "#1a1a1a",
    input: {
      background: "#fff",
      border: "1px solid #cbd2dd",
      color: "#1a1a1a",
    },
  },
};

export function WaiverSignatureSection({
  eventId,
  slots,
  valuesBySlot,
  errorsBySlot,
  onChange,
  variant = "dark",
}: {
  eventId: string;
  slots: WaiverSlot[];
  valuesBySlot: Record<string, WaiverSlotValues>;
  errorsBySlot: Record<string, Record<string, string>>;
  onChange: (slotKey: string, field: keyof WaiverSlotValues, value: unknown) => void;
  variant?: Variant;
}) {
  if (slots.length === 0) return null;
  const p = PALETTES[variant];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {slots.map((slot) => {
        const v = valuesBySlot[slot.key] ?? {};
        const e = errorsBySlot[slot.key] ?? {};
        const inputStyle: React.CSSProperties = {
          width: "100%",
          borderRadius: 8,
          padding: "9px 11px",
          fontSize: 14,
          ...p.input,
        };
        const labelStyle: React.CSSProperties = {
          display: "block",
          fontSize: 12.5,
          fontWeight: 600,
          color: p.label,
          marginBottom: 4,
        };
        const errStyle: React.CSSProperties = {
          color: "#ff6b6b",
          fontSize: 12,
          marginTop: 4,
        };
        return (
          <div
            key={slot.key}
            style={{
              border: p.border,
              borderRadius: 12,
              padding: 16,
              background: p.card,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: p.kicker,
                  margin: 0,
                }}
              >
                Signature required · {slot.ticketTypeName} · Ticket{" "}
                {slot.index + 1}
              </p>
              <p
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: p.title,
                  margin: "3px 0 0",
                }}
              >
                {slot.waiver.title}
              </p>
              {slot.waiver.body_markdown ? (
                <p
                  style={{
                    fontSize: 13,
                    color: p.body,
                    margin: "6px 0 0",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {slot.waiver.body_markdown}
                </p>
              ) : null}
            </div>

            <a
              href={`/api/events/${eventId}/waiver-document?tier=${slot.ticketTypeId}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                alignSelf: "flex-start",
                fontSize: 13,
                fontWeight: 600,
                color: p.link,
                textDecoration: "underline",
              }}
            >
              📄 Open the form to read it (PDF)
            </a>

            <div>
              <label style={labelStyle}>Parent / guardian full name *</label>
              <input
                type="text"
                value={v.guardian_name ?? ""}
                onChange={(ev) =>
                  onChange(slot.key, "guardian_name", ev.target.value)
                }
                style={inputStyle}
                placeholder="e.g. Jane Smith"
              />
              {e.guardian_name && (
                <p data-field-error="" style={errStyle}>
                  {e.guardian_name}
                </p>
              )}
            </div>

            {slot.waiver.require_relationship && (
              <div>
                <label style={labelStyle}>Relationship to the attendee *</label>
                <input
                  type="text"
                  value={v.relationship ?? ""}
                  onChange={(ev) =>
                    onChange(slot.key, "relationship", ev.target.value)
                  }
                  style={inputStyle}
                  placeholder="e.g. Mother, Father, Legal guardian"
                />
                {e.relationship && (
                  <p data-field-error="" style={errStyle}>
                    {e.relationship}
                  </p>
                )}
              </div>
            )}

            {slot.waiver.require_minor_name && (
              <div>
                <label style={labelStyle}>Attendee&apos;s full name *</label>
                <input
                  type="text"
                  value={v.minor_name ?? ""}
                  onChange={(ev) =>
                    onChange(slot.key, "minor_name", ev.target.value)
                  }
                  style={inputStyle}
                  placeholder="The child attending"
                />
                {e.minor_name && (
                  <p data-field-error="" style={errStyle}>
                    {e.minor_name}
                  </p>
                )}
              </div>
            )}

            <div>
              <label style={labelStyle}>Type your full name to sign *</label>
              <input
                type="text"
                value={v.typed_signature ?? ""}
                onChange={(ev) =>
                  onChange(slot.key, "typed_signature", ev.target.value)
                }
                style={{
                  ...inputStyle,
                  fontFamily: "'Brush Script MT', cursive",
                  fontSize: 20,
                }}
                placeholder="Your signature"
              />
              {e.typed_signature && (
                <p data-field-error="" style={errStyle}>
                  {e.typed_signature}
                </p>
              )}
            </div>

            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 9,
                fontSize: 13,
                color: p.agreeText,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={v.agreed === true}
                onChange={(ev) => onChange(slot.key, "agreed", ev.target.checked)}
                style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0 }}
              />
              <span>
                I confirm I am the parent/legal guardian, I have read the{" "}
                {slot.waiver.title}, and I agree to it on behalf of the
                attendee.
              </span>
            </label>
            {e.agreed && (
              <p data-field-error="" style={errStyle}>
                {e.agreed}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
