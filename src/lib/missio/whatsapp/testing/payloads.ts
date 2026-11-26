// Fake Meta webhook payloads. Made-up numbers and ids only.
import type { WebhookPayload } from "../webhook";

export const TEST_PHONE_NUMBER_ID = "100000000000001";
export const TEST_WA_ID = "27820000001"; // fake, not anyone's number

const unix = (iso: string) => String(Math.floor(Date.parse(iso) / 1000));

export function inboundPayload(opts: {
  wamid: string;
  text?: string;
  type?: string;
  from?: string;
  at?: string;
  name?: string;
  phoneNumberId?: string;
  /** A tapped menu row or button (type becomes "interactive"). */
  reply?: { kind: "list" | "button"; id: string; title: string };
}): WebhookPayload {
  const from = opts.from ?? TEST_WA_ID;
  const type = opts.reply ? "interactive" : (opts.type ?? "text");
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "200000000000002",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: opts.phoneNumberId ?? TEST_PHONE_NUMBER_ID },
              contacts: [{ wa_id: from, profile: { name: opts.name ?? "Test Person" } }],
              messages: [
                {
                  from,
                  id: opts.wamid,
                  timestamp: unix(opts.at ?? "2026-11-23T12:00:00Z"),
                  type,
                  ...(type === "text" ? { text: { body: opts.text ?? "Hello" } } : {}),
                  ...(opts.reply
                    ? {
                        interactive:
                          opts.reply.kind === "list"
                            ? { type: "list_reply", list_reply: { id: opts.reply.id, title: opts.reply.title } }
                            : { type: "button_reply", button_reply: { id: opts.reply.id, title: opts.reply.title } },
                      }
                    : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function statusPayload(opts: {
  wamid: string;
  status: string;
  at?: string;
  error?: { code: number; title: string };
  phoneNumberId?: string;
}): WebhookPayload {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "200000000000002",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: opts.phoneNumberId ?? TEST_PHONE_NUMBER_ID },
              statuses: [
                {
                  id: opts.wamid,
                  status: opts.status,
                  timestamp: unix(opts.at ?? "2026-11-23T12:00:05Z"),
                  recipient_id: TEST_WA_ID,
                  ...(opts.error ? { errors: [opts.error] } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
