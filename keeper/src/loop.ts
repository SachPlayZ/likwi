// The Keeper: one tick per block. sync registry → previewProtect every user (bounded concurrency) →
// protect those whose action isn't None → heartbeat every N blocks. Ticks never overlap and never throw.
import { formatUnits, maxUint256, type Address, type Hex } from "viem";
import { liquidationShieldAbi } from "@liquidation-shield/shared";
import type { KeeperPublicClient, KeeperWalletClient } from "./clients";
import { Executor } from "./executor";
import { errorMessage, type Logger } from "./log";
import { UserRegistry } from "./registry";

export type KeeperConfig = {
  shield: Address;
  deployBlock: bigint;
  logChunk: bigint;
  concurrency: number;
  heartbeatEveryBlocks: bigint;
  /** Static user list (USERS env): skips log backfill. */
  users?: readonly Address[];
  dryRun: boolean;
  /** Block explorer base URL; each tx is logged with `${explorerUrl}/tx/${hash}`. */
  explorerUrl?: string;
};

export type ActionName = "None" | "Step" | "ClearUnwind";
const ACTIONS: readonly ActionName[] = ["None", "Step", "ClearUnwind"];

export type UserStatus = {
  user: Address;
  /** HF as a decimal string; null when the Position has no debt. */
  hf: string | null;
  action: ActionName;
  unwinding: boolean;
  /** Why the last preview read failed, if it did (the user stays listed with its last known values). */
  readError?: string;
  lastTx?: Hex;
  lastTxUrl?: string;
  lastError?: string;
};

export type TickOutcome = { status: "ok" | "skipped" | "error" };

type Preview = { action: number; healthFactor: bigint };

type Deps = {
  config: KeeperConfig;
  publicClient: Pick<
    KeeperPublicClient,
    "getLogs" | "readContract" | "simulateContract" | "waitForTransactionReceipt" | "watchBlockNumber"
  >;
  walletClient: Pick<KeeperWalletClient, "writeContract" | "account">;
  log: Logger;
};

export class Keeper {
  readonly #config: KeeperConfig;
  readonly #client: Deps["publicClient"];
  readonly #log: Logger;
  readonly #registry: UserRegistry;
  readonly #executor: Executor;
  readonly #users = new Map<Address, Omit<UserStatus, "lastTx" | "lastError">>();
  readonly #stats = { ticks: 0, skippedTicks: 0, failures: 0 };

  #running = false;
  #lastHeartbeat: bigint | null = null;
  #lastBlock: bigint | null = null;
  #latestSeen: bigint | null = null;
  #lastTickMs = 0;
  #lastTickAt = 0;
  #unwatch: (() => void) | null = null;

  constructor({ config, publicClient, walletClient, log }: Deps) {
    this.#config = config;
    this.#client = publicClient;
    this.#log = log;
    this.#registry = new UserRegistry(publicClient, config.shield, config.deployBlock, config.logChunk, config.users);
    this.#executor = new Executor({
      publicClient,
      walletClient,
      shield: config.shield,
      dryRun: config.dryRun,
      explorerUrl: config.explorerUrl,
      log,
    });
  }

  async tick(block: bigint): Promise<TickOutcome> {
    if (this.#latestSeen === null || block > this.#latestSeen) this.#latestSeen = block;
    if (this.#running) {
      this.#stats.skippedTicks++;
      return { status: "skipped" };
    }
    this.#running = true;
    const started = Date.now();
    try {
      await this.#registry.sync(block);
      const users = this.#registry.users();
      await mapLimit(users, this.#config.concurrency, (user) => this.#check(user));
      for (const user of this.#users.keys()) if (!users.includes(user)) this.#users.delete(user);
      this.#maybeHeartbeat(block);
      this.#stats.ticks++;
      return { status: "ok" };
    } catch (e) {
      this.#stats.failures++;
      this.#log("warn", "tick failed", { block, error: errorMessage(e) });
      return { status: "error" };
    } finally {
      this.#running = false;
      this.#lastBlock = block;
      this.#lastTickMs = Date.now() - started;
      this.#lastTickAt = Date.now();
    }
  }

  /** Subscribes to new blocks (WebSocket subscription when available, else 200ms polling). */
  start(opts: { poll: boolean }): void {
    this.#unwatch = this.#client.watchBlockNumber({
      onBlockNumber: (n) => void this.tick(n),
      onError: (e) => this.#log("warn", "block watch error", { error: errorMessage(e) }),
      emitOnBegin: true,
      poll: opts.poll ? true : undefined,
      pollingInterval: 200,
    });
  }

  /** Stops watching blocks and waits for in-flight txs. */
  async stop(): Promise<void> {
    this.#unwatch?.();
    this.#unwatch = null;
    await this.drain();
  }

  drain(): Promise<void> {
    return this.#executor.drain();
  }

  status() {
    const ex = this.#executor.stats;
    return {
      users: [...this.#users.values()].map((u): UserStatus => ({ ...u, ...this.#executor.state(u.user) })),
      stats: {
        ticks: this.#stats.ticks,
        skippedTicks: this.#stats.skippedTicks,
        protects: ex.protects,
        heartbeats: ex.heartbeats,
        dryRuns: ex.dryRuns,
        failures: this.#stats.failures + ex.failures,
      },
    };
  }

  health(now = Date.now()) {
    const lastBlock = this.#lastBlock === null ? null : Number(this.#lastBlock);
    const lag = this.#latestSeen !== null && this.#lastBlock !== null ? Number(this.#latestSeen - this.#lastBlock) : null;
    return {
      ok: this.#lastTickAt > 0 && now - this.#lastTickAt < 15_000,
      lastBlock,
      lastTickMs: this.#lastTickMs,
      lagBlocks: lag,
    };
  }

  async #check(user: Address): Promise<void> {
    try {
      const [preview, config] = await Promise.all([
        this.#client.readContract({
          address: this.#config.shield,
          abi: liquidationShieldAbi,
          functionName: "previewProtect",
          args: [user],
        }) as Promise<Preview>,
        this.#client.readContract({
          address: this.#config.shield,
          abi: liquidationShieldAbi,
          functionName: "getConfig",
          args: [user],
        }) as Promise<{ unwinding: boolean }>,
      ]);
      const action = ACTIONS[preview.action] ?? "None";
      this.#users.set(user, { user, hf: formatHf(preview.healthFactor), action, unwinding: config.unwinding });
      // ClearUnwind is dispatched too: it ends a stale Unwind (no fee earned).
      if (action !== "None") this.#executor.protect(user, action);
    } catch (e) {
      this.#stats.failures++;
      const readError = errorMessage(e);
      const prev = this.#users.get(user) ?? { user, hf: null, action: "None" as const, unwinding: false };
      this.#users.set(user, { ...prev, readError });
      this.#log("warn", "preview failed", { user, error: readError });
    }
  }

  #maybeHeartbeat(block: bigint) {
    const every = this.#config.heartbeatEveryBlocks;
    if (this.#lastHeartbeat !== null && block - this.#lastHeartbeat < every) return;
    if (this.#executor.heartbeat()) this.#lastHeartbeat = block;
  }
}

function formatHf(hf: bigint): string | null {
  return hf === maxUint256 ? null : formatUnits(hf, 18);
}

async function mapLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}
