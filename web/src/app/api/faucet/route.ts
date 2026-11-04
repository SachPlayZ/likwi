// POST /api/faucet: { "address": "0x…" } → 10 tWETH (+ a small MON gas drip for an empty wallet), once per address.
// Monad testnet only: the operator refuses any other chain (BRIEF §8, §17.10).
import { isAddress } from "viem";
import { FaucetError, operator } from "@/server/operator";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { address?: string };
  if (!body.address || !isAddress(body.address)) {
    return Response.json({ error: 'expected { "address": "0x…" }' }, { status: 400 });
  }
  try {
    return Response.json(await operator.faucet(body.address));
  } catch (e) {
    if (e instanceof FaucetError) return Response.json({ error: e.message }, { status: e.status });
    const msg = (e as Error).message.split("\n")[0];
    console.error("faucet failed:", msg);
    return Response.json({ error: `Faucet failed: ${msg}` }, { status: 500 });
  }
}
