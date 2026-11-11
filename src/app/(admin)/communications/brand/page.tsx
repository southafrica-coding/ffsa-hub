import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canManageComms } from "@/lib/api-auth";
import { listSendingIdentities } from "@/services/campaigns";
import { getBrandKit, mergeBrand, type BrandKitRow } from "@/services/brand";
import { Masthead } from "@/components/ffsa";
import { BrandEditor } from "./brand-editor";

export const dynamic = "force-dynamic";

export default async function BrandSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ identity?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (
    !(await canManageComms(supabase, user.id, [
      "communications.manage_brand_kits",
    ]))
  ) {
    redirect("/home");
  }

  const params = await searchParams;
  const { data: identities } = await listSendingIdentities(supabase);
  const list = (identities ?? []) as {
    id: string;
    slug: string;
    display_name: string;
    from_email: string;
    from_name: string;
    provider: string;
  }[];

  const selectedId = params.identity && list.some((i) => i.id === params.identity)
    ? params.identity
    : list[0]?.id;

  const brandRow: BrandKitRow | null = selectedId
    ? await getBrandKit(supabase, selectedId)
    : null;
  const effective = mergeBrand(brandRow);

  return (
    <div className="ffsa-screen">
      <Masthead context="Communications" title="Brand kits" />

      {/* Admin chrome only. The editor below owns the per-identity email
          brand — its own fonts and colours are deliberately not restyled. */}
      <div className="px-5 py-6 md:px-8 md:py-7">
        <p className="mb-5 max-w-2xl text-[13px] text-[color:var(--text-secondary)]">
          Each sending identity has its own brand kit. Anything left blank
          falls back to a clean editorial default.
        </p>

        {list.length === 0 ? (
          <p className="text-[13px] text-[color:var(--text-secondary)]">
            No sending identities configured. Add one first under
            Communications settings.
          </p>
        ) : (
          <BrandEditor
            identities={list}
            selectedIdentityId={selectedId!}
            initialBrand={brandRow}
            initialEffective={effective}
          />
        )}
      </div>
    </div>
  );
}
