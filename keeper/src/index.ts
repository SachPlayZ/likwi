// Entry point: `npm run keeper`. Env is documented in keeper/.env.example.
import {
  assertChain,
  buildTransports,
  createKeeperPublicClient,
  createKeeperWalletClient,
  makeFallbackTransport,
} from "./clients";
import { ConfigError, loadConfig } from "./config";
import { jsonLogger } from "./log";
import { Keeper } from "./loop";
import { startStatusServer } from "./status";

const log = jsonLogger();

async function main() {
  try {
    process.loadEnvFile(".env"); // keeper/.env, if present; real env vars still win
  } catch {
    // no .env file: use the shell environment
  }
  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }

  const transport = makeFallbackTransport(buildTransports(cfg));
  const publicClient = createKeeperPublicClient(transport, cfg.chain);
  try {
    await assertChain(publicClient, cfg.chain);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  const walletClient = createKeeperWalletClient(transport, cfg.chain, cfg.privateKey);
  const keeper = new Keeper({ config: cfg.keeper, publicClient, walletClient, log });
  const server = startStatusServer(keeper, cfg.statusPort, log);

  log("info", "keeper starting", {
    chain: cfg.chain,
    keeper: walletClient.account.address,
    shield: cfg.keeper.shield,
    users: cfg.keeper.users ?? "from events",
    ws: Boolean(cfg.wsUrl),
    dryRun: cfg.keeper.dryRun,
    explorer: cfg.keeper.explorerUrl,
  });
  keeper.start({ poll: !cfg.wsUrl });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log("info", "shutting down", { signal });
    await keeper.stop();
    server.close();
    log("info", "stopped", keeper.status().stats);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

await main();
