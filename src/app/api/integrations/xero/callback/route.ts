import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { saveTokens, xeroRedirectUri } from "@/services/xero";
import type { XeroRegion } from "@/services/xero";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/login`
    );
  }

  // Extract region from state
  let region: XeroRegion = "za";
  try {
    if (stateParam) {
      const stateObj = JSON.parse(stateParam);
      if (stateObj.region === "us" || stateObj.region === "za") {
        region = stateObj.region;
      }
    }
  } catch {
    // If state isn't valid JSON, default to "za"
  }

  console.log(`=== XERO CALLBACK HIT (${region}) ===`);
  console.log("Full URL:", url.toString());
  console.log("Code:", code);
  console.log("Error:", url.searchParams.get("error"));

  if (!code) {
    const error = url.searchParams.get("error") ?? "no_code";
    console.error("Xero callback missing code. Error:", error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/finance?xero=error&message=${encodeURIComponent(error)}`
    );
  }

  try {
    const clientId = process.env.XERO_CLIENT_ID!;
    const clientSecret = process.env.XERO_CLIENT_SECRET!;
    const redirectUri = xeroRedirectUri();

    // 1. Exchange authorization code for tokens
    const tokenRes = await fetch("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("Xero token exchange failed:", tokenRes.status, errText);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/finance?xero=error&message=Token+exchange+failed`
      );
    }

    const tokenSet = await tokenRes.json();

    // 2. Get connected tenants (organizations)
    const tenantsRes = await fetch("https://api.xero.com/connections", {
      headers: {
        Authorization: `Bearer ${tokenSet.access_token}`,
        "Content-Type": "application/json",
      },
    });

    if (!tenantsRes.ok) {
      console.error("Xero tenants fetch failed:", tenantsRes.status);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/finance?xero=error&message=Could+not+fetch+Xero+organization`
      );
    }

    const tenants = await tenantsRes.json();

    if (!tenants || tenants.length === 0) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/finance?xero=error&message=No+Xero+organization+found`
      );
    }

    // Which organisation did they actually authorise for THIS region?
    //
    // This used to be `tenants[0]` — the first organisation Xero happens to
    // list, regardless of which one was chosen on the consent screen or which
    // region button was clicked. With two organisations authorised, connecting
    // "South Africa" and "United States" both bound to the same tenant, so
    // every student would have been invoiced into one company's books.
    //
    // Xero returns every organisation the user authorised, so the choice has to
    // be made here. Prefer an explicit pin (XERO_TENANT_ID_ZA / _US), then a
    // name match, and refuse to guess when two organisations are available and
    // neither matches — a wrong binding posts real invoices to the wrong books.
    type XeroTenant = { tenantId: string; tenantName?: string };
    const list = tenants as XeroTenant[];

    const pinned = (
      region === "us"
        ? process.env.XERO_TENANT_ID_US
        : process.env.XERO_TENANT_ID_ZA
    )?.trim();

    const nameLooksUS = (n: string) => /\bus\b|u\.s\.|usa|united states|inc\b/i.test(n);

    let tenant: XeroTenant | undefined;

    if (pinned) {
      tenant = list.find((t) => t.tenantId === pinned);
      if (!tenant) {
        return NextResponse.redirect(
          `${process.env.NEXT_PUBLIC_SITE_URL}/finance?xero=error&message=` +
            encodeURIComponent(
              `The pinned ${region.toUpperCase()} organisation was not among the ones you authorised. Check XERO_TENANT_ID_${region.toUpperCase()}.`
            )
        );
      }
    } else if (list.length === 1) {
      tenant = list[0];
    } else {
      const matches = list.filter((t) =>
        region === "us" ? nameLooksUS(t.tenantName ?? "") : !nameLooksUS(t.tenantName ?? "")
      );
      if (matches.length === 1) {
        tenant = matches[0];
      } else {
        // Ambiguous. Better to stop than to bind the wrong books.
        return NextResponse.redirect(
          `${process.env.NEXT_PUBLIC_SITE_URL}/finance?xero=error&message=` +
            encodeURIComponent(
              `Could not tell which Xero organisation is the ${region.toUpperCase()} one (${list
                .map((t) => t.tenantName)
                .join(", ")}). Set XERO_TENANT_ID_${region.toUpperCase()} to the right tenant id and reconnect.`
            )
        );
      }
    }

    // 3. Store the tokens with region
    const expiresAt = new Date(
      Date.now() + (tokenSet.expires_in ?? 1800) * 1000
    ).toISOString();

    await saveTokens(supabase, {
      tenant_id: tenant.tenantId,
      tenant_name: tenant.tenantName,
      access_token: tokenSet.access_token,
      refresh_token: tokenSet.refresh_token,
      expires_at: expiresAt,
      token_set: tokenSet,
      connected_by: user.id,
      region,
    });

    const regionLabel = region === "us" ? "US" : "SA";
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/finance?xero=connected&org=${encodeURIComponent(tenant.tenantName ?? "")}&region=${regionLabel}`
    );
  } catch (err) {
    console.error("Xero callback error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/finance?xero=error&message=${encodeURIComponent(message)}`
    );
  }
}
