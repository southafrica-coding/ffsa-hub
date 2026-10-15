import { NextResponse } from "next/server";
import { xeroRedirectUri } from "@/services/xero";
import crypto from "crypto";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const region = url.searchParams.get("region") ?? "za";

    const clientId = process.env.XERO_CLIENT_ID!;
    const redirectUri = xeroRedirectUri();
    // New granular scopes (required for apps created after March 2, 2026).
    // accounting.payments lets Stripe ticket invoices be marked PAID and
    // refunds be paid out; without it POST /Payments returns 401.
    const scopes = "openid profile email offline_access accounting.invoices accounting.payments accounting.contacts accounting.settings.read";
    // Encode region in state so we know which region on callback
    const state = JSON.stringify({
      nonce: crypto.randomBytes(16).toString("hex"),
      region,
    });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scopes,
      state,
    });

    const consentUrl = `https://login.xero.com/identity/connect/authorize?${params.toString()}`;

    console.log(`=== XERO CONNECT (${region}) ===`);
    console.log("Consent URL:", consentUrl);

    return NextResponse.redirect(consentUrl);
  } catch (err) {
    console.error("Xero connect error:", err);
    return NextResponse.json(
      { error: "Failed to initiate Xero connection" },
      { status: 500 }
    );
  }
}
