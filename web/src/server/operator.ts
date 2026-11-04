// Operator for the /demo routes (BRIEF §8, §17.3). Signs with the testnet-only OPERATOR_PRIVATE_KEY from
// server-side env, reusing the `demo` package. One action at a time; actions run in the background so a
// 10 s slow crash doesn't hold the request open. Only imported by route handlers, never by client code.
import { parseEther, type Address, type Hex } from "viem";
import { confirm, connect, crash, latestDeployments, readDeployments, seedRun, slowCrash, type Context } from "@liquidation-shield/demo";
import { TESTNET_CHAIN_ID, testnetERC20Abi, type Deployments } from "@liquidation-shield/shared";

/** `price`: the tWETH price this tx set; `block` + `index` place it, so the page can value events at the
 *  price in force at their own position in the block (a crash tick can land in the same block). */
export type OperatorTx = { kind: "price" | "reset"; label: string; hash: Hex; block: string; index: number; price?: number };
export type Busy = "reset" | "crash" | "faucet" | null;

type State = {
  ctx?: Promise<Context>;
  busy: Busy;
  error?: string;
  txs: OperatorTx[];
  /** Product-page faucet: addresses already served (once each), and MON drips sent so far. */
  faucet: { served: Set<string>; drips: number };
  /** The running action; routes hand it to `after()` so serverless hosts keep it alive past the response. */
  pending?: Promise<unknown>;
};

// globalThis: Next can load this module more than once (per route, and on dev reloads).
const g = globalThis as { __operator?: State };
const state: State = (g.__operator ??= { busy: null, txs: [], faucet: { served: new Set(), drips: 0 } });
state.faucet ??= { served: new Set(), drips: 0 };

const FAUCET_WETH = 10n * 10n ** 18n; // 10 tWETH
const FAUCET_GAS = () => parseEther(process.env.FAUCET_GAS_MON ?? "0.05");
const FAUCET_MAX_DRIPS = () => Number(process.env.FAUCET_MAX_DRIPS ?? "30");

export type FaucetResult = { mint: Hex; gas?: Hex };

export class FaucetError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Ticker lines: price moves, plus one line per Reset (the price reset that opens it). Setup txs are skipped. */
function record(tx: { label: string; hash: Hex; block: bigint; index: number }) {
  const move = /^(slow crash|crash)/.test(tx.label);
  const reset = tx.label.startsWith("reset price");
  if (!move && !reset) return;
  const price = tx.label.match(/→ \$([\d.]+)$/)?.[1];
  state.txs.push({
    kind: reset ? "reset" : "price",
    label: tx.label,
    hash: tx.hash,
    block: tx.block.toString(),
    index: tx.index,
    price: price ? Number(price) : undefined,
  });
  if (state.txs.length > 200) state.txs.splice(0, state.txs.length - 200);
}

function context(): Promise<Context> {
  // connect() refuses any chain other than Monad testnet (10143).
  state.ctx ??= connect(record).catch((e) => {
    state.ctx = undefined;
    throw e;
  });
  return state.ctx;
}

/** Starts `action` unless one is running. Returns false when busy. */
function run(kind: Exclude<Busy, null>, action: (ctx: Context) => Promise<unknown>): boolean {
  if (state.busy) return false;
  state.busy = kind;
  state.error = undefined;
  state.pending = context()
    .then(action)
    .catch((e: Error) => {
      const status = e.message.match(/Status: (\d+)/)?.[1];
      state.error = `${kind} failed: ${e.message.split("\n")[0]}${status ? ` (HTTP ${status})` : ""}`;
      console.error(`${kind} failed:`, e.message.split("\nRequest body")[0]);
    })
    .finally(() => {
      state.busy = null;
    });
  return true;
}

/**
 * Product-page faucet (BRIEF §8): mints 10 tWETH to `to` and, if the wallet has almost no MON, sends a small gas
 * drip so a fresh wallet can open its own loan. Once per address; MON drips are capped per server run so a public
 * page can't drain the operator. Shares the operator lock: one signer, so no two of its txs race for a nonce.
 */
async function faucet(to: Address): Promise<FaucetResult> {
  const key = to.toLowerCase();
  if (state.faucet.served.has(key)) throw new FaucetError("This wallet already used the faucet.", 429);
  if (state.busy) throw new FaucetError(`Operator busy (${state.busy}); try again in a few seconds.`, 409);
  state.busy = "faucet";
  try {
    const ctx = await context();
    const d = readDeployments();
    const mint = await confirm(
      ctx,
      `faucet: mint 10 tWETH → ${to}`,
      ctx.operator.writeContract({ address: d.weth, abi: testnetERC20Abi, functionName: "mint", args: [to, FAUCET_WETH] }),
    );
    state.faucet.served.add(key);

    let gas: Hex | undefined;
    const drip = FAUCET_GAS();
    const balance = await ctx.client.getBalance({ address: to });
    if (balance < drip / 2n && state.faucet.drips < FAUCET_MAX_DRIPS()) {
      state.faucet.drips++;
      gas = await confirm(ctx, `faucet: MON gas → ${to}`, ctx.operator.sendTransaction({ to, value: drip }));
    }
    return { mint, gas };
  } finally {
    state.busy = null;
  }
}

/** latestDeployments, re-checked at most every 5 s: the page polls state often and the public RPC rate-limits. */
let cached: { at: number; d: Promise<Deployments> } | undefined;
function deployments(): Promise<Deployments> {
  if (!cached || Date.now() - cached.at > 5_000) {
    const d = context().then(latestDeployments);
    d.catch(() => (cached = undefined));
    cached = { at: Date.now(), d };
  }
  return cached.d;
}

export const operator = {
  chainId: TESTNET_CHAIN_ID,
  faucet,
  reset: () => run("reset", async (ctx) => seedRun(ctx, await latestDeployments(ctx))),
  crash: (pct: bigint) => run("crash", (ctx) => crash(ctx, readDeployments(), pct)),
  slowCrash: () => run("crash", (ctx) => slowCrash(ctx, readDeployments())),
  deployments,
  pending: () => state.pending ?? Promise.resolve(),
  status: () => ({ busy: state.busy, error: state.error, txs: state.txs }),
};
