"use client";
// /demo data (BRIEF §8): the browser reads Monad testnet (via /api/rpc). One multicall per block for the cards and
// chart; a log poll (≤100-block chunks, the public RPC's cap) for Steps, Alice's liquidation and heartbeats.
// Addresses and the current run come from the server (/api/demo/state).
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createPublicClient,
  http,
  parseAbi,
  parseAbiItem,
  parseEventLogs,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  liquidationShieldAbi,
  testnetChain,
  testnetERC20Abi,
  testnetOracleAbi,
  testnetPoolAbi,
  type DemoRun,
} from "@liquidation-shield/shared";
import type { Busy, OperatorTx } from "@/server/operator";

// Reads go through the server's /api/rpc proxy, so a provider RPC key (RPC_URL) never reaches the browser.
// The public RPC rate-limits bursts; viem retries 429s with backoff.
export const client = createPublicClient({
  chain: testnetChain,
  transport: http("/api/rpc", { retryCount: 4, retryDelay: 300 }),
});

export type DemoState = {
  chainId: number;
  pool: Address;
  oracle: Address;
  weth: Address;
  usdc: Address;
  aWeth: Address;
  vUsdc: Address;
  shield: Address;
  keeper: Address;
  liquidator: Address;
  run?: DemoRun;
  busy: Busy;
  error?: string;
  txs: OperatorTx[];
};

export function useDemoState() {
  return useQuery({
    queryKey: ["demo-state"],
    queryFn: async (): Promise<DemoState> => {
      const r = await fetch("/api/demo/state", { cache: "no-store" });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `state: HTTP ${r.status}`);
      return body;
    },
    refetchInterval: 1_000,
  });
}

