// POST /api/rpc: read-only JSON-RPC proxy for the /demo page. The browser never sees RPC_URL (a provider key);
// the server forwards to it, or to the public RPC when unset. Only the read methods the page uses are allowed.
import { testnetChain } from "@liquidation-shield/shared";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["eth_chainId", "eth_blockNumber", "eth_call", "eth_getLogs"]);
const upstream = () => process.env.RPC_URL || testnetChain.rpcUrls.default.http[0];

type Call = { method?: unknown };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Call | Call[] | null;
  const calls = Array.isArray(body) ? body : body ? [body] : [];
  if (!calls.length || calls.some((c) => typeof c.method !== "string" || !ALLOWED.has(c.method))) {
    return Response.json({ error: `only ${[...ALLOWED].join(", ")}` }, { status: 400 });
  }
  const r = await fetch(upstream(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  // Pass 429s through so the client's viem transport backs off and retries.
  return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
}
