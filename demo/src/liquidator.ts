// `demo liquidator` (BRIEF §9): plays the "real world" for the unprotected side. Each block it checks the
// current run's Alice and liquidates her (50% close factor, max debt) while her HF is below 1.
import { maxUint256, type Address } from "viem";
import { testnetERC20Abi, testnetPoolAbi } from "@liquidation-shield/shared";
import { account, confirm, latestDeployments, readDeployments, type Context } from "./context";

const ONE = 10n ** 18n;

export async function runLiquidator(ctx: Context): Promise<() => void> {
  const liq = ctx.walletFor(account("LIQUIDATOR_PRIVATE_KEY"));
  const d0 = readDeployments();
  const allowance = await ctx.client.readContract({
    address: d0.usdc,
    abi: testnetERC20Abi,
    functionName: "allowance",
    args: [liq.account.address, d0.pool],
  });
  if (allowance < maxUint256 / 2n) {
    await confirm(ctx, "liquidator: approve tUSDC → pool", liq.writeContract({ address: d0.usdc, abi: testnetERC20Abi, functionName: "approve", args: [d0.pool, maxUint256] }));
  }
  console.log(`Liquidator ${liq.account.address} watching the current run's Alice…`);

  let busy = false;
  let ticks = 0;
  let d = await latestDeployments(ctx);
  return ctx.client.watchBlockNumber({
    emitMissed: false,
    pollingInterval: 400, // ~every other block; the public RPC rate-limits bursts
    onError: (e) => console.error("block watch error:", e.message),
    onBlockNumber: async () => {
      if (busy) return; // one liquidation in flight at a time
      busy = true;
      try {
        // A Reset (CLI or web) switches Alice without a restart; ~every 10 s is soon enough to notice.
        if (++ticks % 25 === 0) d = await latestDeployments(ctx);
        const alice = d.run?.alice as Address | undefined;
        if (!alice) return;
        const [, , , , , hf] = await ctx.client.readContract({ address: d.pool, abi: testnetPoolAbi, functionName: "getUserAccountData", args: [alice] });
        if (hf >= ONE) return;
        await confirm(
          ctx,
          `LIQUIDATE Alice (HF ${(Number(hf) / 1e18).toFixed(3)})`,
          liq.writeContract({ address: d.pool, abi: testnetPoolAbi, functionName: "liquidationCall", args: [d.weth, d.usdc, alice, maxUint256, false] }),
        );
      } catch (e) {
        console.error("liquidation failed:", (e as Error).message.split("\n")[0]);
      } finally {
        busy = false;
      }
    },
  });
}
