// GET /api/demo/state: public addresses, the current run's Alice and Bob, and operator activity.
import { operator } from "@/server/operator";

export const dynamic = "force-dynamic";

export async function GET() {
  let d;
  try {
    d = await operator.deployments();
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 503 });
  }
  const { chainId, deployBlock, pool, oracle, weth, usdc, aWeth, vUsdc, shield, keeper, liquidator, run } = d;
  return Response.json({ chainId, deployBlock, pool, oracle, weth, usdc, aWeth, vUsdc, shield, keeper, liquidator, run, ...operator.status() });
}
