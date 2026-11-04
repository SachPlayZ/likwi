// `demo crash` (BRIEF §8, §9): move the test oracle's tWETH price with the operator's owner-only setter.
import { testnetOracleAbi, type Deployments } from "@liquidation-shield/shared";
import { setPrice } from "./seed";
import { sleep, type Context } from "./context";

export const SLOW_CRASH = { stepPct: 3n, steps: 10, intervalMs: 1_000 } as const; // −3%/s × 10s ≈ −26%

const currentPrice = (ctx: Context, d: Deployments) =>
  ctx.client.readContract({ address: d.oracle, abi: testnetOracleAbi, functionName: "getAssetPrice", args: [d.weth] });

const usd = (price: bigint) => `$${(Number(price) / 1e8).toFixed(2)}`;

/** One instant drop of `pct` percent. */
export async function crash(ctx: Context, d: Deployments, pct: bigint): Promise<void> {
  const price = ((await currentPrice(ctx, d)) * (100n - pct)) / 100n;
  await setPrice(ctx, d, price, `crash −${pct}% → ${usd(price)}`);
}

/** The demo's main path: −3% per second for 10 seconds, compounding. */
export async function slowCrash(ctx: Context, d: Deployments): Promise<void> {
  let price = await currentPrice(ctx, d);
  for (let i = 1; i <= SLOW_CRASH.steps; i++) {
    const started = Date.now();
    price = (price * (100n - SLOW_CRASH.stepPct)) / 100n;
    await setPrice(ctx, d, price, `slow crash ${i}/${SLOW_CRASH.steps} → ${usd(price)}`);
    await sleep(Math.max(0, SLOW_CRASH.intervalMs - (Date.now() - started)));
  }
}
