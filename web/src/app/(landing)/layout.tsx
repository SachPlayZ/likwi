import type { ReactNode } from "react";
import "./landing.css";

export default function LandingLayout({ children }: { children: ReactNode }) {
  return <div className="landing grain min-h-screen">{children}</div>;
}
