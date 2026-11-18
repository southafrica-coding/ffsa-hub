import { capRetryAfterSeconds, MissioApiError } from "../api";
import type { ConnectField, ConnectFieldErrors, ConnectSubmitBody } from "./types";

export const connectApi = {
  submit: "/api/missio/connect",
} as const;

const FIELD_KEYS: ConnectField[] = ["name", "phone", "email", "visitType", "notes", "prayerRequest"];

export class ConnectSubmitError extends MissioApiError {
  readonly fieldErrors: ConnectFieldErrors;

  constructor(
    status: number,
    code: string | null,
    retryAfterSeconds: number | null,
    fieldErrors: ConnectFieldErrors
  ) {
    super(status, "", retryAfterSeconds, code);
    this.name = "ConnectSubmitError";
    this.fieldErrors = fieldErrors;
  }
}

type FetchLike = typeof fetch;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function fieldErrorsOf(body: Record<string, unknown>): ConnectFieldErrors {
  const raw = asRecord(body.fieldErrors);
  if (!raw) return {};
  const errors: ConnectFieldErrors = {};
  for (const key of FIELD_KEYS) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) errors[key] = value;
  }
  return errors;
}

function retryAfterSeconds(header: string | null): number {
  if (!header) return 60;
  const asNumber = Number(header);
  if (Number.isFinite(asNumber) && asNumber >= 0) return capRetryAfterSeconds(asNumber);
  const at = Date.parse(header);
  if (!Number.isNaN(at)) return capRetryAfterSeconds(Math.max(0, Math.ceil((at - Date.now()) / 1000)));
  return 60;
}

function codeFor(body: Record<string, unknown>, status: number): string {
  if (typeof body.code === "string" && body.code.trim()) return body.code;
  if (status === 400) return "invalid_input";
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "server_error";
}

async function readBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

export interface ConnectClient {
  submit(body: ConnectSubmitBody): Promise<{ ok: true }>;
}

export function createConnectClient(fetchImpl: FetchLike = fetch): ConnectClient {
  return {
    async submit(body) {
      const payload: ConnectSubmitBody = { ...body, website: "" };
      const res = await fetchImpl(connectApi.submit, {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const parsed = await readBody(res);
      if (res.ok) {
        if (parsed.ok !== true) throw new ConnectSubmitError(res.status, "server_error", null, {});
        return { ok: true };
      }
      const code = codeFor(parsed, res.status);
      const seconds = code === "rate_limited" ? retryAfterSeconds(res.headers.get("retry-after")) : null;
      throw new ConnectSubmitError(res.status, code, seconds, code === "invalid_input" ? fieldErrorsOf(parsed) : {});
    },
  };
}

export const connectClient = createConnectClient();
