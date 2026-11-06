// ────────────────────────────────────────────────────────────
// FFSA Hub — Xero Integration (Direct API, no SDK)
// Supports multi-region: "za" (South Africa) and "us" (USA)
// ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type XeroRegion = "za" | "us";

const XERO_API = "https://api.xero.com/api.xro/2.0";
const XERO_IDENTITY = "https://identity.xero.com/connect/token";

/**
 * The OAuth redirect, which must match a URI registered in the Xero Developer
 * Portal EXACTLY — and must be identical in the consent request and the token
 * exchange, or Xero rejects the exchange.
 *
 * Was hardcoded to localhost:3000, which meant Xero could only ever be
 * (re)connected from a local dev server on that port — never from production.
 * Now env-driven, defaulting to the old value so existing setups keep working:
 * set XERO_REDIRECT_URI and register the same string with Xero to connect from
 * anywhere else.
 */
export function xeroRedirectUri(): string {
  return (
    process.env.XERO_REDIRECT_URI ??
    "http://localhost:3000/api/integrations/xero/callback"
  );
}


// Which currency to use per region
const REGION_CURRENCY: Record<XeroRegion, string> = {
  za: "ZAR",
  us: "USD",
};

// Nationalities that route to the US Xero account
const US_NATIONALITIES = new Set([
  "american",
  "united states",
  "usa",
  "us",
  "united states of america",
]);

export function getXeroRegionForStudent(nationality: string | null): XeroRegion {
  if (!nationality) return "za";
  return US_NATIONALITIES.has(nationality.toLowerCase().trim()) ? "us" : "za";
}

// ────────────────────────────────────────────────────────────
// TOKEN MANAGEMENT (Supabase)
// ────────────────────────────────────────────────────────────

export async function getStoredTokens(
  supabase: Client,
  region: XeroRegion = "za"
) {
  const { data, error } = await (supabase as Client)
    .from("xero_tokens")
    .select("*")
    .eq("region", region)
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return data as {
    id: string;
    tenant_id: string;
    tenant_name: string | null;
    access_token: string;
    refresh_token: string;
    expires_at: string;
    token_set: Record<string, unknown> | null;
    connected_by: string | null;
    region: XeroRegion;
  };
}

export async function saveTokens(
  supabase: Client,
  data: {
    tenant_id: string;
    tenant_name?: string;
    access_token: string;
    refresh_token: string;
    expires_at: string;
    token_set?: Record<string, unknown>;
    connected_by?: string;
    region?: XeroRegion;
  }
) {
  const region = data.region ?? "za";

  // Delete existing tokens for this region only, then insert new one
  await (supabase as Client)
    .from("xero_tokens")
    .delete()
    .eq("region", region);

  const { error } = await (supabase as Client)
    .from("xero_tokens")
    .insert({
      tenant_id: data.tenant_id,
      tenant_name: data.tenant_name,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      token_set: data.token_set,
      connected_by: data.connected_by,
      region,
    });

  return { error };
}

export async function deleteTokens(
  supabase: Client,
  region: XeroRegion = "za"
) {
  const { error } = await (supabase as Client)
    .from("xero_tokens")
    .delete()
    .eq("region", region);
  return { error };
}

// ────────────────────────────────────────────────────────────
// GET VALID ACCESS TOKEN (with auto-refresh)
// ────────────────────────────────────────────────────────────

