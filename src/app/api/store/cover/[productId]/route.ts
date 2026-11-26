import { createClient } from "@/lib/supabase/server";
import { storeAdminClient } from "@/lib/store/db";
import { getProduct } from "@/services/store";

// GET /api/store/cover/[productId] — a product's cover image. Readable when
// the product is (published, or the caller is Store staff — RLS decides).
export async function GET(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: product } = await getProduct(supabase, productId);
  const path = product?.cover_image_url as string | null | undefined;
  if (!path) return new Response("Not found", { status: 404 });
  if (/^https:\/\//.test(path)) return Response.redirect(path, 302);
  const { data: file } = await storeAdminClient().storage.from("store-covers").download(path);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(file, {
    headers: {
      "Content-Type": file.type || "image/webp",
      "Cache-Control": product?.status === "published" ? "public, max-age=3600, stale-while-revalidate=86400" : "private, no-store",
    },
  });
}
