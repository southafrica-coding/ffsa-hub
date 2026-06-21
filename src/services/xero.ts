// ────────────────────────────────────────────────────────────
// FFSA Hub — Xero Integration (Direct API, no SDK)
// Supports multi-region: "za" (South Africa) and "us" (USA)
// ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type XeroRegion = "za" | "us";

const XERO_API = "https://api.xero.com/api.xro/2.0";
const XERO_IDENTITY = "https://identity.xero.com/connect/token";

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
  endpoint: string
) {
  const res = await fetch(`${XERO_API}/${endpoint}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "xero-tenant-id": tenantId,
      Accept: "application/json",
    },
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
    }>;
    autoSend: boolean;
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
  // Hub bills in ZAR regardless of which Xero org (US vs SA) the invoice
  // posts to. The org/item code still drives the ledger account + tax.
  const currencyCode = "ZAR";

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
    const lineItems = params.lineItems.map((li) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const item: any = {
        Description: li.description,
        Quantity: 1,
        UnitAmount: li.amount,
      };
      if (li.itemCode) {
        item.ItemCode = li.itemCode;
      } else if (fallbackAccount) {
        item.AccountCode = fallbackAccount;
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
        },
      ],
    });

    const invoice = invoiceRes.Invoices?.[0];
    if (!invoice?.InvoiceID) {
      return { success: false, error: "Invoice creation returned no data" };
    }

    let emailed = false;
    if (params.autoSend && initialStatus === "AUTHORISED") {
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

export async function getXeroConnectionStatus(
  supabase: Client,
  region?: XeroRegion
) {
  // If region specified, return status for that region
  if (region) {
    const tokens = await getStoredTokens(supabase, region);
    if (!tokens) {
      return { connected: false as const, region };
    }
    return {
      connected: true as const,
      tenantName: tokens.tenant_name,
      expiresAt: tokens.expires_at,
      region,
    };
  }

  // No region — return status for all regions
  const [zaTokens, usTokens] = await Promise.all([
    getStoredTokens(supabase, "za"),
    getStoredTokens(supabase, "us"),
  ]);

  return {
    za: zaTokens
      ? { connected: true as const, tenantName: zaTokens.tenant_name, expiresAt: zaTokens.expires_at }
      : { connected: false as const },
    us: usTokens
      ? { connected: true as const, tenantName: usTokens.tenant_name, expiresAt: usTokens.expires_at }
      : { connected: false as const },
  };
}
