// ────────────────────────────────────────────────────────────
// FFSA Hub — sending domains through Resend (migration 243)
// ────────────────────────────────────────────────────────────
// Resend decides whether a domain may send. The Hub adds domains there,
// reads back the DNS records it wants and their status, and mirrors that on
// sending_domains so the Hub can show it — and so "From" pickers only ever
// offer a domain Resend has verified.
// ────────────────────────────────────────────────────────────

import { getResend, isEmailConfigured } from "@/lib/email/resend";
import { FALLBACK_SENDING_DOMAINS, normalizeDomain } from "@/lib/email/sending-domain-rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type DomainRecord = {
  record: string;
  name: string;
  type: string;
  value: string;
  status: string;
  ttl?: string;
  priority?: number;
};

export type SendingDomainRow = {
  id: string;
  domain: string;
  resend_domain_id: string | null;
  resend_status: string | null;
  resend_records: DomainRecord[];
  resend_region: string | null;
  can_send: boolean;
  can_receive: boolean;
  resend_checked_at: string | null;
  dmarc_ok: boolean | null;
};

const COLS =
  "id, domain, resend_domain_id, resend_status, resend_records, resend_region, can_send, can_receive, resend_checked_at, dmarc_ok";

// Region for new domains: where ffsouthafrica.com already sends from.
const NEW_DOMAIN_REGION = "eu-west-1" as const;

type ResendDomain = {
  id: string;
  name: string;
  status: string;
  region?: string;
  capabilities?: { sending?: string; receiving?: string };
  records?: DomainRecord[];
};

function toRow(d: ResendDomain) {
  return {
    domain: d.name.toLowerCase(),
    resend_domain_id: d.id,
    resend_status: d.status,
    resend_region: d.region ?? null,
    can_send: d.capabilities?.sending === "enabled",
    can_receive: d.capabilities?.receiving === "enabled",
    ...(d.records ? { resend_records: d.records } : {}),
    resend_checked_at: new Date().toISOString(),
  };
}

async function upsert(admin: Client, d: ResendDomain) {
  const row = toRow(d);
  const { data, error } = await admin
    .from("sending_domains")
    .upsert(row, { onConflict: "domain" })
    .select(COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as SendingDomainRow;
}

/** Read every domain from Resend (with its records) and mirror it. */
export async function syncDomainsFromResend(admin: Client): Promise<{ rows: SendingDomainRow[]; error: string | null }> {
  let error: string | null = null;
  if (isEmailConfigured()) {
    try {
      const resend = getResend();
      const listed = await resend.domains.list();
      if (listed.error) throw new Error(listed.error.message);
      const domains = ((listed.data as unknown as { data?: ResendDomain[] })?.data ?? []) as ResendDomain[];
      for (const d of domains) {
        const full = await resend.domains.get(d.id);
        await upsert(admin, (full.data as unknown as ResendDomain) ?? d);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "Couldn't read Resend";
    }
  } else {
    error = "RESEND_API_KEY is not set";
  }
  const { data } = await admin.from("sending_domains").select(COLS).order("domain");
  return { rows: (data ?? []) as SendingDomainRow[], error };
}

/** Add a domain to Resend (or pick up the one already there) and mirror it. */
export async function addSendingDomain(admin: Client, input: string): Promise<SendingDomainRow> {
  const n = normalizeDomain(input);
  if ("error" in n) throw new Error(n.error);
  const resend = getResend();

  const listed = await resend.domains.list();
  const existing = ((listed.data as unknown as { data?: ResendDomain[] })?.data ?? []).find(
    (d) => d.name.toLowerCase() === n.domain
  );
  if (existing) {
    const full = await resend.domains.get(existing.id);
    return upsert(admin, (full.data as unknown as ResendDomain) ?? existing);
  }

  const created = await resend.domains.create({ name: n.domain, region: NEW_DOMAIN_REGION });
  if (created.error || !created.data) throw new Error(created.error?.message ?? "Resend didn't add the domain");
  return upsert(admin, created.data as unknown as ResendDomain);
}

/** Ask Resend to check the DNS now, then read back where it stands. */
export async function verifySendingDomain(admin: Client, id: string): Promise<SendingDomainRow> {
  const { data: row } = await admin.from("sending_domains").select(COLS).eq("id", id).maybeSingle();
  if (!row) throw new Error("Domain not found");
  if (!row.resend_domain_id) return addSendingDomain(admin, row.domain);
  const resend = getResend();
  const v = await resend.domains.verify(row.resend_domain_id);
  if (v.error) throw new Error(v.error.message);
  const full = await resend.domains.get(row.resend_domain_id);
  if (full.error || !full.data) throw new Error(full.error?.message ?? "Resend didn't return the domain");
  return upsert(admin, full.data as unknown as ResendDomain);
}

/**
 * Domains a "From" address may use: verified in Resend with sending on.
 * Before Resend has been read (or if it can't be), the two the Hub has
 * always used.
 */
export async function getVerifiedSendingDomains(admin: Client): Promise<string[]> {
  const { data } = await admin
    .from("sending_domains")
    .select("domain, resend_status, can_send, resend_checked_at");
  const rows = (data ?? []) as Array<{ domain: string; resend_status: string | null; can_send: boolean; resend_checked_at: string | null }>;
  if (!rows.some((r) => r.resend_checked_at)) return FALLBACK_SENDING_DOMAINS;
  const ok = rows.filter((r) => r.resend_status === "verified" && r.can_send).map((r) => r.domain);
  // Keep the long-standing order (ffsouthafrica.com first), then the rest A–Z.
  return [
    ...FALLBACK_SENDING_DOMAINS.filter((d) => ok.includes(d)),
    ...ok.filter((d) => !FALLBACK_SENDING_DOMAINS.includes(d)).sort(),
  ];
}
