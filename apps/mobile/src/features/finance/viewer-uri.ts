// The receipt viewer takes its image from a route param, and routes can be
// opened by a link (scheme ffsahub://). Only show images that can be ours:
// a signed URL on this app's Supabase project, or a file in the app's own
// storage. Anything else is refused rather than displayed.

export function isAllowedReceiptUri(uri: string | undefined, opts: { supabaseUrl: string; documentDir: string }): uri is string {
  if (!uri) return false;
  if (uri.startsWith("file://")) {
    const dir = opts.documentDir.endsWith("/") ? opts.documentDir : `${opts.documentDir}/`;
    return uri.startsWith(dir) && !uri.includes("..");
  }
  try {
    const u = new URL(uri);
    const allowed = new URL(opts.supabaseUrl);
    return u.protocol === "https:" && u.host === allowed.host && u.pathname.startsWith("/storage/v1/object/sign/outreach-receipts/");
  } catch {
    return false;
  }
}
