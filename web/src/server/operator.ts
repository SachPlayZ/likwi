// Operator for the /demo routes (BRIEF §8, §17.3). Signs with the testnet-only OPERATOR_PRIVATE_KEY from
// server-side env, reusing the `demo` package. One action at a time; actions run in the background so a
// 10 s slow crash doesn't hold the request open. Only imported by route handlers, never by client code.
import type { Hex } from "viem";
import { connect, crash, readDeployments, seedRun, slowCrash, type Context } from "@liquidation-shield/demo";
import { TESTNET_CHAIN_ID } from "@liquidation-shield/shared";

export type OperatorTx = { kind: "price" | "reset"; label: string; hash: Hex; block: string };
export type Busy = "reset" | "crash" | null;

type State = { ctx?: Promise<Context>; busy: Busy; error?: string; txs: OperatorTx[] };

// globalThis: Next can load this module more than once (per route, and on dev reloads).
const g = globalThis as { __operator?: State };
const state: State = (g.__operator ??= { busy: null, txs: [] });

/** Ticker lines: price moves, plus one line per Reset (the price reset that opens it). Setup txs are skipped. */
function record(tx: { label: string; hash: Hex; block: bigint }) {
  const price = /^(slow crash|crash)/.test(tx.label);
  const reset = tx.label.startsWith("reset price");
  if (!price && !reset) return;
  state.txs.push({ kind: reset ? "reset" : "price", label: tx.label, hash: tx.hash, block: tx.block.toString() });
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
  void context()
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

export const operator = {
  chainId: TESTNET_CHAIN_ID,
  reset: () => run("reset", (ctx) => seedRun(ctx, readDeployments())),
  crash: (pct: bigint) => run("crash", (ctx) => crash(ctx, readDeployments(), pct)),
  slowCrash: () => run("crash", (ctx) => slowCrash(ctx, readDeployments())),
  status: () => ({ busy: state.busy, error: state.error, txs: state.txs }),
};
