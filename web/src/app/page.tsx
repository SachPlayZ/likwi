import Link from "next/link";

// The product page (connect wallet, Shield form) is #18. Until then, point at the demo.
export default function Home() {
  return (
    <main className="home">
      <p className="eyebrow">Liquidation Shield · Monad testnet</p>
      <h1>Per-block liquidation protection for Aave V3 borrowers.</h1>
      <Link className="btn btn-primary" href="/demo">
        Open the live demo →
      </Link>
    </main>
  );
}