export async function postAction(path: "reset" | "crash", body?: object) {
  const r = await fetch(`/api/demo/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!r.ok && r.status !== 409) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
}

// ------------------------------------------------------------------------------------------- per block

export type Side = {
  hf: number; // Infinity with no debt
  collateralUsd: number;
  debtUsd: number;
  walletUsd: number; // tWETH + tUSDC in the wallet
  equityUsd: number;
};

export type Snapshot = {
  block: bigint;
  price: number; // tWETH, USD
  usdcPrice: number;
  alice: Side;
  bob: Side;
  trigger: number;
  target: number;
  unwinding: boolean;
};

export type Point = { block: number; alice: number; bob: number };

const WAD = 1e18;
const BASE = 1e8; // Aave base currency: USD, 8 decimals
const hfOf = (raw: bigint) => (raw > 10n ** 30n ? Infinity : Number(raw) / WAD);

function side(account: readonly bigint[], weth: bigint, usdc: bigint, price: number, usdcPrice: number): Side {
  const collateralUsd = Number(account[0]) / BASE;
  const debtUsd = Number(account[1]) / BASE;
  const walletUsd = (Number(weth) / 1e18) * price + (Number(usdc) / 1e6) * usdcPrice;
  return { hf: hfOf(account[5]!), collateralUsd, debtUsd, walletUsd, equityUsd: collateralUsd - debtUsd + walletUsd };
}

const multicall3 = testnetChain.contracts.multicall3.address;
const multicall3Abi = parseAbi(["function getBlockNumber() view returns (uint256)"]);

/** Everything the screen shows, at the latest block, in one eth_call (block number included). */
async function readSnapshot(s: DemoState, run: DemoRun): Promise<Snapshot> {
  const { alice, bob } = run;
  const bal = (token: Address, who: Address) =>
    ({ address: token, abi: testnetERC20Abi, functionName: "balanceOf", args: [who] }) as const;
  const r = await client.multicall({
    allowFailure: false,
    contracts: [
      { address: s.oracle, abi: testnetOracleAbi, functionName: "getAssetPrice", args: [s.weth] },
      { address: s.oracle, abi: testnetOracleAbi, functionName: "getAssetPrice", args: [s.usdc] },
      { address: s.pool, abi: testnetPoolAbi, functionName: "getUserAccountData", args: [alice] },
      { address: s.pool, abi: testnetPoolAbi, functionName: "getUserAccountData", args: [bob] },
      bal(s.weth, alice),
      bal(s.usdc, alice),
      bal(s.weth, bob),
      bal(s.usdc, bob),
      { address: s.shield, abi: liquidationShieldAbi, functionName: "getConfig", args: [bob] },
      { address: multicall3, abi: multicall3Abi, functionName: "getBlockNumber" },
    ],
  });
  const price = Number(r[0]) / BASE;
  const usdcPrice = Number(r[1]) / BASE;
  return {
    block: r[9],
    price,
    usdcPrice,
    alice: side(r[2], r[4], r[5], price, usdcPrice),
    bob: side(r[3], r[6], r[7], price, usdcPrice),
    trigger: Number(r[8].triggerHF) / WAD,
    target: Number(r[8].targetHF) / WAD,
    unwinding: r[8].unwinding,
  };
}

/** Latest snapshot plus one chart point per block. Cleared when the run changes (Reset). */
export function useBlockFeed(s: DemoState | undefined) {
  const [snap, setSnap] = useState<Snapshot>();
  const [points, setPoints] = useState<Point[]>([]);
  const [blockTime, setBlockTime] = useState(0.4);
  const seen = useRef<{ block: bigint; t: number }>(undefined);
  const run = s?.run;

  useEffect(() => {
    if (!s || !run) return;
    setSnap(undefined);
    setPoints([]);
    // One read at a time, ~every block (0.3–0.4s). Same block twice → no new point.
    let stopped = false;
    void (async () => {
      while (!stopped) {
        const started = performance.now();
        try {
          const x = await readSnapshot(s, run);
          if (stopped) break;
          // Rolling block-time estimate, for "heartbeat Xs ago".
          const prev = seen.current;
          if (prev && x.block > prev.block) {
            setBlockTime((bt) => bt * 0.8 + ((started - prev.t) / 1000 / Number(x.block - prev.block)) * 0.2);
          }
          if (!prev || x.block > prev.block) {
            seen.current = { block: x.block, t: started };
            setSnap(x);
            setPoints((p) => [...p.slice(-899), { block: Number(x.block), alice: clampHf(x.alice.hf), bob: clampHf(x.bob.hf) }]);
          }
        } catch {
          // transient RPC error (e.g. 429): back off a little
          await sleep(1_000);
        }
        await sleep(Math.max(0, 350 - (performance.now() - started)));
      }
    })();
    return () => {
      stopped = true;
    };
    // Re-subscribe only when the run or deployment changes, not on every state poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.n, run?.alice, s?.shield]);

  return { snap, points, blockTime };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clampHf = (hf: number) => (Number.isFinite(hf) ? Math.min(hf, 2) : 2);

// ------------------------------------------------------------------------------------------------ logs

export type TickerKind = "liquidation" | "step" | "unwound" | "price" | "reset";
export type TickerEvent = { id: string; kind: TickerKind; block: bigint; hash: Hex; text: string };

export type Totals = {
  penaltyUsd: number; // Alice: collateral seized − debt covered, at the oracle price of that block
  shieldCostUsd: number; // Bob: collateral sold − debt repaid (swap + flash premium + keeper fee)
  liquidations: number;
  steps: number;
};

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

async function priceAt(s: DemoState, block: bigint): Promise<number> {
  const p = await client.readContract({
    address: s.oracle,
    abi: testnetOracleAbi,
    functionName: "getAssetPrice",
    args: [s.weth],
    blockNumber: block,
  });
  return Number(p) / BASE;
}

const fmtUsd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtAmt = (n: number, d = 2) => n.toLocaleString("en-US", { maximumFractionDigits: d });

/** Chain events for the current run (Steps, Alice's liquidation) and the official keeper's last heartbeat. */
export function useLogFeed(s: DemoState | undefined) {
  const [events, setEvents] = useState<TickerEvent[]>([]);
  const [totals, setTotals] = useState<Totals>({ penaltyUsd: 0, shieldCostUsd: 0, liquidations: 0, steps: 0 });
  const [heartbeat, setHeartbeat] = useState<{ block: bigint; hash: Hex }>();
  const [head, setHead] = useState<bigint>();
  const run = s?.run;

  useEffect(() => {
    if (!s || !run) return;
    setEvents([]);
    setTotals({ penaltyUsd: 0, shieldCostUsd: 0, liquidations: 0, steps: 0 });
    let cursor: bigint | undefined;
    let polling = false;
    let stopped = false;
    const keeper = s.keeper.toLowerCase();
    const bob = run.bob.toLowerCase();

    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const latest = await client.getBlockNumber();
        setHead(latest);
        // Backfill from the run start, but at most ~1000 blocks (heartbeats are every 10 blocks).
        let next = cursor ?? (BigInt(run.startBlock) > latest - 1000n ? BigInt(run.startBlock) : latest - 1000n);
        while (!stopped && next <= latest) {
          const fromBlock = next;
          const toBlock = next + 99n < latest ? next + 99n : latest;
          const [shieldRaw, burns] = await Promise.all([
            client.getLogs({ address: s.shield, fromBlock, toBlock }),
            client.getLogs({
              address: [s.aWeth, s.vUsdc],
              event: transferEvent,
              args: { from: run.alice, to: zeroAddress },
              fromBlock,
              toBlock,
            }),
          ]);
          if (stopped) return;
          await ingest(
            parseEventLogs({ abi: liquidationShieldAbi, logs: shieldRaw }),
            burns.map((b) => ({ token: b.address, block: b.blockNumber!, hash: b.transactionHash!, value: b.args.value ?? 0n })),
          );
          next = toBlock + 1n;
          cursor = next;
        }
      } catch {
        // rate limit or transient error: retry next poll from the same cursor
      } finally {
        polling = false;
      }
    };

    type ShieldLog = ReturnType<typeof parseEventLogs<typeof liquidationShieldAbi>>[number];
    type BurnLog = { token: Address; block: bigint; hash: Hex; value: bigint };

    const ingest = async (shieldLogs: ShieldLog[], burns: BurnLog[]) => {
      const out: TickerEvent[] = [];
      let penalty = 0;
      let cost = 0;
      let liquidations = 0;
      let steps = 0;

      for (const l of shieldLogs) {
        if (l.eventName === "Heartbeat" && l.args.keeper.toLowerCase() === keeper) {
          setHeartbeat((h) => (!h || l.blockNumber > h.block ? { block: l.blockNumber, hash: l.transactionHash } : h));
        } else if (l.eventName === "Protected" && l.args.user.toLowerCase() === bob) {
          const { hfBefore, hfAfter, debtRepaid, collateralSold } = l.args;
          const p = await priceAt(s, l.blockNumber);
          const sold = Number(collateralSold) / 1e18;
          const repaid = Number(debtRepaid) / 1e6;
          cost += sold * p - repaid;
          steps++;
          out.push({
            id: `${l.transactionHash}-${l.logIndex}`,
            kind: "step",
            block: l.blockNumber,
            hash: l.transactionHash,
            text: `Shield Step · Bob HF ${(Number(hfBefore) / WAD).toFixed(3)} → ${(Number(hfAfter) / WAD).toFixed(3)} · repaid ${fmtAmt(repaid, 0)} tUSDC, sold ${fmtAmt(sold, 3)} tWETH`,
          });
        } else if (l.eventName === "UnwindComplete" && l.args.user.toLowerCase() === bob) {
          out.push({
            id: `${l.transactionHash}-${l.logIndex}`,
            kind: "unwound",
            block: l.blockNumber,
            hash: l.transactionHash,
            text: "Unwind complete · Bob back at target HF",
          });
        }
      }

      // A liquidation burns Alice's atWETH (seized) and variable debt (covered) in one tx.
      const byTx = new Map<Hex, { block: bigint; seized: bigint; covered: bigint }>();
      for (const b of burns) {
        const e = byTx.get(b.hash) ?? { block: b.block, seized: 0n, covered: 0n };
        if (b.token.toLowerCase() === s.aWeth.toLowerCase()) e.seized += b.value;
        else e.covered += b.value;
        byTx.set(b.hash, e);
      }
      for (const [hash, e] of byTx) {
        if (e.seized === 0n || e.covered === 0n) continue; // not a liquidation
        const p = await priceAt(s, e.block);
        const seized = Number(e.seized) / 1e18;
        const covered = Number(e.covered) / 1e6;
        const pen = seized * p - covered;
        penalty += pen;
        liquidations++;
        out.push({
          id: hash,
          kind: "liquidation",
          block: e.block,
          hash,
          text: `LIQUIDATED · Alice lost ${fmtAmt(seized, 3)} tWETH for ${fmtAmt(covered, 0)} tUSDC of debt · penalty ${fmtUsd(pen)}`,
        });
      }

      if (out.length) setEvents((ev) => [...ev, ...out]);
      if (steps || liquidations) {
        setTotals((t) => ({
          penaltyUsd: t.penaltyUsd + penalty,
          shieldCostUsd: t.shieldCostUsd + cost,
          liquidations: t.liquidations + liquidations,
          steps: t.steps + steps,
        }));
      }
    };

    void poll();
    const id = setInterval(poll, 1_500);
    return () => {
      stopped = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.n, run?.alice, s?.shield]);

  return { events, totals, heartbeat, head };
}

/** Operator txs (price moves, resets) for the current run, as ticker lines. */
export function operatorEvents(s: DemoState | undefined): TickerEvent[] {
  if (!s?.run) return [];
  const start = BigInt(s.run.startBlock);
  const opened = s.txs.filter((t) => t.kind === "reset" && BigInt(t.block) <= start).at(-1); // this run's Reset
  const prices = s.txs.filter((t) => t.kind === "price" && BigInt(t.block) >= start).slice(-60);
  return [...(opened ? [opened] : []), ...prices].map((t) => ({
      id: t.hash,
      kind: t.kind,
      block: BigInt(t.block),
      hash: t.hash,
      text: t.kind === "reset" ? `Reset · run ${s.run!.n} · fresh Alice & Bob at HF 1.30, tWETH → $3,000` : priceLine(t.label),
    }));
}

function priceLine(label: string): string {
  const m = label.match(/^(.*?)\s*→\s*(\$[\d.]+)$/);
  if (!m) return label;
  const price = Number(m[2]!.slice(1)).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return `Price · tWETH → ${price} · ${m[1]}`;
}
