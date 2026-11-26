import { signUpToHelp, withdrawSignup } from "../../../_lib/help";

// /api/song-library/help-requests/[requestId]/signup. Handlers and the full route list: app/api/song-library/_lib/help.ts.

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ requestId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { requestId } = await params;
  return signUpToHelp(request, requestId);
}

export async function DELETE(request: Request, { params }: Params) {
  const { requestId } = await params;
  return withdrawSignup(requestId);
}
