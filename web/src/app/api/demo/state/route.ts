// GET /api/demo/state: public addresses, the current run's Alice and Bob, and operator activity.
import { readDeployments } from "@liquidation-shield/demo";
import { operator } from "@/server/operator";

export const dynamic = "force-dynamic";

export function GET() {
  let d;
  try {
    d = readDeployments();
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 503 });
  }
  const { chainId, pool, oracle, weth, usdc, aWeth, vUsdc, shield, keeper, liquidator, run } = d;
  return Response.json({ chainId, pool, oracle, weth, usdc, aWeth, vUsdc, shield, keeper, liquidator, run, ...operator.status() });
}
