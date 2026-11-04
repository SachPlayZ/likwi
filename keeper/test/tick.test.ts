// Keeper behaviour, tested only through `tick` with injected viem clients (CLAUDE.md test seam 2).
import { describe, expect, it, vi } from "vitest";
import { custom, decodeFunctionData, encodeFunctionResult, type Address, type Hex } from "viem";
import { liquidationShieldAbi } from "@liquidation-shield/shared";
import { Keeper, type KeeperConfig } from "../src/loop";
import { createKeeperPublicClient, makeFallbackTransport } from "../src/clients";

const SHIELD = "0x5111e1d000000000000000000000000000000001" as Address;
const KEEPER = "0x4ee9e40000000000000000000000000000000004" as Address;
const BOB = "0xb0b0000000000000000000000000000000000b0b" as Address;
const CAROL = "0xca401000000000000000000000000000000ca401" as Address;

const NONE = 0, STEP = 1, CLEAR = 2;
type Preview = { action: number; healthFactor: bigint; repayAmount: bigint; estCollateralSold: bigint };
const preview = (action: number, hf = 1_100000000000000000n): Preview => ({
  action,
  healthFactor: hf,
  repayAmount: action === STEP ? 1_000_000_000n : 0n,
  estCollateralSold: 0n,
});

type Log = { eventName: "Registered" | "Unregistered"; args: { user: Address }; blockNumber: bigint; logIndex: number };
const reg = (user: Address, block: bigint, logIndex = 0): Log => ({ eventName: "Registered", args: { user }, blockNumber: block, logIndex });
const unreg = (user: Address, block: bigint, logIndex = 0): Log => ({ eventName: "Unregistered", args: { user }, blockNumber: block, logIndex });

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** A stubbed chain: previews per user, registry logs, and controllable receipts. */
function fakeChain() {
  const previews = new Map<Address, Preview>();
  const logs: Log[] = [];
  let holdReceipts = false;
  const held: Array<() => void> = [];
  let nonce = 0;
  let readGate: Promise<void> | null = null;

  const publicClient = {
    getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
      logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock),
    ),
    readContract: vi.fn(async ({ functionName, args }: { functionName: string; args: [Address] }) => {
      if (readGate) await readGate;
      if (functionName === "previewProtect") return previews.get(args[0]) ?? preview(NONE, 2n * 10n ** 18n);
      if (functionName === "getConfig") return { active: true, unwinding: false };
      throw new Error(`unexpected read ${functionName}`);
    }),
    simulateContract: vi.fn(async (req: { functionName: string; args?: unknown[] }) => ({ request: req })),
    waitForTransactionReceipt: vi.fn(async () => {
      if (holdReceipts) await new Promise<void>((r) => held.push(r));
      return { status: "success" as const };
    }),
  };
  const walletClient = {
    account: { address: KEEPER },
    writeContract: vi.fn(async (_req: { functionName: string; args?: unknown[] }) => `0x${(++nonce).toString(16).padStart(64, "0")}` as Hex),
  };

  const writes = (fn?: string) =>
    walletClient.writeContract.mock.calls.map((c) => c[0]).filter((r) => !fn || r.functionName === fn);

  return {
    previews,
    logs,
    publicClient,
    walletClient,
    writes,
    hold: () => (holdReceipts = true),
    release: () => {
      holdReceipts = false;
      held.splice(0).forEach((r) => r());
    },
    gateReads: () => {
      const d = deferred();
      readGate = d.promise;
      return () => {
        readGate = null;
        d.resolve();
      };
    },
  };
}

const baseConfig = (over: Partial<KeeperConfig> = {}): KeeperConfig => ({
  shield: SHIELD,
  deployBlock: 0n,
  logChunk: 1000n,
  concurrency: 4,
  heartbeatEveryBlocks: 1000n, // effectively off unless a test turns it on
  users: undefined,
  dryRun: false,
  ...over,
});

function makeKeeper(chain: ReturnType<typeof fakeChain>, over: Partial<KeeperConfig> = {}) {
  return new Keeper({
    config: baseConfig(over),
    publicClient: chain.publicClient as never,
    walletClient: chain.walletClient as never,
    log: () => {},
  });
}

