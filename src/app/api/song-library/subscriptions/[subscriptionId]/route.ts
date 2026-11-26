import { unsubscribe } from "../../_lib/help";

// /api/song-library/subscriptions/[subscriptionId]. Handlers and the full route list: app/api/song-library/_lib/help.ts.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ subscriptionId: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const { subscriptionId } = await params;
  return unsubscribe(subscriptionId);
}
