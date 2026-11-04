// Registered users, from on-chain events (no database: BRIEF §5.11).
import { getAbiItem, type Address } from "viem";
import { liquidationShieldAbi } from "@liquidation-shield/shared";
import type { KeeperPublicClient } from "./clients";

const EVENTS = [
  getAbiItem({ abi: liquidationShieldAbi, name: "Registered" }),
  getAbiItem({ abi: liquidationShieldAbi, name: "Unregistered" }),
];

type RegistryLog = {
  eventName: "Registered" | "Unregistered";
  args: { user?: Address };
  blockNumber: bigint | null;
  logIndex: number | null;
};

/**
 * Backfills `Registered` / `Unregistered` from the deploy block in chunks, then syncs incrementally.
 * The cursor only advances after a chunk succeeds, so a failed sync is retried from the same block.
 * A static user list (USERS env) skips logs entirely.
 */
export class UserRegistry {
  readonly #users = new Set<Address>();
  #next: bigint;

  constructor(
    private readonly client: Pick<KeeperPublicClient, "getLogs">,
    private readonly shield: Address,
    deployBlock: bigint,
    private readonly chunk: bigint,
    private readonly staticUsers?: readonly Address[],
  ) {
    this.#next = deployBlock;
  }

  async sync(toBlock: bigint): Promise<void> {
    if (this.staticUsers) return;
    while (this.#next <= toBlock) {
      const to = this.#next + this.chunk - 1n < toBlock ? this.#next + this.chunk - 1n : toBlock;
      const logs = (await this.client.getLogs({
        address: this.shield,
        events: EVENTS,
        fromBlock: this.#next,
        toBlock: to,
      })) as unknown as RegistryLog[];
      for (const log of [...logs].sort(byPosition)) this.#apply(log);
      this.#next = to + 1n;
    }
  }

  users(): Address[] {
    return this.staticUsers ? [...this.staticUsers] : [...this.#users];
  }

  #apply(log: RegistryLog) {
    const user = log.args.user;
    if (!user) return;
    if (log.eventName === "Registered") this.#users.add(user);
    else this.#users.delete(user);
  }
}

function byPosition(a: RegistryLog, b: RegistryLog): number {
  const ba = a.blockNumber ?? 0n;
  const bb = b.blockNumber ?? 0n;
  if (ba !== bb) return ba < bb ? -1 : 1;
  return (a.logIndex ?? 0) - (b.logIndex ?? 0);
}
