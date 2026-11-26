import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getBuyer } from "@/lib/store/access";
import { RedeemForm } from "./redeem-form";

export const metadata: Metadata = { title: "Redeem a code" };
export const dynamic = "force-dynamic";

export default async function RedeemPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  const buyer = await getBuyer(await createClient());
  return (
    <div className="mx-auto max-w-[480px] px-4 pt-10 md:pt-16">
      <div className="masthead-context">Gift or group code</div>
      <h1 className="masthead-title">Redeem</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-[color:var(--text-secondary)]">
        Enter your code and it goes into your library. {buyer ? `You're signed in as ${buyer.email}.` : "We'll email you a link to sign in and read."}
      </p>
      <div className="mt-6">
        <RedeemForm initialCode={code ?? ""} signedIn={!!buyer} />
      </div>
    </div>
  );
}
