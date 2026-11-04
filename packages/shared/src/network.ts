// Monad testnet wiring shared by the demo scripts, the keeper and the web app (BRIEF §17).
import { fallback, http, webSocket, type Hex, type Transport } from "viem";
import { monadTestnet } from "viem/chains";
import { TESTNET_CHAIN_ID } from "./addresses";

export const testnetChain = monadTestnet;

const EXPLORER = testnetChain.blockExplorers.default.url;

export const explorerTxUrl = (hash: Hex) => `${EXPLORER}/tx/${hash}`;
export const explorerAddressUrl = (address: string) => `${EXPLORER}/address/${address}`;

/**
 * Provider WebSocket first (BRIEF §17.7), then the provider HTTP RPC, then the public RPC (rate-limited).
 * `rpcUrl` may also point at a local chain started with `--chain-id 10143` for dry runs.
 */
export function testnetTransport(opts: { rpcUrl?: string; wsUrl?: string }): Transport {
  // The public RPC answers bursts with 429; viem retries those, with backoff 300ms·2^n (~19s over 6 tries).
  const retry = { retryCount: 6, retryDelay: 300 };
  const transports: Transport[] = [];
  if (opts.wsUrl) transports.push(webSocket(opts.wsUrl));
  if (opts.rpcUrl) transports.push(http(opts.rpcUrl, retry));
  if (!opts.rpcUrl) transports.push(http(testnetChain.rpcUrls.default.http[0], retry));
  return transports.length === 1 ? transports[0]! : fallback(transports);
}

/** Throws unless the RPC really is chain 10143, so demo writes can never land on another chain. */
export async function assertTestnet(client: { getChainId: () => Promise<number> }): Promise<void> {
  const id = await client.getChainId();
  if (id !== TESTNET_CHAIN_ID) {
    throw new Error(`Refusing to run: RPC is chain ${id}, expected Monad testnet (${TESTNET_CHAIN_ID}).`);
  }
}
