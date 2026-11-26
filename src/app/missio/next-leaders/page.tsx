import type { Metadata } from "next";
import { NextLeadersBoard } from "@/components/missio/next-leaders/board";

export const metadata: Metadata = {
  title: { absolute: "Next leaders · Missio" },
};

export default function MissioNextLeadersPage() {
  return <NextLeadersBoard />;
}
