import type { Metadata } from "next";
import { MissioFinance } from "@/components/missio/finance/missio-finance";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Finance · Missio" },
};

export default function MissioFinancePage() {
  return <MissioFinance />;
}
