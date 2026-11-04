import type { Metadata } from "next";
import { DemoScreen } from "@/components/DemoScreen";

export const metadata: Metadata = { title: "Liquidation Shield · Live demo" };

export default function DemoPage() {
  return <DemoScreen />;
}
