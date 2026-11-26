import { deleteHelpRequest, patchHelpRequest } from "../../_lib/help";

// /api/song-library/help-requests/[requestId]. Handlers and the full route list: app/api/song-library/_lib/help.ts.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ requestId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { requestId } = await params;
  return patchHelpRequest(request, requestId);
}

export async function DELETE(request: Request, { params }: Params) {
  const { requestId } = await params;
  return deleteHelpRequest(requestId);
}
