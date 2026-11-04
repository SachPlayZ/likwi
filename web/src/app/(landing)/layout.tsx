import type { ReactNode } from "react";
import { Caveat, Instrument_Serif } from "next/font/google";
import "./landing.css";

const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif" });
const hand = Caveat({ subsets: ["latin"], variable: "--font-hand" });

export default function LandingLayout({ children }: { children: ReactNode }) {
  return <div className={`landing grain min-h-screen ${serif.variable} ${hand.variable}`}>{children}</div>;
}
