// Whether a reference's invite (or reminder) actually reached the referee,
// and the one staff alert a hard bounce should raise.
//
// Open and click tracking is off, so a sent or delivered message with no
// open and no click is fine. A hard bounce is the problem: the address
// needs checking. Repeat webhook deliveries of the same bounce collapse
// to one alert per reference.

export const REFERENCE_EMAIL_CATEGORIES = ["reference_request", "reference_reminder"] as const;

export const REFERENCE_BOUNCE_MESSAGE =
  "This email bounced. Please check the address and correct it.";

export const REFERENCE_NOT_SENT_MESSAGE =
  "We couldn't email this address. Please check it and try again.";

export type ReferenceEmailProblem = "bounced" | "not_sent" | null;

export type ReferenceDeliveryRef = {
  id: string;
  application_id?: string | null;
  referee_email: string;
  status: string;
  email_sent_at?: string | null;
};

export type ReferenceDeliveryMessage = {
  to_email?: string | null;
  category?: string | null;
  status?: string | null;
  bounce_type?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  created_at?: string | null;
  /** Provider diagnostic. Never copied into applicant or staff copy. */
  error?: string | null;
};

export type ReferenceForAlert = ReferenceDeliveryRef & {
  application_id: string;
  program_id: string;
  applicant_name: string;
  program_name: string;
};

export type ReferenceBounceAlert = {
  key: string;
  referenceId: string;
  programId: string;
  applicationId: string;
  title: string;
  body: string;
  href: string;
  at: string;
};

function normEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isReferenceCategory(category: string | null | undefined): boolean {
  return (
    category === "reference_request" || category === "reference_reminder"
  );
}

export function messagesForReference(
  ref: ReferenceDeliveryRef,
  applicationId: string | null | undefined,
  messages: ReferenceDeliveryMessage[]
): ReferenceDeliveryMessage[] {
  const email = normEmail(ref.referee_email);
  return messages
    .filter((m) => {
      if (!isReferenceCategory(m.category)) return false;
      if (normEmail(m.to_email) !== email) return false;
      const sid = m.source_id ?? null;
      if (sid && sid === ref.id) return true;
      if (applicationId && sid === applicationId) return true;
      if (ref.application_id && sid === ref.application_id) return true;
      return false;
    })
    .sort((a, b) => {
      const ta = a.created_at ? Date.parse(a.created_at) : 0;
      const tb = b.created_at ? Date.parse(b.created_at) : 0;
      return tb - ta;
    });
}

function isHardBounce(m: ReferenceDeliveryMessage): boolean {
  if (m.status !== "bounced") return false;
  return (m.bounce_type ?? "hard") !== "soft";
}

/**
 * What the applicant and the admin reference view should say.
 * The latest message to the current address wins, so a corrected address
 * that was then sent successfully clears an earlier bounce.
 */
export function referenceEmailProblem(
  ref: ReferenceDeliveryRef,
  applicationId: string | null | undefined,
  messages: ReferenceDeliveryMessage[]
): ReferenceEmailProblem {
  if (ref.status === "submitted") return null;
  const latest = messagesForReference(ref, applicationId, messages)[0];
  if (latest) {
    if (isHardBounce(latest)) return "bounced";
    if (latest.status === "failed" || latest.status === "dropped") return "not_sent";
    // sent, delivered, opened, queued, soft bounce, complaint — the address
    // is not something we are asking them to correct, and a missing click
    // is not a problem.
    return null;
  }
  if (!ref.email_sent_at) return "not_sent";
  return null;
}

export function referenceProblemCopy(problem: ReferenceEmailProblem): string | null {
  if (problem === "bounced") return REFERENCE_BOUNCE_MESSAGE;
  if (problem === "not_sent") return REFERENCE_NOT_SENT_MESSAGE;
  return null;
}

export type StaffAccess = {
  isAdmin: boolean;
  programIds: string[];
  applicationIds: string[];
};

export function staffCanSeeReferenceAlert(
  alert: Pick<ReferenceBounceAlert, "programId" | "applicationId">,
  access: StaffAccess
): boolean {
  if (access.isAdmin) return true;
  if (access.programIds.includes(alert.programId)) return true;
  if (access.applicationIds.includes(alert.applicationId)) return true;
  return false;
}

/**
 * One alert per reference whose latest invite or reminder hard-bounced.
 * Two webhook deliveries, or a bounced invite and a bounced reminder,
 * still produce a single alert. A later successful send produces none.
 * Bounce diagnostics are not included.
 */
