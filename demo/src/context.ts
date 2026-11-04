// Env, clients and transaction confirmation for the demo scripts (BRIEF §9, §17).
// Keys are testnet-only and come from the root `.env` (never committed).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  type Account,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
  type Chain,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import {
  assertTestnet,
  explorerTxUrl,
  testnetChain,
  testnetTransport,
  type Deployments,
} from "@liquidation-shield/shared";

export type Wallet = WalletClient<Transport, Chain, Account>;

export type Context = {
  client: PublicClient<Transport, Chain>;
  operator: Wallet;
  walletFor: (account: Account) => Wallet;
};

const DEPLOYMENTS_PATH = fileURLToPath(new URL("../.deployments.json", import.meta.url));
export const WEB_ENV_PATH = fileURLToPath(new URL("../../web/.env.local", import.meta.url));

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}. See .env.example.`);
  return v;
}

export function account(keyEnv: string): Account {
  return privateKeyToAccount(env(keyEnv) as Hex);
}

/** Run n's Alice (index 2n) and Bob (index 2n+1), derived from DEMO_MNEMONIC. */
export function runAccounts(n: number): { alice: Account; bob: Account } {
  const mnemonic = env("DEMO_MNEMONIC");
  return {
    alice: mnemonicToAccount(mnemonic, { addressIndex: 2 * n }),
    bob: mnemonicToAccount(mnemonic, { addressIndex: 2 * n + 1 }),
  };
}

/** Clients for Monad testnet. Refuses to run against any other chain id. */
export async function connect(): Promise<Context> {
  const transport = testnetTransport({ rpcUrl: process.env.RPC_URL, wsUrl: process.env.WS_URL });
  const client = createPublicClient({ chain: testnetChain, transport, pollingInterval: 200 });
  await assertTestnet(client);
  const walletFor = (a: Account) => createWalletClient({ account: a, chain: testnetChain, transport });
  return { client, operator: walletFor(account("OPERATOR_PRIVATE_KEY")), walletFor };
}

/** Waits for `hash`, throws if it reverted, and prints the label with its explorer link. */
export async function confirm(ctx: Context, label: string, hash: Promise<Hex> | Hex): Promise<Hex> {
  const h = await hash;
  const receipt = await ctx.client.waitForTransactionReceipt({ hash: h });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${explorerTxUrl(h)}`);
  console.log(`✓ ${label.padEnd(34)} ${explorerTxUrl(h)}`);
  return h;
}

export function readDeployments(): Deployments {
  if (!existsSync(DEPLOYMENTS_PATH)) throw new Error("No demo/.deployments.json. Run `npm run demo:deploy` first.");
  return JSON.parse(readFileSync(DEPLOYMENTS_PATH, "utf8")) as Deployments;
}

export function writeDeployments(d: Deployments): void {
  writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(d, null, 2) + "\n");
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