describe("tick", () => {
  it("skips a tick while the previous one is still running", async () => {
    const chain = fakeChain();
    const k = makeKeeper(chain, { users: [BOB] });
    const open = chain.gateReads();

    const first = k.tick(1n);
    expect(await k.tick(2n)).toEqual({ status: "skipped" });
    open();
    expect((await first).status).toBe("ok");
    expect((await k.tick(3n)).status).toBe("ok");
    expect(k.status().stats.skippedTicks).toBe(1);
  });

  it("keeps at most one in-flight transaction per user", async () => {
    const chain = fakeChain();
    chain.previews.set(BOB, preview(STEP));
    const k = makeKeeper(chain, { users: [BOB] });
    chain.hold();

    await k.tick(1n);
    await vi.waitFor(() => expect(chain.writes("protect")).toHaveLength(1)); // tx 1 is out, receipt pending
    await k.tick(2n);
    await new Promise((r) => setTimeout(r, 10));
    expect(chain.writes("protect")).toHaveLength(1);

    chain.release();
    await k.drain();
    await k.tick(3n);
    await k.drain();
    expect(chain.writes("protect")).toHaveLength(2);
    expect(k.status().stats.protects).toBe(2);
  });

  it("simulates before writing protect", async () => {
    const chain = fakeChain();
    chain.previews.set(BOB, preview(STEP));
    const k = makeKeeper(chain, { users: [BOB] });
    await k.tick(1n);
    await k.drain();

    const sim = chain.publicClient.simulateContract.mock.invocationCallOrder[0];
    const write = chain.walletClient.writeContract.mock.invocationCallOrder[0];
    expect(sim).toBeLessThan(write);
    expect(chain.writes("protect")[0].args).toEqual([BOB]);
  });

  it("does nothing for users whose action is None", async () => {
    const chain = fakeChain();
    chain.previews.set(BOB, preview(NONE));
    const k = makeKeeper(chain, { users: [BOB] });
    await k.tick(1n);
    await k.drain();
    expect(chain.writes("protect")).toHaveLength(0);
    expect(k.status().users[0]).toMatchObject({ user: BOB, action: "None" });
  });

  it("dispatches protect for a ClearUnwind preview", async () => {
    const chain = fakeChain();
    chain.previews.set(BOB, preview(CLEAR, 1_395000000000000000n));
    const k = makeKeeper(chain, { users: [BOB] });
    await k.tick(1n);
    await k.drain();
    expect(chain.writes("protect").map((w) => w.args)).toEqual([[BOB]]);
    expect(k.status().users[0]).toMatchObject({ action: "ClearUnwind" });
  });

  it("dry run simulates but never writes", async () => {
    const chain = fakeChain();
    chain.previews.set(BOB, preview(STEP));
    const k = makeKeeper(chain, { users: [BOB], dryRun: true, heartbeatEveryBlocks: 1n });
    await k.tick(1n);
    await k.drain();
    expect(chain.publicClient.simulateContract).toHaveBeenCalled();
    expect(chain.writes()).toHaveLength(0);
  });

  it("sends a heartbeat every N blocks", async () => {
    const chain = fakeChain();
    const k = makeKeeper(chain, { users: [], heartbeatEveryBlocks: 10n });
    for (let b = 100n; b <= 125n; b++) {
      await k.tick(b);
      await k.drain();
    }
    expect(chain.writes("heartbeat")).toHaveLength(3); // 100, 110, 120
    expect(k.status().stats.heartbeats).toBe(3);
  });

  it("never throws: a failed simulation is logged and counted", async () => {
    const chain = fakeChain();
    chain.previews.set(BOB, preview(STEP));
    chain.publicClient.simulateContract.mockRejectedValueOnce(new Error("NotProtectable"));
    const k = makeKeeper(chain, { users: [BOB] });

    expect((await k.tick(1n)).status).toBe("ok");
    await k.drain();
    expect(chain.writes("protect")).toHaveLength(0);
    expect(k.status().stats.failures).toBe(1);
    expect(k.status().users[0].lastError).toMatch(/NotProtectable/);

    await k.tick(2n); // retried on the next block, in-flight slot was freed
    await k.drain();
    expect(chain.writes("protect")).toHaveLength(1);
  });

  it("never throws: an RPC failure mid-tick is logged and counted", async () => {
    const chain = fakeChain();
    chain.publicClient.getLogs.mockRejectedValueOnce(new Error("rate limited"));
    const k = makeKeeper(chain);
    expect((await k.tick(5n)).status).toBe("error");
    expect(k.status().stats.failures).toBe(1);
    expect((await k.tick(6n)).status).toBe("ok");
  });

  it("keeps a user whose preview fails visible in status, with the error", async () => {
    const chain = fakeChain();
    chain.publicClient.readContract.mockRejectedValueOnce(new Error("returned no data"));
    const k = makeKeeper(chain, { users: [BOB] });
    await k.tick(1n);
    expect(k.status().users).toEqual([expect.objectContaining({ user: BOB, readError: "returned no data" })]);

    await k.tick(2n); // recovers on the next block
    expect(k.status().users[0].readError).toBeUndefined();
    expect(k.status().users[0].hf).toBe("2");
  });
});