export function buildReferenceBounceAlerts(
  refs: ReferenceForAlert[],
  messages: ReferenceDeliveryMessage[]
): ReferenceBounceAlert[] {
  const alerts: ReferenceBounceAlert[] = [];
  for (const ref of refs) {
    if (ref.status === "submitted") continue;
    const latest = messagesForReference(ref, ref.application_id, messages)[0];
    if (!latest || !isHardBounce(latest)) continue;
    const applicant = (ref.applicant_name ?? "").trim() || "An applicant";
    const program = (ref.program_name ?? "").trim() || "a program";
    const address = (ref.referee_email ?? "").trim();
    alerts.push({
      key: `reference-bounce:${ref.id}`,
      referenceId: ref.id,
      programId: ref.program_id,
      applicationId: ref.application_id,
      title: "Reference email bounced",
      body: address
        ? `${applicant} · ${program} — the email to ${address} bounced. Please check the address.`
        : `${applicant} · ${program} — a reference email bounced. Please check the address.`,
      href: `/schools/${ref.program_id}`,
      at: latest.created_at ?? new Date(0).toISOString(),
    });
  }
  return alerts;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

type LoadedRef = {
  id: string;
  application_id: string;
  referee_email: string;
  status: string;
  email_sent_at: string | null;
};

/**
 * Hard-bounced reference emails that still need a person to look at them.
 * Reads the ledger the webhook already updated, so a retried webhook does
 * not create another alert.
 */
export async function listReferenceBounceAlerts(admin: Client): Promise<ReferenceBounceAlert[]> {
  const { data, error } = await admin
    .from("email_messages")
    .select(
      "to_email, category, status, bounce_type, source_type, source_id, created_at, bounced_at, error"
    )
    .in("category", [...REFERENCE_EMAIL_CATEGORIES])
    .eq("status", "bounced")
    .eq("bounce_type", "hard")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data?.length) return [];

  const bounced = (data as ReferenceDeliveryMessage[]).filter(
    (m) =>
      isReferenceCategory(m.category) &&
      m.status === "bounced" &&
      (m.bounce_type ?? "hard") !== "soft" &&
      m.source_id
  );
  if (bounced.length === 0) return [];

  const directIds = [
    ...new Set(
      bounced
        .filter((m) => m.source_type === "reference_request" && m.source_id)
        .map((m) => m.source_id as string)
    ),
  ];
  const legacyAppIds = [
    ...new Set(
      bounced
        .filter((m) => m.source_type !== "reference_request" && m.source_id)
        .map((m) => m.source_id as string)
    ),
  ];

  const refs: LoadedRef[] = [];
  if (directIds.length > 0) {
    const { data: rows } = await admin
      .from("reference_requests")
      .select("id, application_id, referee_email, status, email_sent_at")
      .in("id", directIds);
    refs.push(...((rows ?? []) as LoadedRef[]));
  }
  if (legacyAppIds.length > 0) {
    const { data: rows } = await admin
      .from("reference_requests")
      .select("id, application_id, referee_email, status, email_sent_at")
      .in("application_id", legacyAppIds);
    for (const row of (rows ?? []) as LoadedRef[]) {
      if (!refs.some((r) => r.id === row.id)) refs.push(row);
    }
  }
  if (refs.length === 0) return [];

  const appIds = [...new Set(refs.map((r) => r.application_id).filter(Boolean))];
  const { data: apps } = await admin
    .from("application_responses")
    .select("id, program_id, applicant_info, programs(name)")
    .in("id", appIds);
  const appById = new Map<string, {
    program_id: string;
    applicant_name: string;
    program_name: string;
  }>();
  for (const app of (apps ?? []) as Array<{
    id: string;
    program_id: string;
    applicant_info: { first_name?: string; last_name?: string } | null;
    programs: { name?: string } | null;
  }>) {
    const fromInfo = [app.applicant_info?.first_name, app.applicant_info?.last_name]
      .filter(Boolean)
      .join(" ");
    appById.set(app.id, {
      program_id: app.program_id,
      applicant_name: fromInfo,
      program_name: app.programs?.name ?? "",
    });
  }

  const sourceIds = [
    ...new Set([
      ...refs.map((r) => r.id),
      ...refs.map((r) => r.application_id),
    ].filter(Boolean)),
  ];
  const { data: related } = await admin
    .from("email_messages")
    .select(
      "to_email, category, status, bounce_type, source_type, source_id, created_at, error"
    )
    .in("category", [...REFERENCE_EMAIL_CATEGORIES])
    .in("source_id", sourceIds);

  const forAlerts: ReferenceForAlert[] = [];
  for (const ref of refs) {
    const app = appById.get(ref.application_id);
    if (!app?.program_id) continue;
    forAlerts.push({
      ...ref,
      program_id: app.program_id,
      applicant_name: app.applicant_name,
      program_name: app.program_name,
    });
  }

  return buildReferenceBounceAlerts(forAlerts, (related ?? []) as ReferenceDeliveryMessage[]);
}

export async function annotateReferenceDelivery<T extends ReferenceDeliveryRef>(
  admin: Client,
  applicationId: string,
  refs: T[]
): Promise<Array<T & { email_problem: ReferenceEmailProblem }>> {
  if (!refs?.length) return [];
  const ids = [
    ...new Set(
      [applicationId, ...refs.map((r) => r.id)].filter((id): id is string => !!id)
    ),
  ];
  let messages: ReferenceDeliveryMessage[] = [];
  try {
    const { data, error } = await admin
      .from("email_messages")
      .select(
        "to_email, category, status, bounce_type, source_type, source_id, created_at"
      )
      .in("category", [...REFERENCE_EMAIL_CATEGORIES])
      .in("source_id", ids);
    if (!error && data) messages = data as ReferenceDeliveryMessage[];
  } catch {
    messages = [];
  }
  return refs.map((ref) => ({
    ...ref,
    email_problem: referenceEmailProblem(ref, applicationId, messages),
  }));
}
