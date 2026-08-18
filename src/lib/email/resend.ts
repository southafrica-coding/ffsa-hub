import { Resend } from "resend";

// Shared, lazily-constructed Resend client.
//
// Every mail-sending module used to build its own client at module scope:
//
//   const resend = new Resend(process.env.RESEND_API_KEY?.trim());
//
// Resend's constructor throws when the key is missing, and `next build`
// imports every route module to collect page data — so a single absent env
// var failed the whole production build before a line of app code ran, with
// an error naming Resend rather than the missing variable.
//
// Constructing on first send instead means a missing key can only ever fail
// the one email that needed it, and it fails loudly, naming the variable.
// Callers that would rather degrade than throw can check isEmailConfigured()
// first.

let client: Resend | null = null;
let cachedKey: string | null = null;

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY?.trim();
}

export function getResend(): Resend {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "RESEND_API_KEY is not set — no email can be sent. Set it in the Vercel project env (all environments) and redeploy."
    );
  }
  // Rebuild if the key changed under us (env reload between invocations).
  if (!client || cachedKey !== key) {
    client = new Resend(key);
    cachedKey = key;
  }
  return client;
}
