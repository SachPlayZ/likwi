import type { Metadata } from "next";
import { ProductScreen } from "@/components/ProductScreen";

export const metadata: Metadata = { title: "Liquidation Shield · App" };

// The product page (BRIEF §8, #18): connect a wallet on Monad testnet and opt in to the Shield.
export default function AppPage() {
  return <ProductScreen />;
}
