import type { Metadata } from "next";
import { MissioHome } from "@/components/missio/home";

export const metadata: Metadata = {
  title: { absolute: "Missio" },
};

export default function MissioHomePage() {
  return <MissioHome />;
}
