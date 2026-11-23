import type {
  InboxResponse,
  SendResponse,
  TemplatesResponse,
  ThreadResponse,
} from "@/lib/missio/whatsapp/types";

/** Where the WhatsApp button on a person goes, for pastors. One place, used everywhere. */
export function whatsAppThreadHref(key: { personId: string } | { threadId: string }): string {
  return "personId" in key
    ? `/missio/whatsapp?person=${encodeURIComponent(key.personId)}`
    : `/missio/whatsapp?thread=${encodeURIComponent(key.threadId)}`;
}

export class WhatsAppApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly body: unknown;
  constructor(status: number, message: string, code: string | null, body: unknown) {
    super(message);
    this.name = "WhatsAppApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export type SendBody =
  | { personId?: string; threadId?: string; text: string }
  | { personId?: string; threadId?: string; template: { name: string; language: string; values: Record<string, string> } };

export type WhatsAppClient = {
  inbox(): Promise<InboxResponse>;
  thread(key: { personId: string } | { threadId: string }): Promise<ThreadResponse>;
  markRead(threadId: string): Promise<void>;
  templates(fresh?: boolean): Promise<TemplatesResponse>;
  send(body: SendBody): Promise<SendResponse>;
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  if (!res.ok) {
    throw new WhatsAppApiError(res.status, body?.error ?? "Something went wrong.", body?.code ?? null, body);
  }
  return body as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const whatsAppClient: WhatsAppClient = {
  inbox: () => call<InboxResponse>("/api/missio/whatsapp"),
  thread: (key) =>
    call<ThreadResponse>(
      "personId" in key
        ? `/api/missio/whatsapp/thread?person=${encodeURIComponent(key.personId)}`
        : `/api/missio/whatsapp/thread?thread=${encodeURIComponent(key.threadId)}`
    ),
  markRead: async (threadId) => {
    await call("/api/missio/whatsapp/thread/read", json({ threadId }));
  },
  // 503 / 502 still carry a body the composer can show.
  templates: async (fresh) => {
    try {
      return await call<TemplatesResponse>(`/api/missio/whatsapp/templates${fresh ? "?fresh=1" : ""}`);
    } catch (error) {
      const body = error instanceof WhatsAppApiError ? (error.body as TemplatesResponse | null) : null;
      if (body && "state" in body) return body;
      throw error;
    }
  },
  send: (body) => call<SendResponse>("/api/missio/whatsapp/send", json(body)),
};