describe("registry (through tick)", () => {
  it("dedups users across Registered → Unregistered → Registered", async () => {
    const chain = fakeChain();
    chain.logs.push(reg(BOB, 5n), unreg(BOB, 6n), reg(BOB, 7n), reg(CAROL, 7n, 1), reg(CAROL, 8n));
    const k = makeKeeper(chain);
    await k.tick(10n);

    const previewed = chain.publicClient.readContract.mock.calls
      .map((c) => c[0])
      .filter((r) => r.functionName === "previewProtect")
      .map((r) => r.args[0]);
    expect(previewed.sort()).toEqual([BOB, CAROL].sort());
    expect(k.status().users.map((u) => u.user).sort()).toEqual([BOB, CAROL].sort());
  });

  it("drops a user whose last event is Unregistered", async () => {
    const chain = fakeChain();
    chain.logs.push(reg(BOB, 5n), reg(CAROL, 5n, 1), unreg(BOB, 9n));
    const k = makeKeeper(chain);
    await k.tick(10n);
    expect(k.status().users.map((u) => u.user)).toEqual([CAROL]);
  });

  it("backfills from the deploy block in chunks, then syncs incrementally", async () => {
    const chain = fakeChain();
    const k = makeKeeper(chain, { deployBlock: 2n, logChunk: 4n });
    await k.tick(10n);
    await k.tick(11n);
    const ranges = chain.publicClient.getLogs.mock.calls.map((c) => [c[0].fromBlock, c[0].toBlock]);
    expect(ranges).toEqual([
      [2n, 5n],
      [6n, 9n],
      [10n, 10n],
      [11n, 11n],
    ]);
  });

  it("uses a static USERS list without reading logs", async () => {
    const chain = fakeChain();
    const k = makeKeeper(chain, { users: [CAROL] });
    await k.tick(10n);
    expect(chain.publicClient.getLogs).not.toHaveBeenCalled();
    expect(k.status().users.map((u) => u.user)).toEqual([CAROL]);
  });
});

describe("RPC fallback", () => {
  it("falls back to the next RPC when the provider fails", async () => {
    const down = vi.fn(async () => {
      throw new Error("provider down");
    });
    const up = vi.fn(async ({ method, params }: { method: string; params: unknown[] }) => {
      if (method === "eth_chainId") return "0x279f"; // 10143
      if (method === "eth_call") {
        const { data } = (params as [{ data: Hex }])[0];
        const { functionName } = decodeFunctionData({ abi: liquidationShieldAbi, data });
        if (functionName === "previewProtect") {
          return encodeFunctionResult({
            abi: liquidationShieldAbi,
            functionName: "previewProtect",
            result: { action: 0, healthFactor: 1_300000000000000000n, repayAmount: 0n, estCollateralSold: 0n },
          });
        }
        if (functionName === "getConfig") {
          return encodeFunctionResult({
            abi: liquidationShieldAbi,
            functionName: "getConfig",
            result: {
              collateralAsset: BOB,
              debtAsset: CAROL,
              triggerHF: 1_150000000000000000n,
              targetHF: 1_400000000000000000n,
              maxStepBps: 2500,
              maxSlippageBps: 100,
              active: true,
              unwinding: false,
            },
          });
        }
      }
      throw new Error(`unexpected ${method}`);
    });

    const transport = makeFallbackTransport([
      custom({ request: down }, { retryCount: 0 }),
      custom({ request: up }, { retryCount: 0 }),
    ]);
    const publicClient = createKeeperPublicClient(transport, "testnet");
    const chain = fakeChain();
    const k = new Keeper({
      config: baseConfig({ users: [BOB] }),
      publicClient,
      walletClient: chain.walletClient as never,
      log: () => {},
    });

    expect((await k.tick(1n)).status).toBe("ok");
    expect(down).toHaveBeenCalled();
    expect(up).toHaveBeenCalled();
    expect(k.status().users[0]).toMatchObject({ user: BOB, action: "None", hf: "1.3" });
  });
});
