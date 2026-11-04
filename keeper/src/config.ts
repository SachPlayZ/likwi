// Env → config. Fails fast with every problem listed at once.
import { isAddress, type Address, type Hex } from "viem";
import { CHAINS, type ChainName } from "./clients";
import type { KeeperConfig } from "./loop";

export type AppConfig = {
  keeper: KeeperConfig;
  chain: ChainName;
  rpcUrl: string;
  wsUrl?: string;
  publicRpcUrl: string;
  privateKey: Hex;
  statusPort: number;
};

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const problems: string[] = [];
  const need = (name: string) => {
    const v = env[name]?.trim();
    if (!v) problems.push(`${name} is required`);
    return v ?? "";
  };
  const uint = (name: string, fallback: string) => {
    const v = (env[name]?.trim() || fallback);
    if (!/^\d+$/.test(v)) problems.push(`${name} must be a non-negative integer (got "${v}")`);
    return /^\d+$/.test(v) ? BigInt(v) : 0n;
  };

  const chainRaw = env.CHAIN?.trim() || "testnet";
  if (!(chainRaw in CHAINS)) problems.push(`CHAIN must be one of ${Object.keys(CHAINS).join(", ")} (got "${chainRaw}")`);
  const chain = (chainRaw in CHAINS ? chainRaw : "testnet") as ChainName;

  const rpcUrl = need("RPC_URL");
  const wsUrl = env.WS_URL?.trim() || undefined;
  const privateKey = need("KEEPER_PRIVATE_KEY");
  if (privateKey && !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) problems.push("KEEPER_PRIVATE_KEY must be 0x + 64 hex chars");
  const shield = need("SHIELD_ADDRESS");
  if (shield && !isAddress(shield)) problems.push(`SHIELD_ADDRESS is not an address (got "${shield}")`);

  const users = env.USERS?.trim()
    ? env.USERS.split(",").map((u) => u.trim()).filter(Boolean)
    : undefined;
  for (const u of users ?? []) if (!isAddress(u)) problems.push(`USERS contains a bad address: "${u}"`);

  const deployBlock = users ? uint("DEPLOY_BLOCK", "0") : uint("DEPLOY_BLOCK", "");
  const heartbeat = uint("HEARTBEAT_EVERY_BLOCKS", "10");
  const logChunk = uint("LOG_CHUNK", "1000");
  const concurrency = uint("CONCURRENCY", "16");
  const statusPort = uint("STATUS_PORT", "8787");
  if (heartbeat === 0n) problems.push("HEARTBEAT_EVERY_BLOCKS must be ≥ 1");
  if (logChunk === 0n) problems.push("LOG_CHUNK must be ≥ 1");
  if (concurrency === 0n) problems.push("CONCURRENCY must be ≥ 1");

  const dryRaw = (env.DRY_RUN?.trim() || "false").toLowerCase();
  if (!["true", "false", "1", "0"].includes(dryRaw)) problems.push(`DRY_RUN must be true or false (got "${dryRaw}")`);

  if (problems.length) throw new ConfigError(`Invalid keeper config:\n  - ${problems.join("\n  - ")}`);

  return {
    chain,
    rpcUrl,
    wsUrl,
    publicRpcUrl: env.PUBLIC_RPC_URL?.trim() || CHAINS[chain].rpcUrls.default.http[0],
    privateKey: privateKey as Hex,
    statusPort: Number(statusPort),
    keeper: {
      shield: shield as Address,
      deployBlock,
      logChunk,
      concurrency: Number(concurrency),
      heartbeatEveryBlocks: heartbeat,
      users: users as Address[] | undefined,
      dryRun: dryRaw === "true" || dryRaw === "1",
    },
  };
}
