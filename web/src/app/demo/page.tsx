import type { Metadata } from "next";
import { DemoScreen } from "@/components/DemoScreen";

export const metadata: Metadata = { title: "likwi · Live demo" };

export default function DemoPage() {
  return <DemoScreen />;
}
