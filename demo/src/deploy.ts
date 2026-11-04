// `demo deploy` (BRIEF §9): the test pool, the oracle adapter and the Shield, plus gas and tokens for the bots.
import { writeFileSync } from "node:fs";
import { parseEther, type Address, type Hex } from "viem";
import {
  liquidationShieldAbi,
  liquidationShieldBytecode,
  oracleSwapAdapterAbi,
  oracleSwapAdapterBytecode,
  testnetAaveAbi,
  testnetAaveBytecode,
  testnetERC20Abi,
  testnetPoolAbi,
  explorerTxUrl,
  type Deployments,
} from "@liquidation-shield/shared";
import { account, confirm, WEB_ENV_PATH, writeDeployments, type Context } from "./context";

const ADAPTER_FEE_BPS = 30;
const KEEPER_FEE_BPS = 10;
const ADAPTER_INVENTORY_USDC = 10_000_000n * 10n ** 6n;
const LIQUIDATOR_USDC = 1_000_000n * 10n ** 6n;

async function deployed(ctx: Context, label: string, hash: Hex): Promise<Address> {
  const receipt = await ctx.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${label} deploy failed`);
  console.log(`✓ ${`deploy ${label}`.padEnd(34)} ${explorerTxUrl(hash)}`);
  return receipt.contractAddress;
}

export async function deployAll(ctx: Context): Promise<Deployments> {
  const { client, operator } = ctx;
  const op = operator.account.address;
  const keeper = account("KEEPER_PRIVATE_KEY").address;
  const liquidator = account("LIQUIDATOR_PRIVATE_KEY").address;

  const testnetAave = await deployed(
    ctx,
    "TestnetAave",
    await operator.deployContract({ abi: testnetAaveAbi, bytecode: testnetAaveBytecode, args: [op] }),
  );
  const read = <T>(functionName: "weth" | "usdc" | "oracle" | "pool" | "addressesProvider") =>
    client.readContract({ address: testnetAave, abi: testnetAaveAbi, functionName }) as Promise<T>;
  const [weth, usdc, oracle, pool, addressesProvider] = await Promise.all([
    read<Address>("weth"),
    read<Address>("usdc"),
    read<Address>("oracle"),
    read<Address>("pool"),
    read<Address>("addressesProvider"),
  ]);
  const [aWeth, vUsdc] = await Promise.all([
    client.readContract({ address: pool, abi: testnetPoolAbi, functionName: "getReserveAToken", args: [weth] }),
    client.readContract({ address: pool, abi: testnetPoolAbi, functionName: "getReserveVariableDebtToken", args: [usdc] }),
  ]);

  const adapter = await deployed(
    ctx,
    "OracleSwapAdapter",
    await operator.deployContract({
      abi: oracleSwapAdapterAbi,
      bytecode: oracleSwapAdapterBytecode,
      args: [addressesProvider, ADAPTER_FEE_BPS, op],
    }),
  );
  const shield = await deployed(
    ctx,
    "LiquidationShield",
    await operator.deployContract({
      abi: liquidationShieldAbi,
      bytecode: liquidationShieldBytecode,
      args: [addressesProvider, adapter, KEEPER_FEE_BPS, op],
    }),
  );
  const deployBlock = (await client.getBlockNumber()).toString();

  const mint = (to: Address, amount: bigint) =>
    operator.writeContract({ address: usdc, abi: testnetERC20Abi, functionName: "mint", args: [to, amount] });
  await confirm(ctx, "mint adapter inventory (tUSDC)", mint(adapter, ADAPTER_INVENTORY_USDC));
  await confirm(ctx, "mint liquidator tUSDC", mint(liquidator, LIQUIDATOR_USDC));
  await confirm(
    ctx,
    "fund keeper (MON gas)",
    operator.sendTransaction({ to: keeper, value: parseEther(process.env.KEEPER_GAS_MON ?? "1") }),
  );
  await confirm(
    ctx,
    "fund liquidator (MON gas)",
    operator.sendTransaction({ to: liquidator, value: parseEther(process.env.LIQUIDATOR_GAS_MON ?? "0.3") }),
  );

  const d: Deployments = {
    chainId: await client.getChainId(),
    deployBlock,
    operator: op,
    keeper,
    liquidator,
    testnetAave,
    addressesProvider,
    pool,
    oracle,
    weth,
    usdc,
    aWeth,
    vUsdc,
    adapter,
    shield,
  };
  writeDeployments(d);
  writeWebEnv(d);
  return d;
}

/** Public addresses only: server-side keys never go into NEXT_PUBLIC_ vars. */
function writeWebEnv(d: Deployments): void {
  const vars: Record<string, string> = {
    NEXT_PUBLIC_CHAIN: String(d.chainId),
    NEXT_PUBLIC_SHIELD_ADDRESS: d.shield,
    NEXT_PUBLIC_POOL_ADDRESS: d.pool,
    NEXT_PUBLIC_ORACLE_ADDRESS: d.oracle,
    NEXT_PUBLIC_WETH_ADDRESS: d.weth,
    NEXT_PUBLIC_USDC_ADDRESS: d.usdc,
    NEXT_PUBLIC_AWETH_ADDRESS: d.aWeth,
    NEXT_PUBLIC_KEEPER_ADDRESS: d.keeper,
    NEXT_PUBLIC_KEEPER_URL: process.env.KEEPER_URL ?? "http://localhost:8787",
    NEXT_PUBLIC_DEPLOY_BLOCK: d.deployBlock,
  };
  writeFileSync(WEB_ENV_PATH, Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
}
