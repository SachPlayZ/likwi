// viem clients. Reads and writes go through a fallback transport: the provider RPC (WebSocket first if set),
// then the public RPC, which is rate-limited (BRIEF §7, §17.7).
import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  webSocket,
  type Account,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { monad, monadTestnet } from "viem/chains";

export const CHAINS = { monad, testnet: monadTestnet } as const;
export type ChainName = keyof typeof CHAINS;

export type KeeperPublicClient = PublicClient<Transport, Chain>;
export type KeeperWalletClient = WalletClient<Transport, Chain, Account>;

/** Tries each transport in order on errors; no ranking, so the provider stays first. */
export function makeFallbackTransport(transports: Transport[]): Transport {
  return fallback(transports, { rank: false });
}

/** Provider WS (if any) → provider HTTP → public RPC, without duplicates. */
export function buildTransports(urls: { wsUrl?: string; rpcUrl: string; publicRpcUrl: string }): Transport[] {
  const out: Transport[] = [];
  if (urls.wsUrl) out.push(webSocket(urls.wsUrl, { retryCount: 1 }));
  out.push(http(urls.rpcUrl, { retryCount: 1 }));
  if (urls.publicRpcUrl !== urls.rpcUrl) out.push(http(urls.publicRpcUrl, { retryCount: 1 }));
  return out;
}

export function createKeeperPublicClient(transport: Transport, chain: ChainName): KeeperPublicClient {
  return createPublicClient({ chain: CHAINS[chain], transport, pollingInterval: 200 }) as KeeperPublicClient;
}

/** Throws unless the RPC really serves the chain `CHAIN` names, so the keeper never signs for the wrong chain. */
export async function assertChain(client: { getChainId: () => Promise<number> }, chain: ChainName): Promise<void> {
  const expected = CHAINS[chain];
  const id = await client.getChainId();
  if (id !== expected.id) {
    throw new Error(`Refusing to run: RPC is chain ${id}, expected ${expected.name} (${expected.id}).`);
  }
}

/** The keeper key gets viem's nonce manager, so back-to-back txs don't collide. */
export function createKeeperWalletClient(transport: Transport, chain: ChainName, privateKey: Hex): KeeperWalletClient {
  const account = privateKeyToAccount(privateKey, { nonceManager });
  return createWalletClient({ account, chain: CHAINS[chain], transport }) as KeeperWalletClient;
}