async function getValidAccessToken(
  supabase: Client,
  region: XeroRegion = "za"
): Promise<{ accessToken: string; tenantId: string } | null> {
  const tokens = await getStoredTokens(supabase, region);
  if (!tokens) return null;

  const expiresAt = new Date(tokens.expires_at);
  const now = new Date();

  // If token is still valid (with 60s buffer), use it
  if (now < new Date(expiresAt.getTime() - 60000)) {
    return { accessToken: tokens.access_token, tenantId: tokens.tenant_id };
  }

  // Token expired — refresh it
  try {
    console.log(`Refreshing Xero token (${region})...`);
    const clientId = process.env.XERO_CLIENT_ID!;
    const clientSecret = process.env.XERO_CLIENT_SECRET!;

    const res = await fetch(XERO_IDENTITY, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Xero token refresh failed:", res.status, errText);
      return null;
    }

    const newTokens = await res.json();
    const newExpiresAt = new Date(
      Date.now() + (newTokens.expires_in ?? 1800) * 1000
    ).toISOString();

    await saveTokens(supabase, {
      tenant_id: tokens.tenant_id,
      tenant_name: tokens.tenant_name ?? undefined,
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token,
      expires_at: newExpiresAt,
      token_set: newTokens,
      connected_by: tokens.connected_by ?? undefined,
      region,
    });

    console.log(`Xero token refreshed successfully (${region})`);
    return { accessToken: newTokens.access_token, tenantId: tokens.tenant_id };
  } catch (err) {
    console.error("Failed to refresh Xero token:", err);
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// XERO API HELPERS
// ────────────────────────────────────────────────────────────

async function xeroGet(
  accessToken: string,
  tenantId: string,
  endpoint: string,
  options: { timeoutMs?: number } = {}
) {
  const res = await fetch(`${XERO_API}/${endpoint}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "xero-tenant-id": tenantId,
      Accept: "application/json",
    },
    signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero GET ${endpoint} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function xeroPost(
  accessToken: string,
  tenantId: string,
  endpoint: string,
  body: unknown
) {
  const res = await fetch(`${XERO_API}/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "xero-tenant-id": tenantId,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero POST ${endpoint} failed (${res.status}): ${text}`);
  }
  // Some endpoints (e.g. Email) return empty body
  const text = await res.text();
  if (!text) return {};
  return JSON.parse(text);
}

// ────────────────────────────────────────────────────────────
// TRACKING CATEGORIES (read-only)
// ────────────────────────────────────────────────────────────

/**
 * Active option names in one of the organisation's tracking categories,
 * e.g. "Schools". Names, not ids: the SA and US organisations hold the same
 * option under different ids, so the Hub stores and matches by name.
 * Returns null when the organisation isn't connected or Xero can't be read.
 */
export async function getXeroTrackingOptions(
  supabase: Client,
  region: XeroRegion,
  categoryName: string
): Promise<{ category: string; options: string[] } | null> {
  const auth = await getValidAccessToken(supabase, region);
  if (!auth) return null;
  try {
    const res = await xeroGet(auth.accessToken, auth.tenantId, "TrackingCategories");
    const cat = (res.TrackingCategories ?? []).find(
      (c: { Name: string; Status: string }) =>
        c.Status === "ACTIVE" && c.Name.trim().toLowerCase() === categoryName.trim().toLowerCase()
    );
    if (!cat) return { category: categoryName, options: [] };
    return {
      category: cat.Name,
      options: (cat.Options ?? [])
        .filter((o: { Status: string }) => o.Status === "ACTIVE")
        .map((o: { Name: string }) => o.Name),
    };
  } catch (err) {
    console.error(`Xero (${region}): could not read tracking categories`, err);
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// CODE MIRROR SOURCE (read-only)
// ────────────────────────────────────────────────────────────

const XERO_MIRROR_TIMEOUT_MS = 20_000;

export type XeroMirrorSource =
  | {
      ok: true;
      tenantId: string;
      // Raw Xero objects, every type and status Xero returns.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      accounts: any[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trackingCategories: any[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: any[];
    }
  | { ok: false; reason: "not_connected" | "token" | "xero"; message: string; tenantId?: string };

/**
 * Everything the code mirror (migration 275) copies from one organisation:
 * the full chart of accounts, every tracking category with its options
 * (archived ones included), and every item. Three GETs, nothing written to
 * Xero. Never throws: a region that can't be read says why, so the caller
 * can record it and carry on with the other region.
 */
export async function fetchXeroMirrorSource(
  supabase: Client,
  region: XeroRegion
): Promise<XeroMirrorSource> {
  const tokens = await getStoredTokens(supabase, region);
  if (!tokens) {
    return { ok: false, reason: "not_connected", message: "This organisation is not connected to Xero." };
  }
  const auth = await getValidAccessToken(supabase, region);
  if (!auth) {
    return {
      ok: false,
      reason: "token",
      tenantId: tokens.tenant_id,
      message: "Xero would not renew the saved authorisation. Reconnect this organisation.",
    };
  }
  try {
    const opts = { timeoutMs: XERO_MIRROR_TIMEOUT_MS };
    // One at a time: three calls is nowhere near Xero's per-minute limit,
    // and it keeps us well under its 5-concurrent-calls cap too.
    const accounts = await xeroGet(auth.accessToken, auth.tenantId, "Accounts", opts);
    const tracking = await xeroGet(
      auth.accessToken,
      auth.tenantId,
      "TrackingCategories?includeArchived=true",
      opts
    );
    const items = await xeroGet(auth.accessToken, auth.tenantId, "Items", opts);
    return {
      ok: true,
      tenantId: auth.tenantId,
      accounts: accounts.Accounts ?? [],
      trackingCategories: tracking.TrackingCategories ?? [],
      items: items.Items ?? [],
    };
  } catch (err) {
    return {
      ok: false,
      reason: "xero",
      tenantId: auth.tenantId,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

// ────────────────────────────────────────────────────────────
// PAYMENT STATE OF SPECIFIC INVOICES (read-only)
// ────────────────────────────────────────────────────────────

/** Xero's "/Date(1735689600000+0000)/" → "2025-01-01". */
function xeroDateToYmd(v: unknown): string | null {
  const m = typeof v === "string" ? v.match(/\/Date\((\d+)/) : null;
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : null;
}

export interface XeroInvoicePaymentState {
  invoiceId: string;
  invoiceNumber: string | null;
  status: string;
  amountPaid: number;
  amountDue: number;
  fullyPaidOn: string | null;
}

/**
 * Payment state for specific invoices in one organisation, by Xero id.
 * Batched (Xero accepts a comma-separated IDs filter); an id Xero doesn't
 * return is simply absent from the result.
 */
export async function getXeroInvoicePaymentStates(
  supabase: Client,
  region: XeroRegion,
  invoiceIds: string[]
): Promise<{ data: Map<string, XeroInvoicePaymentState>; error: string | null }> {
  const out = new Map<string, XeroInvoicePaymentState>();
  if (invoiceIds.length === 0) return { data: out, error: null };
  const auth = await getValidAccessToken(supabase, region);
  if (!auth) return { data: out, error: `Xero ${region.toUpperCase()} not connected or token expired` };

  try {
    for (let i = 0; i < invoiceIds.length; i += 40) {
      const ids = invoiceIds.slice(i, i + 40).join(",");
      const json = (await xeroGet(
        auth.accessToken,
        auth.tenantId,
        `Invoices?IDs=${encodeURIComponent(ids)}`
      )) as { Invoices?: Record<string, unknown>[] };
      for (const inv of json.Invoices ?? []) {
        const id = inv.InvoiceID as string;
        out.set(id, {
          invoiceId: id,
          invoiceNumber: (inv.InvoiceNumber as string) ?? null,
          status: (inv.Status as string) ?? "",
          amountPaid: Number(inv.AmountPaid ?? 0),
          amountDue: Number(inv.AmountDue ?? 0),
          fullyPaidOn: xeroDateToYmd(inv.FullyPaidOnDate),
        });
      }
    }
    return { data: out, error: null };
  } catch (err) {
    return { data: out, error: err instanceof Error ? err.message : "Xero read failed" };
  }
}

/** Which of our regions a Xero tenant (organisation) id belongs to. */
export async function regionForXeroTenant(
  supabase: Client,
  tenantId: string
): Promise<XeroRegion | null> {
  const { data } = await supabase.from("xero_tokens").select("region").eq("tenant_id", tenantId);
  const region = (data ?? [])[0]?.region;
  return region === "za" || region === "us" ? region : null;
}

// ────────────────────────────────────────────────────────────
// HUB-SENT INVOICE EMAILS: themes, online link, PDF, mark sent
// ────────────────────────────────────────────────────────────

/** Branding themes in one organisation (name → id), for the school picker. */
export async function getXeroBrandingThemes(
  supabase: Client,
  region: XeroRegion
): Promise<Array<{ id: string; name: string }> | null> {
  const auth = await getValidAccessToken(supabase, region);
  if (!auth) return null;
  try {
    const res = await xeroGet(auth.accessToken, auth.tenantId, "BrandingThemes");
    return (res.BrandingThemes ?? []).map((t: { BrandingThemeID: string; Name: string }) => ({
      id: t.BrandingThemeID,
      name: t.Name,
    }));
  } catch (err) {
    console.error(`Xero (${region}): could not read branding themes`, err);
    return null;
  }
}

/** The organisation's name as Xero prints it for [Trading Name]. */
export async function getXeroTradingName(supabase: Client, region: XeroRegion): Promise<string | null> {
  const auth = await getValidAccessToken(supabase, region);
  if (!auth) return null;
  try {
    const res = await xeroGet(auth.accessToken, auth.tenantId, "Organisation");
    const org = res.Organisations?.[0];
    return (org?.Name as string) ?? (org?.LegalName as string) ?? null;
  } catch {
    return null;
  }
}

/**
 * Everything the Hub needs to email one approved invoice: its online link
 * (Stripe "Pay now" lives there for the US org), its PDF and its numbers.
 */
export async function getXeroInvoiceForEmail(
  supabase: Client,
  region: XeroRegion,
  invoiceId: string
): Promise<
  | {
      ok: true;
      onlineUrl: string | null;
      pdfBase64: string;
      invoiceNumber: string;
      total: number;
      amountDue: number;
      currencyCode: string;
      dueDate: string;
      contactName: string;
    }
  | { ok: false; error: string }
> {
  const auth = await getValidAccessToken(supabase, region);
  if (!auth) return { ok: false, error: `Xero ${region.toUpperCase()} not connected or token expired` };
  const { accessToken, tenantId } = auth;
  try {
    const inv = (await xeroGet(accessToken, tenantId, `Invoices/${invoiceId}`)).Invoices?.[0];
    if (!inv) return { ok: false, error: "Invoice not found in Xero" };

    let onlineUrl: string | null = null;
    try {
      const online = await xeroGet(accessToken, tenantId, `Invoices/${invoiceId}/OnlineInvoice`);
      onlineUrl = online.OnlineInvoices?.[0]?.OnlineInvoiceUrl ?? null;
    } catch {
      // Drafts have no online invoice; the caller decides what that means.
    }

    const pdfRes = await fetch(`${XERO_API}/Invoices/${invoiceId}`, {
      headers: { Authorization: `Bearer ${accessToken}`, "xero-tenant-id": tenantId, Accept: "application/pdf" },
    });
    if (!pdfRes.ok) return { ok: false, error: `Xero PDF failed (${pdfRes.status})` };
    const pdfBase64 = Buffer.from(await pdfRes.arrayBuffer()).toString("base64");

    return {
      ok: true,
      onlineUrl,
      pdfBase64,
      invoiceNumber: inv.InvoiceNumber,
      total: Number(inv.Total ?? 0),
      amountDue: Number(inv.AmountDue ?? 0),
      currencyCode: inv.CurrencyCode ?? "ZAR",
      dueDate: (inv.DueDateString as string)?.slice(0, 10) ?? "",
      contactName: inv.Contact?.Name ?? "",
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Xero read failed" };
  }
}

/** Tell Xero the invoice was sent (the Hub emailed it), as Xero's own send would. */
export async function markXeroInvoiceSent(
  supabase: Client,
  region: XeroRegion,
  invoiceId: string
): Promise<boolean> {
  const auth = await getValidAccessToken(supabase, region);
  if (!auth) return false;
  try {
    await xeroPost(auth.accessToken, auth.tenantId, "Invoices", {
      Invoices: [{ InvoiceID: invoiceId, SentToContact: true }],
    });
    return true;
  } catch (err) {
    console.error(`Xero (${region}): could not mark ${invoiceId} sent`, err);
    return false;
  }
}

// ────────────────────────────────────────────────────────────
// INVOICE CREATION
// ────────────────────────────────────────────────────────────

export async function createAndSendInvoice(
  supabase: Client,
  params: {
    studentFeeId: string;
    studentEmail: string;
    studentName: string;
    programName: string;
    tier: string;
    tuition: number;
    accommodation: number;
    meals: number;
    materials: number;
    totalDue: number;
    discount: number;
    scholarship: number;
    finalAmount: number;
    region?: XeroRegion;
  }
): Promise<{
  success: boolean;
  invoiceId?: string;
  invoiceNumber?: string;
  error?: string;
  region?: XeroRegion;
}> {
  const region = params.region ?? "za";
  const auth = await getValidAccessToken(supabase, region);
  if (!auth) {
    console.error(`Xero (${region}): No valid access token`);
    return {
      success: false,
      error: `Xero ${region.toUpperCase()} account not connected or token expired`,
      region,
    };
  }

  const { accessToken, tenantId } = auth;
  const currencyCode = REGION_CURRENCY[region];

  try {
    // 1. Find or create the contact (student) in Xero
    console.log(`Xero (${region}): Looking up contact:`, params.studentEmail);
    let contactId: string;

    try {
      const contactsRes = await xeroGet(
        accessToken,
        tenantId,
        `Contacts?where=EmailAddress%3D%3D%22${encodeURIComponent(params.studentEmail)}%22`
      );

      if (contactsRes.Contacts && contactsRes.Contacts.length > 0) {
        contactId = contactsRes.Contacts[0].ContactID;
        console.log(`Xero (${region}): Found existing contact:`, contactId);
      } else {
        // Create new contact
        console.log(`Xero (${region}): Creating new contact for:`, params.studentName);
        const nameParts = params.studentName.split(" ");
        const newContactRes = await xeroPost(accessToken, tenantId, "Contacts", {
          Contacts: [
            {
              Name: params.studentName,
              EmailAddress: params.studentEmail,
              FirstName: nameParts[0],
              LastName: nameParts.slice(1).join(" ") || undefined,
            },
          ],
        });
        contactId = newContactRes.Contacts[0].ContactID;
        console.log(`Xero (${region}): Created contact:`, contactId);
      }
    } catch (contactErr) {
      console.error(`Xero (${region}) contact error:`, contactErr);
      return {
        success: false,
        error: `Contact error: ${contactErr instanceof Error ? contactErr.message : "Unknown"}`,
        region,
      };
    }

    // 2. Look up a valid revenue account code (needs accounting.settings.read scope)
    let accountCode: string | null = null;
    try {
      const accountsRes = await xeroGet(
        accessToken,
        tenantId,
        'Accounts?where=Type%3D%3D%22REVENUE%22%20AND%20Status%3D%3D%22ACTIVE%22'
      );
      if (accountsRes.Accounts && accountsRes.Accounts.length > 0) {
        accountCode = accountsRes.Accounts[0].Code;
        console.log(`Xero (${region}): Using revenue account code:`, accountCode);
      }
    } catch (accErr) {
      console.warn(`Xero (${region}): Could not fetch accounts (need to reconnect for accounting.settings.read scope)`);
    }

    // 3. Build line items from fee breakdown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lineItems: any[] = [];

    const addLine = (description: string, amount: number) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const item: any = { Description: description, Quantity: 1, UnitAmount: amount };
      if (accountCode) item.AccountCode = accountCode;
      lineItems.push(item);
    };

    if (params.tuition > 0) {
      addLine(`${params.programName} — Tuition (Tier ${params.tier})`, params.tuition);
    }
    if (params.accommodation > 0) {
      addLine(`${params.programName} — Accommodation (Tier ${params.tier})`, params.accommodation);
    }
    if (params.meals > 0) {
      addLine(`${params.programName} — Meals (Tier ${params.tier})`, params.meals);
    }
    if (params.materials > 0) {
      addLine(`${params.programName} — Materials (Tier ${params.tier})`, params.materials);
    }
    if (params.discount > 0) {
      addLine("Discount", -params.discount);
    }
    if (params.scholarship > 0) {
      addLine("Scholarship", -params.scholarship);
    }

    // 4. Create the invoice
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    // If we have a valid account code, create directly as AUTHORISED
    // Otherwise create as DRAFT (can't be emailed until approved in Xero)
    const canAuthorise = !!accountCode;
    const initialStatus = canAuthorise ? "AUTHORISED" : "DRAFT";

    console.log(`Xero (${region}): Creating invoice with`, lineItems.length, `line items, status: ${initialStatus}, currency: ${currencyCode}`);

    const invoiceRes = await xeroPost(accessToken, tenantId, "Invoices", {
      Invoices: [
        {
          Type: "ACCREC",
          Contact: { ContactID: contactId },
          LineItems: lineItems,
          Date: new Date().toISOString().split("T")[0],
          DueDate: dueDate.toISOString().split("T")[0],
          Reference: `FFSA-${params.studentFeeId.slice(0, 8)}`,
          CurrencyCode: currencyCode,
          Status: initialStatus,
          LineAmountTypes: "NoTax",
        },
      ],
    });

    const invoice = invoiceRes.Invoices?.[0];
    if (!invoice?.InvoiceID) {
      console.error(`Xero (${region}): Invoice creation returned no data:`, invoiceRes);
      return { success: false, error: "Invoice creation returned no data", region };
    }

    console.log(`Xero (${region}): Invoice created as ${initialStatus}:`, invoice.InvoiceID, invoice.InvoiceNumber);

    // 5. Send the invoice email (only works for AUTHORISED invoices)
    if (canAuthorise) {
      try {
        console.log(`Xero (${region}): Sending invoice email to:`, params.studentEmail);
        await xeroPost(
          accessToken,
          tenantId,
          `Invoices/${invoice.InvoiceID}/Email`,
          {}
        );
        console.log(`Xero (${region}): Invoice email sent successfully`);
      } catch (emailErr) {
        console.error(`Xero (${region}): Failed to send invoice email:`, emailErr);
      }
    } else {
      console.log(`Xero (${region}): Invoice created as DRAFT — reconnect Xero with settings scope to enable auto-email`);
    }

    // 6. Store Xero invoice reference on the student fee
    await (supabase as Client)
      .from("student_fees")
      .update({
        xero_invoice_id: invoice.InvoiceID,
        xero_invoice_number: invoice.InvoiceNumber,
      })
      .eq("id", params.studentFeeId);

    return {
      success: true,
      invoiceId: invoice.InvoiceID,
      invoiceNumber: invoice.InvoiceNumber ?? undefined,
      region,
    };
  } catch (err) {
    console.error(`Xero (${region}) invoice creation failed:`, err);
    const message =
      err instanceof Error ? err.message : "Unknown Xero error";
    return { success: false, error: message, region };
  }
}

// ────────────────────────────────────────────────────────────
// SCHEDULED INVOICE (from billing schedule rows, using item codes)
// ────────────────────────────────────────────────────────────

export async function createScheduledInvoice(
  supabase: Client,
  params: {
    region: XeroRegion;
    studentEmail: string;
    studentName: string;
    dueDate: string; // YYYY-MM-DD
    reference: string;
    lineItems: Array<{
      itemCode: string | null;
      description: string;
      amount: number;
      /** Already resolved against this organisation's tracking categories —
       * Xero rejects the whole invoice for an option it doesn't have. */
      tracking?: { category: string; option: string } | null;
    }>;
    /** Approve (AUTHORISED) rather than leave as a draft. */
    autoSend: boolean;
    /**
     * Have XERO email it once approved. Defaults to autoSend (the original
     * behaviour). School fees pass false: the Hub sends the email itself from
     * the school's own template, which Xero's API can't select.
     */
    xeroEmail?: boolean;
    /** Xero branding theme id in THIS organisation (bank details etc.). */
    brandingThemeId?: string | null;
    /** Defaults to ZAR (school fees are always ZAR). Event tickets pass the event currency. */
    currencyCode?: string;
    /** Per-line quantity; defaults to 1 (amount is then the line total). */
    lineQuantities?: number[];
  }
): Promise<{
  success: boolean;
  invoiceId?: string;
  invoiceNumber?: string;
  status?: string;
  emailed?: boolean;
  error?: string;
}> {
  const region = params.region;
  const auth = await getValidAccessToken(supabase, region);
  if (!auth) {
    return {
      success: false,
      error: `Xero ${region.toUpperCase()} not connected or token expired`,
    };
  }
  const { accessToken, tenantId } = auth;
  // School fees bill in ZAR regardless of which Xero org (US vs SA) the
  // invoice posts to. The org/item code still drives the ledger account + tax.
  const currencyCode = params.currencyCode ?? "ZAR";

  try {
    // 1. Find or create the contact
    let contactId: string;
    const contactsRes = await xeroGet(
      accessToken,
      tenantId,
      `Contacts?where=EmailAddress%3D%3D%22${encodeURIComponent(params.studentEmail)}%22`
    );
    if (contactsRes.Contacts && contactsRes.Contacts.length > 0) {
      contactId = contactsRes.Contacts[0].ContactID;
    } else {
      const nameParts = params.studentName.split(" ");
      const newContactRes = await xeroPost(accessToken, tenantId, "Contacts", {
        Contacts: [
          {
            Name: params.studentName,
            EmailAddress: params.studentEmail,
            FirstName: nameParts[0],
            LastName: nameParts.slice(1).join(" ") || undefined,
          },
        ],
      });
      contactId = newContactRes.Contacts[0].ContactID;
    }

    // 2. Fallback revenue account — ONLY used for lines that have no item code.
    // Lines WITH an item code let Xero resolve the ledger account + tax from
    // the item (US → 1020/Tax Exempt, SA → 1030/No VAT), matching the org's
    // accounting structure.
    let fallbackAccount: string | null = null;
    const needFallback = params.lineItems.some((li) => !li.itemCode);
    if (needFallback) {
      try {
        const accountsRes = await xeroGet(
          accessToken,
          tenantId,
          'Accounts?where=Type%3D%3D%22REVENUE%22%20AND%20Status%3D%3D%22ACTIVE%22'
        );
        if (accountsRes.Accounts && accountsRes.Accounts.length > 0) {
          fallbackAccount = accountsRes.Accounts[0].Code;
        }
      } catch {
        // no settings scope — code-less lines can't authorise
      }
    }

    // 3. Line items — item code drives account + tax; fallback only otherwise.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lineItems = params.lineItems.map((li, idx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const item: any = {
        Description: li.description,
        Quantity: params.lineQuantities?.[idx] ?? 1,
        UnitAmount: li.amount,
      };
      if (li.itemCode) {
        item.ItemCode = li.itemCode;
      } else if (fallbackAccount) {
        item.AccountCode = fallbackAccount;
      }
      if (li.tracking) {
        item.Tracking = [{ Name: li.tracking.category, Option: li.tracking.option }];
      }
      return item;
    });

    // Every line resolves an account (via item code or fallback) → can authorise.
    const allResolvable = params.lineItems.every(
      (li) => li.itemCode || fallbackAccount
    );
    const initialStatus = params.autoSend && allResolvable ? "AUTHORISED" : "DRAFT";

    const invoiceRes = await xeroPost(accessToken, tenantId, "Invoices", {
      Invoices: [
        {
          Type: "ACCREC",
          Contact: { ContactID: contactId },
          LineItems: lineItems,
          Date: new Date().toISOString().split("T")[0],
          DueDate: params.dueDate,
          Reference: params.reference,
          CurrencyCode: currencyCode,
          Status: initialStatus,
          LineAmountTypes: "NoTax",
          ...(params.brandingThemeId ? { BrandingThemeID: params.brandingThemeId } : {}),
        },
      ],
    });

    const invoice = invoiceRes.Invoices?.[0];
    if (!invoice?.InvoiceID) {
      return { success: false, error: "Invoice creation returned no data" };
    }

    let emailed = false;
    if ((params.xeroEmail ?? params.autoSend) && initialStatus === "AUTHORISED") {
      try {
        await xeroPost(
          accessToken,
          tenantId,
          `Invoices/${invoice.InvoiceID}/Email`,
          {}
        );
        emailed = true;
      } catch (emailErr) {
        console.error(`Xero (${region}): email failed`, emailErr);
      }
    }

    return {
      success: true,
      invoiceId: invoice.InvoiceID,
      invoiceNumber: invoice.InvoiceNumber ?? undefined,
      status: initialStatus,
      emailed,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown Xero error",
    };
  }
}

// ────────────────────────────────────────────────────────────
// VOID AN EXISTING INVOICE
// ────────────────────────────────────────────────────────────

export async function voidInvoice(
  supabase: Client,
  invoiceId: string,
  region: XeroRegion = "za"
): Promise<{ success: boolean; error?: string }> {
  const auth = await getValidAccessToken(supabase, region);
  if (!auth) {
    return { success: false, error: `Xero ${region.toUpperCase()} not connected or token expired` };
  }

  const { accessToken, tenantId } = auth;

  try {
    // First check the invoice status — can only void DRAFT or AUTHORISED
    console.log(`Xero (${region}): Checking invoice status before voiding:`, invoiceId);
    const existing = await xeroGet(
      accessToken,
      tenantId,
      `Invoices/${invoiceId}`
    );
    const currentStatus = existing?.Invoices?.[0]?.Status;
    console.log(`Xero (${region}): Current invoice status:`, currentStatus);

    if (currentStatus === "VOIDED" || currentStatus === "DELETED") {
      console.log(`Xero (${region}): Invoice already voided/deleted, skipping`);
      return { success: true };
    }

    if (currentStatus === "DRAFT") {
      await xeroPost(accessToken, tenantId, "Invoices", {
        Invoices: [
          {
            InvoiceID: invoiceId,
            Status: "DELETED",
          },
        ],
      });
      console.log(`Xero (${region}): Draft invoice deleted:`, invoiceId);
      return { success: true };
    }

    // AUTHORISED invoices can be voided
    await xeroPost(accessToken, tenantId, "Invoices", {
      Invoices: [
        {
          InvoiceID: invoiceId,
          Status: "VOIDED",
        },
      ],
    });
    console.log(`Xero (${region}): Invoice voided successfully:`, invoiceId);
    return { success: true };
  } catch (err) {
    console.error(`Xero (${region}): Failed to void invoice:`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: message };
  }
}

// ────────────────────────────────────────────────────────────
// CONNECTION STATUS
// ────────────────────────────────────────────────────────────

/**
 * Is a region's connection actually usable?
 *
 * A token ROW existing is not a connection. Xero refresh tokens die after 60
 * days unused, and the old status check reported `connected: true` on the
 * strength of a row alone — so a connection that had been dead for four months
 * showed a green pill and hid the only button that could fix it.
 *
 * This verifies: obtain a valid access token (refreshing if needed), then make
 * one cheap real call. Anything less is a guess.
 */
const XERO_STATUS_TIMEOUT_MS = 8_000;

async function probeRegion(supabase: Client, region: XeroRegion) {
  const tokens = await getStoredTokens(supabase, region);
  if (!tokens) {
    return { connected: false as const, live: false as const, region };
  }

  const base = {
    tenantName: tokens.tenant_name,
    expiresAt: tokens.expires_at,
    region,
  };

  const auth = await getValidAccessToken(supabase, region);
  if (!auth) {
    return {
      ...base,
      connected: true as const,
      live: false as const,
      problem:
        "Authorisation expired — Xero would not renew it. Reconnect this organisation.",
    };
  }

  try {
    // Smallest call that proves the token is accepted for this tenant. It is a
    // read with nothing to lose, so it gets a deadline: a slow Xero should
    // show as "could not be reached", not hang the Finance page's status card.
    await xeroGet(auth.accessToken, auth.tenantId, "Organisation", {
      timeoutMs: XERO_STATUS_TIMEOUT_MS,
    });
    return { ...base, connected: true as const, live: true as const };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      connected: true as const,
      live: false as const,
      problem:
        msg.includes("401") || msg.includes("403")
          ? "Xero refused the saved authorisation. Reconnect this organisation."
          : `Xero could not be reached: ${msg}`,
    };
  }
}

export async function getXeroConnectionStatus(
  supabase: Client,
  region?: XeroRegion
) {
  if (region) return probeRegion(supabase, region);

  const [za, us] = await Promise.all([
    probeRegion(supabase, "za"),
    probeRegion(supabase, "us"),
  ]);
  return { za, us };
}

// ────────────────────────────────────────────────────────────
// READ SIDE — what Xero already knows
// ────────────────────────────────────────────────────────────
// The integration was write-only: it could create and void invoices but never
// look. Reconciliation (handoff §9) needs the opposite direction — Xero is the
// source of truth for PAYMENTS, the Hub for schedules — and so does anyone
// asking the plain question "what has actually been invoiced and paid".
//
// Read-only by construction: GETs only, no mutation, nothing written back.

export type XeroInvoiceSummary = {
  invoiceNumber: string | null;
  reference: string | null;
  contactName: string | null;
  status: string | null;      // DRAFT | SUBMITTED | AUTHORISED | PAID | VOIDED
  date: string | null;
  dueDate: string | null;
  total: number;
  amountPaid: number;
  amountDue: number;
  currency: string | null;
  sentToContact: boolean | null;
};

export type XeroInvoiceReport = {
  region: XeroRegion;
  tenantName: string | null;
  invoices: XeroInvoiceSummary[];
  totals: { count: number; billed: number; paid: number; outstanding: number };
};

/**
 * Invoices from one Xero org, newest first.
 *
 * Returns `{ error }` rather than throwing: the usual failure here is an
 * expired refresh token (Xero's last 60 days), which is a "reconnect Xero"
 * message for a person, not a stack trace.
 */
export async function listXeroInvoices(
  supabase: Client,
  region: XeroRegion = "za",
  opts: { since?: string; contains?: string } = {}
): Promise<{ data: XeroInvoiceReport | null; error: string | null }> {
  const auth = await getValidAccessToken(supabase, region);
  if (!auth) {
    return {
      data: null,
      error:
        "Xero is not connected for this organisation, or its authorisation has lapsed. Reconnect it in Finance → Xero.",
    };
  }

  const tokens = await getStoredTokens(supabase, region);

  // ACCPAY = bills we owe; we only care about ACCREC (what students owe us).
  const params = new URLSearchParams({ where: 'Type=="ACCREC"', order: "Date DESC" });
  if (opts.since) params.set("If-Modified-Since", opts.since);

  try {
    const json = (await xeroGet(
      auth.accessToken,
      auth.tenantId,
      `Invoices?${params.toString()}`
    )) as { Invoices?: Record<string, unknown>[] };

    const raw = json.Invoices ?? [];
    const invoices: XeroInvoiceSummary[] = raw
      .map((i) => ({
        invoiceNumber: (i.InvoiceNumber as string) ?? null,
        reference: (i.Reference as string) ?? null,
        contactName:
          ((i.Contact as { Name?: string } | undefined)?.Name as string) ?? null,
        status: (i.Status as string) ?? null,
        date: (i.DateString as string)?.slice(0, 10) ?? null,
        dueDate: (i.DueDateString as string)?.slice(0, 10) ?? null,
        total: Number(i.Total ?? 0),
        amountPaid: Number(i.AmountPaid ?? 0),
        amountDue: Number(i.AmountDue ?? 0),
        currency: (i.CurrencyCode as string) ?? null,
        sentToContact: (i.SentToContact as boolean) ?? null,
      }))
      // Voided invoices are noise in a "what is owed" answer.
      .filter((i) => i.status !== "VOIDED" && i.status !== "DELETED")
      .filter((i) =>
        opts.contains
          ? `${i.contactName ?? ""} ${i.reference ?? ""} ${i.invoiceNumber ?? ""}`
              .toLowerCase()
              .includes(opts.contains.toLowerCase())
          : true
      );

    return {
      data: {
        region,
        tenantName: tokens?.tenant_name ?? null,
        invoices,
        totals: {
          count: invoices.length,
          billed: invoices.reduce((s, i) => s + i.total, 0),
          paid: invoices.reduce((s, i) => s + i.amountPaid, 0),
          outstanding: invoices.reduce((s, i) => s + i.amountDue, 0),
        },
      },
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 401 here almost always means the refresh token itself is dead.
    if (msg.includes("401") || msg.includes("403")) {
      return {
        data: null,
        error:
          "Xero refused the request — the saved authorisation has expired. Reconnect Xero in Finance → Xero.",
      };
    }
    return { data: null, error: msg };
  }
}

// ────────────────────────────────────────────────────────────
// WHICH ORGANISATION IS WHICH
// ────────────────────────────────────────────────────────────
// Xero's consent screen will not let a person assign one organisation per
// region: once both are connected it greys them out and offers only "Continue
// with N organisations". The stored token is therefore authorised for ALL of
// them, and which region uses which tenant is the Hub's decision.

export type XeroOrganisation = {
  tenantId: string;
  tenantName: string | null;
  /** Regions currently pointing at this organisation. */
  boundTo: XeroRegion[];
};

/** Every organisation the stored authorisation covers. */
export async function listXeroOrganisations(
  supabase: Client
): Promise<{ data: { organisations: XeroOrganisation[] } | null; error: string | null }> {
  // Either region's token works — both are authorised for the same set.
  const auth =
    (await getValidAccessToken(supabase, "za")) ??
    (await getValidAccessToken(supabase, "us"));
  if (!auth) {
    return { data: null, error: "Xero is not connected. Connect it first." };
  }

  const [za, us] = await Promise.all([
    getStoredTokens(supabase, "za"),
    getStoredTokens(supabase, "us"),
  ]);

  try {
    const res = await fetch("https://api.xero.com/connections", {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      return { data: null, error: `Xero refused the request (${res.status}).` };
    }

    const list = (await res.json()) as { tenantId: string; tenantName?: string }[];

    return {
      data: {
        organisations: list.map((t) => {
          const boundTo: XeroRegion[] = [];
          if (za?.tenant_id === t.tenantId) boundTo.push("za");
          if (us?.tenant_id === t.tenantId) boundTo.push("us");
          return { tenantId: t.tenantId, tenantName: t.tenantName ?? null, boundTo };
        }),
      },
      error: null,
    };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Point a region at a specific organisation.
 *
 * Deliberately does NOT touch the access or refresh token: the existing
 * authorisation already covers every organisation in the list, so this is a
 * one-field correction rather than a reconnection. Refuses a tenant the
 * authorisation does not cover, so a typo cannot orphan a region.
 */
export async function repointRegion(
  supabase: Client,
  region: XeroRegion,
  tenantId: string
): Promise<{ error: string | null; tenantName?: string | null }> {
  const { data, error } = await listXeroOrganisations(supabase);
  if (error || !data) return { error: error ?? "Could not read Xero organisations." };

  const target = data.organisations.find((o) => o.tenantId === tenantId);
  if (!target) {
    return {
      error: `That organisation is not one this app is authorised for (${data.organisations
        .map((o) => o.tenantName)
        .join(", ")}).`,
    };
  }

  const existing = await getStoredTokens(supabase, region);
  if (!existing) {
    return { error: `No stored Xero connection for ${region.toUpperCase()}. Connect it first.` };
  }

  const { error: updErr } = await (supabase as Client)
    .from("xero_tokens")
    .update({ tenant_id: target.tenantId, tenant_name: target.tenantName })
    .eq("id", existing.id);

  if (updErr) return { error: updErr.message };
  return { error: null, tenantName: target.tenantName };
}

// ────────────────────────────────────────────────────────────
// STUDENTS' EXISTING INVOICES (read-only) — for matching to the Hub
// ────────────────────────────────────────────────────────────

export interface XeroStudentInvoice {
  invoiceId: string;
  invoiceNumber: string | null;
  status: string;
  date: string | null;
  dueDate: string | null;
  total: number;
  amountPaid: number;
  amountDue: number;
  reference: string | null;
  lines: Array<{ itemCode: string | null; description: string; amount: number }>;
}

/**
 * Every sales invoice in one organisation for each of these email
 * addresses, keyed by lower-cased email. Contacts are found by email the
 * same way invoicing finds them (exact EmailAddress), so a student matched
 * here is the contact the Hub would invoice. Voided and deleted invoices are
 * left out. Read-only: nothing in Xero changes.
 */
export async function getXeroInvoicesForEmails(
  supabase: Client,
  region: XeroRegion,
  emails: string[]
): Promise<{ data: Map<string, XeroStudentInvoice[]>; contacts: Map<string, string>; error: string | null }> {
  const out = new Map<string, XeroStudentInvoice[]>();
  const contacts = new Map<string, string>(); // email → contact id
  const wanted = [...new Set(emails.map((e) => e.trim()).filter(Boolean))];
  if (wanted.length === 0) return { data: out, contacts, error: null };
  const auth = await getValidAccessToken(supabase, region);
  if (!auth) return { data: out, contacts, error: `Xero ${region.toUpperCase()} not connected or token expired` };

  const q = (s: string) => s.replace(/"/g, '\\"');
  try {
    const contactEmail = new Map<string, string>(); // contact id → email
    for (let i = 0; i < wanted.length; i += 15) {
      const chunk = wanted.slice(i, i + 15);
      const variants = [...new Set(chunk.flatMap((e) => [e, e.toLowerCase()]))];
      const where = variants.map((e) => `EmailAddress=="${q(e)}"`).join(" OR ");
      const json = (await xeroGet(
        auth.accessToken,
        auth.tenantId,
        `Contacts?where=${encodeURIComponent(where)}&summaryOnly=true`
      )) as { Contacts?: Array<{ ContactID: string; EmailAddress?: string; ContactStatus?: string }> };
      for (const c of json.Contacts ?? []) {
        const email = (c.EmailAddress ?? "").trim().toLowerCase();
        if (!email || c.ContactStatus === "ARCHIVED") continue;
        contactEmail.set(c.ContactID, email);
        if (!contacts.has(email)) contacts.set(email, c.ContactID);
      }
    }

    const ids = [...contactEmail.keys()];
    for (let i = 0; i < ids.length; i += 40) {
      const chunk = ids.slice(i, i + 40).join(",");
      for (let page = 1; page < 50; page++) {
        // Paged reads include line items (item codes).
        const json = (await xeroGet(
          auth.accessToken,
          auth.tenantId,
          `Invoices?ContactIDs=${encodeURIComponent(chunk)}&Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID&page=${page}`
        )) as { Invoices?: Record<string, unknown>[] };
        const list = json.Invoices ?? [];
        for (const inv of list) {
          if (inv.Type !== "ACCREC") continue;
          const contactId = (inv.Contact as { ContactID?: string } | undefined)?.ContactID ?? "";
          const email = contactEmail.get(contactId);
          if (!email) continue;
          const row: XeroStudentInvoice = {
            invoiceId: inv.InvoiceID as string,
            invoiceNumber: (inv.InvoiceNumber as string) ?? null,
            status: (inv.Status as string) ?? "",
            date: xeroDateToYmd(inv.Date),
            dueDate: xeroDateToYmd(inv.DueDate),
            total: Number(inv.Total ?? 0),
            amountPaid: Number(inv.AmountPaid ?? 0),
            amountDue: Number(inv.AmountDue ?? 0),
            reference: (inv.Reference as string) || null,
            lines: ((inv.LineItems as Array<Record<string, unknown>>) ?? []).map((l) => ({
              itemCode: (l.ItemCode as string) || null,
              description: (l.Description as string) ?? "",
              amount: Number(l.LineAmount ?? 0),
            })),
          };
          (out.get(email) ?? out.set(email, []).get(email)!).push(row);
        }
        if (list.length < 100) break;
      }
    }
    return { data: out, contacts, error: null };
  } catch (err) {
    return { data: out, contacts, error: err instanceof Error ? err.message : "Xero read failed" };
  }
}

// ────────────────────────────────────────────────────────────
// ITEMS (event sales items for pay-later ticket invoices)
// ────────────────────────────────────────────────────────────
// An event's "sales account" in Xero is an Item: e.g. the US org's `GL`
// "FF Global Leaders Gathering" → 1050 Event Registration Revenue, Tax
// Exempt. Account codes differ per org (Event Registration Revenue is 1050
// in the US org, 1060 in SA), so the account is found by NAME.

export type XeroItemSummary = {
  itemId: string;
  code: string;
  name: string | null;
  description: string | null;
  salesAccountCode: string | null;
  salesTaxType: string | null;
};

export const EVENT_REVENUE_ACCOUNT_NAME = "Event Registration Revenue";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toItemSummary(i: any): XeroItemSummary {
  return {
    itemId: i.ItemID,
    code: i.Code,
    name: i.Name ?? null,
    description: i.Description ?? null,
    salesAccountCode: i.SalesDetails?.AccountCode ?? null,
    salesTaxType: i.SalesDetails?.TaxType ?? null,
  };
}

/** Every Item in a region's org, with its "Sell" details. GET only. */
export async function listXeroItems(
  supabase: Client,
  region: XeroRegion
): Promise<XeroItemSummary[]> {
  const auth = await getValidAccessToken(supabase, region);
  if (!auth) throw new Error(`Xero ${region.toUpperCase()} not connected or token expired`);
  const res = await xeroGet(auth.accessToken, auth.tenantId, "Items");
  return (res.Items ?? []).map(toItemSummary);
}

/** Active revenue accounts in a region's chart of accounts. GET only. */
export async function listXeroRevenueAccounts(
  supabase: Client,
  region: XeroRegion
): Promise<{ code: string; name: string }[]> {
  const auth = await getValidAccessToken(supabase, region);
  if (!auth) throw new Error(`Xero ${region.toUpperCase()} not connected or token expired`);
  const res = await xeroGet(
    auth.accessToken,
    auth.tenantId,
    'Accounts?where=Type%3D%3D%22REVENUE%22%20AND%20Status%3D%3D%22ACTIVE%22'
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (res.Accounts ?? []).map((a: any) => ({ code: a.Code, name: a.Name }));
}

/**
 * Create an event's sales Item: sold, posting to the org's Event
 * Registration Revenue account, tax exempt — the same shape finance sets up
 * by hand. Needs the `accounting.settings` (write) scope; with only
 * `.read`, Xero answers 401/403 and the caller says to reconnect.
 */
export async function createXeroEventItem(
  supabase: Client,
  region: XeroRegion,
  params: { code: string; name: string; description: string }
): Promise<{ ok: true; item: XeroItemSummary } | { ok: false; error: string; needsReconnect?: boolean }> {
  const auth = await getValidAccessToken(supabase, region);
  if (!auth) return { ok: false, error: `Xero ${region.toUpperCase()} not connected or token expired` };
  try {
    const accounts = await listXeroRevenueAccounts(supabase, region);
    const account = accounts.find(
      (a) => a.name.trim().toLowerCase() === EVENT_REVENUE_ACCOUNT_NAME.toLowerCase()
    );
    if (!account) {
      return { ok: false, error: `No "${EVENT_REVENUE_ACCOUNT_NAME}" revenue account in the ${region.toUpperCase()} Xero org` };
    }
    const res = await xeroPost(auth.accessToken, auth.tenantId, "Items", {
      Items: [
        {
          Code: params.code,
          Name: params.name.slice(0, 50),
          Description: params.description,
          IsSold: true,
          IsPurchased: false,
          SalesDetails: { AccountCode: account.code, TaxType: "NONE" },
        },
      ],
    });
    const item = res.Items?.[0];
    if (!item?.ItemID) return { ok: false, error: "Xero returned no item" };
    return { ok: true, item: toItemSummary(item) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Xero item create failed";
    const needsReconnect = /\((401|403)\)/.test(msg);
    return {
      ok: false,
      needsReconnect,
      error: needsReconnect
        ? "The Hub isn't allowed to create items in Xero yet. Reconnect Xero (Finance → Integrations) to grant it, then try again."
        : msg,
    };
  }
}

// ────────────────────────────────────────────────────────────
// DONATIONS FOR DONOR STATEMENTS (US org, read-only)
// ────────────────────────────────────────────────────────────
// The same data as the "Receivable Invoice Detail" report finance used to
// export by hand: every invoice line and credit-note line dated in the tax
// year, Approved or Paid, with amounts converted to USD. The import rules
// (src/lib/finance/donor-statements.ts) decide what counts as a gift.
// Contact emails come back too, so nobody pastes an Emails tab.

export type XeroDonationLine = {
  invoiceNumber: string;
  invoiceDate: string | null;
  contactName: string;
  contactId: string | null;
  itemCode: string | null;
  description: string | null;
  accountCode: string | null;
  quantity: number;
  unitPriceUsd: number;
  invoiceTotalUsd: number;
  currency: string;
  status: string;
};

export async function listXeroDonationLines(
  supabase: Client,
  taxYear: number
): Promise<{
  lines: XeroDonationLine[];
  contactEmails: Map<string, string>; // ContactID → email
  tenantName: string | null;
  error: string | null;
}> {
  const empty = { lines: [], contactEmails: new Map<string, string>(), tenantName: null };
  const auth = await getValidAccessToken(supabase, "us");
  if (!auth) {
    return {
      ...empty,
      error: "The US Xero organisation isn't connected, or its authorisation has lapsed. Reconnect it in Finance → Xero.",
    };
  }
  const tokens = await getStoredTokens(supabase, "us");
  const range = `Date>=DateTime(${taxYear},01,01) AND Date<=DateTime(${taxYear},12,31)`;
  const lines: XeroDonationLine[] = [];
  const contactIds = new Set<string>();

  // Xero's CurrencyRate is units of the document currency per 1 USD (the US
  // org's base currency); 1 for USD documents.
  const toUsd = (amount: number, rate: unknown) => {
    const r = Number(rate) || 1;
    return Math.round((amount / r) * 100) / 100;
  };

  type Doc = Record<string, unknown>;
  const collect = (doc: Doc, number: string, sign: 1 | -1) => {
    const contact = (doc.Contact as { ContactID?: string; Name?: string } | undefined) ?? {};
    if (contact.ContactID) contactIds.add(contact.ContactID);
    for (const l of (doc.LineItems as Doc[] | undefined) ?? []) {
      lines.push({
        invoiceNumber: number,
        invoiceDate: xeroDateToYmd(doc.Date),
        contactName: contact.Name ?? "",
        contactId: contact.ContactID ?? null,
        itemCode: (l.ItemCode as string) || null,
        description: (l.Description as string) || null,
        accountCode: (l.AccountCode as string) || null,
        quantity: sign * Number(l.Quantity ?? 1),
        unitPriceUsd: toUsd(Number(l.UnitAmount ?? 0), doc.CurrencyRate),
        invoiceTotalUsd: sign * toUsd(Number(doc.Total ?? 0), doc.CurrencyRate),
        currency: (doc.CurrencyCode as string) || "USD",
        status: (doc.Status as string) || "",
      });
    }
  };

  try {
    for (let page = 1; page < 100; page++) {
      const where = encodeURIComponent(`Type=="ACCREC" AND ${range}`);
      const json = (await xeroGet(
        auth.accessToken,
        auth.tenantId,
        `Invoices?where=${where}&Statuses=AUTHORISED,PAID&page=${page}`
      )) as { Invoices?: Doc[] };
      const list = json.Invoices ?? [];
      for (const inv of list) collect(inv, (inv.InvoiceNumber as string) || String(inv.InvoiceID), 1);
      if (list.length < 100) break;
    }
    // Credit notes reverse earlier gifts; they come in as negative quantities,
    // the same way the report shows them.
    for (let page = 1; page < 100; page++) {
      const where = encodeURIComponent(`Type=="ACCRECCREDIT" AND ${range} AND (Status=="AUTHORISED" OR Status=="PAID")`);
      const json = (await xeroGet(
        auth.accessToken,
        auth.tenantId,
        `CreditNotes?where=${where}&page=${page}`
      )) as { CreditNotes?: Doc[] };
      const list = json.CreditNotes ?? [];
      for (const cn of list) {
        const n = (cn.CreditNoteNumber as string) || String(cn.CreditNoteID);
        collect({ ...cn, Status: "PAID" }, /^CN-/i.test(n) ? n : `CN-${n}`, -1);
      }
      if (list.length < 100) break;
    }

    const contactEmails = new Map<string, string>();
    const ids = [...contactIds];
    for (let i = 0; i < ids.length; i += 50) {
      const json = (await xeroGet(
        auth.accessToken,
        auth.tenantId,
        `Contacts?IDs=${ids.slice(i, i + 50).join(",")}&summaryOnly=true`
      )) as { Contacts?: Array<{ ContactID: string; EmailAddress?: string }> };
      for (const c of json.Contacts ?? []) {
        const email = (c.EmailAddress ?? "").trim();
        if (email) contactEmails.set(c.ContactID, email);
      }
    }
    return { lines, contactEmails, tenantName: tokens?.tenant_name ?? null, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("401") || msg.includes("403")) {
      return { ...empty, error: "Xero refused the request — the US authorisation has expired. Reconnect Xero in Finance → Xero." };
    }
    return { ...empty, error: msg };
  }
}
