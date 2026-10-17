import { NextResponse } from "next/server";
import JSZip from "jszip";
import {
  authorizeDonorStatements,
  deliverStatement,
  dsDb,
  loadRunReview,
  loadSettings,
  loadStatementImages,
  sendBlocker,
} from "@/lib/finance/donor-statements-server";

// POST { donors: [key, …] }
//   → a ZIP of those donors' PDF statements, to print and post (donors with
//     no usable email). Each one is saved and logged as a paper statement.

export const maxDuration = 60;
const MAX_DONORS = 60;

type Ctx = { params: Promise<{ runId: string }> };

export async function POST(request: Request, context: Ctx) {
  const auth = await authorizeDonorStatements();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { runId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { donors?: unknown };
  const keys = Array.isArray(body.donors) ? [...new Set(body.donors.map(String))] : [];
  if (keys.length === 0) return NextResponse.json({ error: "Choose whose statements to download" }, { status: 400 });
  if (keys.length > MAX_DONORS) return NextResponse.json({ error: `At most ${MAX_DONORS} at a time` }, { status: 400 });

  const admin = dsDb();
  const [review, settings] = await Promise.all([loadRunReview(admin, runId), loadSettings(admin)]);
  if (!review) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (!settings) return NextResponse.json({ error: "Settings missing" }, { status: 500 });
  const blocker = sendBlocker(settings);
  if (blocker) return NextResponse.json({ error: blocker }, { status: 400 });

  const year = review.run.tax_year;
  const images = await loadStatementImages(admin, settings);
  const zip = new JSZip();
  for (const key of keys) {
    const donor = review.build.donors.find((d) => d.key === key);
    if (!donor || donor.excluded || donor.totalCents <= 0) continue;
    const { row, pdf } = await deliverStatement(admin, {
      runId, year, donor, settings, images, userId: auth.user.id, channel: "paper", isResend: false,
    });
    zip.file(row.file_name, pdf);
  }
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  const name = `FF SA USA - ${year} paper statements.zip`;
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
