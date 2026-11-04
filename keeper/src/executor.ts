// Sends `protect` and `heartbeat`. One in-flight tx per user (and one heartbeat), simulate before write,
// and never throws: failures are logged and counted.
import type { Address, Hex } from "viem";
import { liquidationShieldAbi } from "@liquidation-shield/shared";
import type { KeeperPublicClient, KeeperWalletClient } from "./clients";
import { errorMessage, type Logger } from "./log";

const HEARTBEAT = "heartbeat";

export type TxState = { lastTx?: Hex; lastError?: string };

export class Executor {
  readonly stats = { protects: 0, heartbeats: 0, failures: 0, dryRuns: 0 };
  readonly #inFlight = new Set<string>();
  readonly #tasks = new Set<Promise<void>>();
  readonly #state = new Map<string, TxState>();

  constructor(
    private readonly deps: {
      publicClient: Pick<KeeperPublicClient, "simulateContract" | "waitForTransactionReceipt">;
      walletClient: Pick<KeeperWalletClient, "writeContract" | "account">;
      shield: Address;
      dryRun: boolean;
      log: Logger;
    },
  ) {}

  /** Starts `protect(user)` unless one is already in flight. Returns whether it was dispatched. */
  protect(user: Address, reason: string): boolean {
    return this.#dispatch(user, "protect", [user], reason, () => this.stats.protects++);
  }

  heartbeat(): boolean {
    return this.#dispatch(HEARTBEAT, "heartbeat", [], "heartbeat", () => this.stats.heartbeats++);
  }

  state(user: Address): TxState {
    return this.#state.get(user) ?? {};
  }

  /** Waits for every in-flight tx (shutdown, tests). */
  async drain(): Promise<void> {
    while (this.#tasks.size) await Promise.allSettled([...this.#tasks]);
  }

  #dispatch(
    key: string,
    functionName: "protect" | "heartbeat",
    args: readonly [Address] | readonly [],
    reason: string,
    onSuccess: () => void,
  ): boolean {
    if (this.#inFlight.has(key)) return false;
    this.#inFlight.add(key);
    const task = this.#send(key, functionName, args, reason, onSuccess).finally(() => {
      this.#inFlight.delete(key);
      this.#tasks.delete(task);
    });
    this.#tasks.add(task);
    return true;
  }

  async #send(
    key: string,
    functionName: "protect" | "heartbeat",
    args: readonly [Address] | readonly [],
    reason: string,
    onSuccess: () => void,
  ): Promise<void> {
    const { publicClient, walletClient, shield, dryRun, log } = this.deps;
    const state = this.#state.get(key) ?? {};
    this.#state.set(key, state);
    try {
      const { request } = await publicClient.simulateContract({
        address: shield,
        abi: liquidationShieldAbi,
        functionName,
        args,
        account: walletClient.account,
      } as never);
      if (dryRun) {
        this.stats.dryRuns++;
        log("info", "dry-run: would send", { functionName, key, reason });
        return;
      }
      const hash = await walletClient.writeContract(request as never);
      state.lastTx = hash;
      log("info", "tx sent", { functionName, key, reason, hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`tx reverted: ${hash}`);
      state.lastError = undefined;
      onSuccess();
      log("info", "tx confirmed", { functionName, key, hash });
    } catch (e) {
      this.stats.failures++;
      state.lastError = errorMessage(e);
      log("warn", "tx failed", { functionName, key, reason, error: state.lastError });
    }
  }
}
