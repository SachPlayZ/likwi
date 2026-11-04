// `demo seed` (BRIEF §9, §17.4): a fresh Alice and Bob per run, both loans at HF 1.30, Bob shielded.
// It's also what the web Reset button runs.
import { maxUint256, parseEther, type Account } from "viem";
import {
  liquidationShieldAbi,
  testnetERC20Abi,
  testnetOracleAbi,
  testnetPoolAbi,
  type Deployments,
} from "@liquidation-shield/shared";
import { confirm, runAccounts, writeDeployments, type Context } from "./context";

export const START_PRICE = 3000n * 10n ** 8n; // $3000, 8-dec base currency
const COLLATERAL = 20n * 10n ** 18n; // 20 tWETH
const LT_BPS = 8250n;
const START_HF = 1_300n; // 1.30, in thousandths

// Bob's Shield config (BRIEF §9): trigger 1.15, target 1.40, step 25%, slippage 1%.
const BOB_CONFIG = { trigger: 1_150_000_000_000_000_000n, target: 1_400_000_000_000_000_000n, step: 2500, slippage: 100 };

/** tUSDC to borrow so 20 tWETH at $3000 sits at HF 1.30: C·LT / 1.30, converted from 8-dec base to 6 dec. */
export function borrowForStartHf(): bigint {
  const collateralBase = (COLLATERAL * START_PRICE) / 10n ** 18n;
  return (collateralBase * LT_BPS * 1_000n) / (10_000n * START_HF) / 100n;
}

export async function setPrice(ctx: Context, d: Deployments, price: bigint, label: string) {
  return confirm(
    ctx,
    label,
    ctx.operator.writeContract({ address: d.oracle, abi: testnetOracleAbi, functionName: "setAssetPrice", args: [d.weth, price] }),
  );
}

/** Seeds run `n` (default: the next one) and records it as the current run. */
export async function seedRun(ctx: Context, d: Deployments, n = (d.run?.n ?? -1) + 1): Promise<Deployments> {
  const { alice, bob } = runAccounts(n);
  console.log(`Run ${n}: Alice ${alice.address}, Bob ${bob.address}`);

  // Operator: price back to $3000, gas and 20 tWETH for each.
  await setPrice(ctx, d, START_PRICE, "reset price → $3000");
  const gas = parseEther(process.env.DEMO_USER_GAS_MON ?? "0.3");
  for (const [name, who] of [["Alice", alice], ["Bob", bob]] as const) {
    await confirm(ctx, `fund ${name} (MON gas)`, ctx.operator.sendTransaction({ to: who.address, value: gas }));
    await confirm(
      ctx,
      `mint ${name} 20 tWETH`,
      ctx.operator.writeContract({ address: d.weth, abi: testnetERC20Abi, functionName: "mint", args: [who.address, COLLATERAL] }),
    );
  }

  // Alice and Bob open their loans in parallel (different senders).
  await Promise.all([openLoan(ctx, d, alice, "Alice"), openShieldedLoan(ctx, d, bob)]);

  const next: Deployments = {
    ...d,
    run: { n, alice: alice.address, bob: bob.address, startBlock: (await ctx.client.getBlockNumber()).toString() },
  };
  writeDeployments(next);
  return next;
}

async function openLoan(ctx: Context, d: Deployments, who: Account, name: string) {
  const w = ctx.walletFor(who);
  await confirm(ctx, `${name}: approve tWETH`, w.writeContract({ address: d.weth, abi: testnetERC20Abi, functionName: "approve", args: [d.pool, maxUint256] }));
  await confirm(ctx, `${name}: supply 20 tWETH`, w.writeContract({ address: d.pool, abi: testnetPoolAbi, functionName: "supply", args: [d.weth, COLLATERAL, who.address, 0] }));
  await confirm(ctx, `${name}: borrow tUSDC → HF 1.30`, w.writeContract({ address: d.pool, abi: testnetPoolAbi, functionName: "borrow", args: [d.usdc, borrowForStartHf(), 2n, 0, who.address] }));
}

async function openShieldedLoan(ctx: Context, d: Deployments, bob: Account) {
  await openLoan(ctx, d, bob, "Bob");
  const w = ctx.walletFor(bob);
  const c = BOB_CONFIG;
  await confirm(ctx, "Bob: register Shield", w.writeContract({ address: d.shield, abi: liquidationShieldAbi, functionName: "register", args: [d.weth, d.usdc, c.trigger, c.target, c.step, c.slippage] }));
  await confirm(ctx, "Bob: approve atWETH → Shield", w.writeContract({ address: d.aWeth, abi: testnetERC20Abi, functionName: "approve", args: [d.shield, maxUint256] }));
}
