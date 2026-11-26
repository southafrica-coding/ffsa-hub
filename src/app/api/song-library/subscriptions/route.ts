import { listSubscriptions, subscribe, unsubscribeByTarget } from "../_lib/help";

// /api/song-library/subscriptions. Handlers and the full route list: app/api/song-library/_lib/help.ts.

export const dynamic = "force-dynamic";

export async function GET() {
  return listSubscriptions();
}

export async function POST(request: Request) {
  return subscribe(request);
}

export async function DELETE(request: Request) {
  return unsubscribeByTarget(request);
}
