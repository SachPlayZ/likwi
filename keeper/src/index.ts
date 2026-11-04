// Minimal keeper (#15): each block, preview every user and call `protect` when the Shield has work to do.
// #17 hardens it: event-backfilled registry, /health + /status, heartbeat, vitest suite.
//
// Users: USERS (comma-separated) if set, else the current run's Alice and Bob from demo/.deployments.json,
// re-read every block so a new `demo seed` is picked up without a restart.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  assertTestnet,
  explorerTxUrl,
  liquidationShieldAbi,
  testnetChain,
  testnetTransport,
  type Deployments,
} from "@liquidation-shield/shared";

const DEPLOYMENTS_PATH = process.env.DEPLOYMENTS_FILE
  ?? fileURLToPath(new URL("../../demo/.deployments.json", import.meta.url));
const ACTIONS = ["None", "Step", "ClearUnwind"] as const;

function deployments(): Deployments | undefined {
  return existsSync(DEPLOYMENTS_PATH) ? (JSON.parse(readFileSync(DEPLOYMENTS_PATH, "utf8")) as Deployments) : undefined;
}

function shieldAddress(): Address {
  const a = (process.env.SHIELD_ADDRESS as Address | undefined) ?? deployments()?.shield;
  if (!a) throw new Error("Set SHIELD_ADDRESS or run `npm run demo:deploy` first.");
  return a;
}

function users(): Address[] {
  if (process.env.USERS) return process.env.USERS.split(",").map((u) => u.trim() as Address);
  const run = deployments()?.run;
  return run ? [run.alice, run.bob] : [];
}

const key = process.env.KEEPER_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("Missing env KEEPER_PRIVATE_KEY. See .env.example.");
const transport = testnetTransport({ rpcUrl: process.env.RPC_URL, wsUrl: process.env.WS_URL });
const client = createPublicClient({ chain: testnetChain, transport, pollingInterval: 200 });
await assertTestnet(client);
const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: testnetChain, transport });
const shield = shieldAddress();
const dryRun = process.env.DRY_RUN === "true";
console.log(`Keeper ${wallet.account.address} watching Shield ${shield}${dryRun ? " (DRY_RUN)" : ""}`);

const inFlight = new Set<Address>();
let ticking = false;

async function protect(user: Address, action: number, hf: bigint) {
  inFlight.add(user);
  try {
    const { request } = await client.simulateContract({
      account: wallet.account,
      address: shield,
      abi: liquidationShieldAbi,
      functionName: "protect",
      args: [user],
    });
    const hash = await wallet.writeContract(request);
    const receipt = await client.waitForTransactionReceipt({ hash });
    const status = receipt.status === "success" ? "✓" : "✗ reverted";
    console.log(`${status} ${ACTIONS[action]} ${user} (HF ${(Number(hf) / 1e18).toFixed(3)}) ${explorerTxUrl(hash)}`);
  } catch (e) {
    console.error(`protect(${user}) failed:`, (e as Error).message.split("\n")[0]);
  } finally {
    inFlight.delete(user);
  }
}

async function tick() {
  if (ticking) return; // never overlap ticks
  ticking = true;
  try {
    const previews = await Promise.all(
      users().map(async (user) => ({
        user,
        p: await client.readContract({ address: shield, abi: liquidationShieldAbi, functionName: "previewProtect", args: [user] }),
      })),
    );
    for (const { user, p } of previews) {
      if (p.action === 0 || inFlight.has(user)) continue; // one in-flight tx per user
      if (dryRun) console.log(`[dry run] would ${ACTIONS[p.action]} ${user}`);
      else void protect(user, p.action, p.healthFactor);
    }
  } catch (e) {
    console.error("tick failed:", (e as Error).message.split("\n")[0]);
  } finally {
    ticking = false;
  }
}

const unwatch = client.watchBlockNumber({
  emitMissed: false,
  onBlockNumber: () => void tick(),
  onError: (e) => console.error("block watch error:", e.message),
});
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (unwatch(), process.exit(0)));
