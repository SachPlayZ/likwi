# Liquidation Shield: Product Brief

> **How to use this file.** Put it at the repo root and point Claude Code's skills at it, in this order:
>
> 1. `/write-a-prd`: "Write the PRD from BRIEF.md. Every decision in §5 is final; don't re-ask those in the interview. Ask only about §13 Open Questions."
> 2. `/grill-me`: "Grill the design in BRIEF.md §6–§8, especially the repay math, the flash-loan callback, and the unwind state machine."
> 3. `/to-issues`: "Turn the PRD into issues following the vertical slices in §11. Keep the slice order and the acceptance criteria."
> 4. `/tdd`: run per issue. Each module in §6–§9 lists its test cases first.
> 5. `/ubiquitous-language`: seed it from §3.
>
> Context: this is being built **in one day at Monad Blitz** (a one-day hackathon; demos are in the evening). Scope is cut for that. Anything marked **[STRETCH]** is optional.

---

## 1. One-liner

**Liquidation Shield** is automated, non-custodial liquidation protection for **Aave V3 borrowers on Monad**. It checks a loan every block (~0.4s). When the loan nears liquidation, it shrinks the loan with a flash loan, gradually across blocks, so the user pays a small swap cost instead of a 5–10% liquidation penalty.

Pitch line: _"If you borrow against crypto and the price drops, the protocol sells your collateral and charges a penalty. We stop that from happening."_

## 2. Why this, why Monad

- **Problem:** Aave liquidations seize collateral plus a bonus, typically a 5–10% penalty on the liquidated portion. Borrowers who aren't watching 24/7 lose money.
- **Gap:** DeFi Saver's automation is the incumbent on Ethereum and L2s, but it doesn't support Monad. Aave V3 is the largest lending pool on Monad (~$250M TVL, mid-2026). So the biggest lending market on the chain has no protection tool.
- **Why Monad specifically:** ~0.4s blocks and sub-cent gas make _per-block_ monitoring and _multi-block gradual unwinds_ cheap. On Ethereum, 12s blocks and expensive gas mean protection triggers late and unwinds in one big, high-slippage swap.
- **Audience:** Blitz judges are mostly not deeply technical. The demo must be visual: a side-by-side comparison with a big dollar number.

## 3. Ubiquitous language

| Term                                | Meaning                                                                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Position**                        | A user's Aave V3 account: collateral (aTokens) plus variable debt. Aave health is account-wide, not per asset.                                                        |
| **HF (health factor)**              | Aave's `healthFactor`, WAD (1e18). Below 1.0 the position is liquidatable.                                                                                            |
| **Trigger HF**                      | User-set HF. When HF falls below it, the Shield may act.                                                                                                              |
| **Target HF**                       | User-set HF. Each unwind aims to restore it. Always ≥ trigger + 0.05.                                                                                                 |
| **Step**                            | One `protect(user)` call = one flash-loan deleverage transaction.                                                                                                     |
| **Max step** (`maxStepBps`)         | Cap on the share of total debt repaid in a single step. This is what makes the unwind gradual.                                                                        |
| **Unwind**                          | The sequence of steps from crossing the trigger until HF is back at target (within 0.5%). Usually spans several consecutive blocks.                                   |
| **Unwinding flag**                  | Per-user state, set once an unwind starts and cleared when HF reaches target. It lets steps continue after HF rises back above the trigger but is still below target. |
| **Max slippage** (`maxSlippageBps`) | The user's cap on swap cost versus the Aave oracle price.                                                                                                             |
| **Keeper**                          | The off-chain bot that watches every block and calls `protect`. Calling it is permissionless: anyone can.                                                             |
| **Keeper fee**                      | A small incentive (default 0.10%, max 0.50% of debt repaid) paid in the debt asset to whoever calls `protect`.                                                        |
| **Heartbeat**                       | A cheap on-chain event the keeper emits every N blocks. The UI shows "Shield active, last check 0.4s ago".                                                            |
| **Swap adapter**                    | A pluggable contract that turns collateral into the exact amount of debt asset needed.                                                                                |
| **Base currency**                   | Aave's USD unit with 8 decimals. All `getUserAccountData` values use it.                                                                                              |

## 4. Users and core stories

- **Borrower (primary):** "I have WETH supplied and USDC borrowed on Aave on Monad. I want my position automatically and safely deleveraged before it can be liquidated, without giving anyone custody of my funds."
  - Connect a wallet, see the current position (collateral, debt, HF).
  - Turn on the Shield: pick collateral and debt assets, trigger HF, target HF, max step, max slippage. Approve the collateral aToken. Register.
  - See live status: HF chart, "Shield active" heartbeat, and a log of each protection step.
  - Turn it off at any time: unregister and/or revoke the approval.
- **Keeper operator:** runs the bot with a funded key, earns keeper fees, and monitors `/health`.
- **Demo presenter (hackathon):** runs the demo on **Monad testnet** (chain 10143), so every action is a real, explorer-visible transaction. One click crashes the price. Two identical loans: the unprotected one gets liquidated and the shielded one survives. A big "$ saved" number.

## 5. Decisions already made (final, don't re-litigate)

1. **Protocol:** Aave V3 on **Monad mainnet (chain id 143)** only. Euler, Morpho and Curvance are future work.
2. **Default pair:** collateral **WETH**, debt **USDC**. The contract supports any listed reserve pair.
3. **Mechanism:** Aave `flashLoanSimple` of the debt asset → `repay` on behalf of the user → pull the user's collateral **aTokens** via `transferFrom` (user-granted allowance) → `withdraw` → swap with **exact output** → re-supply leftover collateral to the user → repay the flash loan.
4. **Non-custodial:** the Shield never holds funds between transactions. The user's only grant is an aToken allowance. They can revoke it or call `unregister` at any time.
5. **Permissionless `protect(user)`**, guarded by the user's own trigger, target and slippage settings. No keeper whitelist.
6. **Gradual unwind:** each step repays at most `maxStepBps` of the debt. Steps continue on later blocks until HF ≥ 99.5% of target.
7. **Repay sizing:** use the closed-form formula in §6.3.
8. **Swap venue:** `UniswapV3SwapAdapter` (SwapRouter02 `exactOutput`, owner-set paths) in production. `OracleSwapAdapter` (inventory filled at the Aave oracle price + fee) **only on forks and testnets.** Reason: after the demo fakes an oracle crash, real AMM pools on the fork still show the old price, which would make swap numbers meaningless.
9. **Demo environment:** ~~an anvil fork of Monad mainnet (chain 31430)~~ **Superseded by §17: Monad testnet (chain 10143)**, using our own Aave V3-compatible test pool with an owner-controlled oracle, because Aave isn't deployed on testnet.
10. **Stack:** Foundry (solc **0.8.28**, `evm_version = "prague"`), OpenZeppelin v5. TypeScript + **viem** for the keeper and demo scripts. **Next.js (App Router) + wagmi + viem + TanStack Query + Recharts** for the web app. npm workspaces monorepo.
11. **No token, no backend database.** The registry of users comes from on-chain events.

## 6. Smart contracts (`/contracts`)

### 6.1 Module map

```
src/
  LiquidationShield.sol           // the deep module: register / protect / preview
  interfaces/IAave.sol            // minimal IPool, IPoolAddressesProvider, IAaveOracle, IFlashLoanSimpleReceiver
  interfaces/ISwapAdapter.sol     // swapExactOutput(tokenIn, tokenOut, amountOut, maxAmountIn, recipient) -> amountIn
  adapters/UniswapV3SwapAdapter.sol
  adapters/OracleSwapAdapter.sol  // FORKS/TESTNETS ONLY
  testnet/TestnetAave.sol         // TESTNET ONLY: Aave V3-compatible pool + oracle + tokens; owner-only price/mint (§17)
script/
  MonadAddresses.sol              // constants, see §10
  Deploy.s.sol                    // env-driven, writes deployments/<chainId>.json
test/
  mocks/MockAave.sol              // faithful-enough Aave model for unit tests
  LiquidationShield.t.sol         // unit + fuzz
  fork/ShieldFork.t.sol           // [STRETCH] real Aave on a Monad mainnet fork; skipped if MONAD_RPC_URL unset
```

### 6.2 `LiquidationShield` public interface

```solidity
struct Config {
  address collateralAsset; address debtAsset;
  uint64 triggerHF; uint64 targetHF;          // WAD
  uint16 maxStepBps; uint16 maxSlippageBps;
  bool active; bool unwinding;
}
enum Action { None, Step, ClearUnwind }
struct Preview { Action action; uint256 healthFactor; uint256 repayAmount; uint256 estCollateralSold; }

constructor(address addressesProvider, address swapAdapter, uint16 keeperFeeBps, address owner)
function register(address coll, address debt, uint64 triggerHF, uint64 targetHF, uint16 maxStepBps, uint16 maxSlippageBps)
function unregister()
function protect(address user) returns (uint256 hfAfter)       // nonReentrant, whenNotPaused
function heartbeat()                                           // emits Heartbeat(msg.sender, block.number)
function executeOperation(asset, amount, premium, initiator, params) returns (bool)  // Aave callback
function getConfig(address user) view returns (Config)
function previewProtect(address user) view returns (Preview)
function repayBaseForTarget(uint256 coll, uint256 debt, uint256 ltBps, uint256 targetHF, uint256 slippageBps) pure returns (uint256)
// admin (Ownable2Step): setSwapAdapter, setKeeperFeeBps (≤50), pause, unpause, rescue
```

**Events:** `Registered(user, collateralAsset, debtAsset, triggerHF, targetHF, maxStepBps, maxSlippageBps)`, `Unregistered(user)`, `UnwindComplete(user)`, `Protected(user, keeper, hfBefore, hfAfter, debtRepaid, collateralSold, keeperFee)`, `Heartbeat(keeper, blockNumber)`, `SwapAdapterUpdated`, `KeeperFeeUpdated`.

**Errors:** `InvalidConfig`, `NotRegistered`, `NotProtectable(hf, trigger)`, `NothingToRepay`, `HealthFactorNotImproved(before, after)`, `UnauthorizedFlashLoan`, `ZeroAddress`.

**Registration bounds:** trigger ≥ 1.02; target ≤ 3.0; target ≥ trigger + 0.05; maxStepBps in [500, 10000]; maxSlippageBps in [10, 500]; coll ≠ debt; both must be Aave reserves (non-zero aToken / variable debt token). Re-registering overwrites the config and resets `unwinding`.

### 6.3 Repay sizing (closed form)

From `getUserAccountData` take C = total collateral (base), D = total debt (base), LT = weighted liquidation threshold (bps). Repaying x (base) and selling collateral worth k·x, where k = (10000 + maxSlippageBps)·(10000 + premiumBps + keeperFeeBps) / 10000², rounded up to whole bps (`premiumBps` read from `POOL.FLASHLOAN_PREMIUM_TOTAL()`, never hardcoded). The costs compound, because the swap's slippage applies to repaid + premium + fee. This gives:

```
(C·LT/1e4 − x·k·LT/1e4) / (D − x) = target
⇒ x = (target·D − C·LT/1e4) / (target − k·LT/1e4)
```

- If `target·D ≤ C·LT/1e4`, return 0 (already at target).
- If the denominator ≤ 0 (target unreachable by selling collateral), return D. The step cap bounds it anyway.
- Clamp to D, then to `D · maxStepBps / 1e4`. Convert to debt-asset units with the oracle price and decimals. Clamp to the user's variable debt token balance. Clamp so `maxCollIn` (§6.4) ≤ min(user's collateral aToken balance, allowance to the Shield); a partial step beats none.
- The formula is exact for single-collateral positions. For multi-collateral ones it is an estimate; the next step corrects the residual. **Document this.**

### 6.4 `protect(user)` flow

1. `require active`; read account data. If **`unwinding && hf ≥ target·0.995`**: clear `unwinding`, emit `UnwindComplete`, return `hf` (no revert, no fee). Otherwise allowed only if **`hf < trigger || (unwinding && hf < target·0.995)`**, else revert `NotProtectable`.
2. Compute `repayAmount` per §6.3. If it's 0, revert `NothingToRepay`.
3. Set the transient `_activeUser = user`, then call `flashLoanSimple(this, debtAsset, repayAmount, abi.encode(user, msg.sender), 0)`.
4. **Callback** (`executeOperation`): require `msg.sender == POOL`, `initiator == this` and the decoded user `== _activeUser`.
   - `repaid = POOL.repay(debt, amount, 2, user)`.
   - `fee = repaid·keeperFeeBps/1e4`; `needed = repaid + premium + fee`.
   - `maxCollIn = ceil(needed · pDebt · 10^dColl · (1e4 + slippage) / (pColl · 10^dDebt · 1e4))`.
   - `aToken.safeTransferFrom(user, this, maxCollIn)`, then `withdraw(coll, type(uint).max, this)`.
   - `swapAdapter.swapExactOutput(coll, debt, needed, withdrawn, this)`. The adapter refunds unused input.
   - Re-`supply` any leftover collateral `onBehalfOf: user`. Pay the keeper `fee`. Approve the pool for `amount + premium`.
   - Store `_lastRepaid / _lastCollateralSold / _lastKeeperFee` in **transient** storage.
5. After the flash loan: read `hfAfter`; require `hfAfter > hfBefore`. Set `unwinding = hfAfter < target·0.995`. Emit `Protected`.

### 6.5 Implementation gotchas (already hit these)

- **Trigger vs target bug:** if protect is only allowed below the trigger, an unwind stops at ~trigger and never reaches target. The `unwinding` flag fixes this. A test must cover it.
- **Stack too deep:** split the callback into `_sellCollateral(c, user, debtOut)`. Don't turn on via-IR just for this.
- **Aave version compatibility:** use `getReserveAToken` / `getReserveVariableDebtToken` inside `try/catch`, falling back to `getReserveData(asset).aTokenAddress` / `.variableDebtTokenAddress`.
- `transient` state variables need solc ≥ 0.8.28.
- aToken `transferFrom` re-checks the sender's HF after the transfer. Repay _before_ pulling collateral.
- Use `withdraw(type(uint256).max)` so aToken rounding dust doesn't break the withdrawal.
- `SafeERC20.forceApprove` everywhere. Reset the adapter approval to 0 after the swap.

### 6.6 Adapters

- **UniswapV3SwapAdapter(router, owner):** `setPath(tokenIn, tokenOut, path)` validates the exact-output encoding (tokenOut first, tokenIn last, length = 20 + 23n). Swap flow: pull `maxAmountIn`, call `exactOutput`, refund the rest, reset the approval. Revert `NoRoute` if there's no path, `InvalidPath` if the path is malformed.
- **OracleSwapAdapter(addressesProvider, feeBps, owner):** fills from its own inventory at the oracle price × (1 + fee). Reverts `SlippageExceeded` if `quoteIn > maxAmountIn`. NatSpec must say **FORKS/TESTNETS ONLY**.

### 6.7 Tests (write first, per `/tdd`)

Unit tests (MockAave with WETH $3000, LT 82.5%, liquidation bonus 5%; USDC $1; 5 bps flash premium; the aToken HF check on transfer modeled):

1. Register stores the config. Each invalid bound reverts `InvalidConfig` (low trigger, small gap, small step, high slippage, same asset, unlisted asset).
2. `unregister` then `protect` reverts `NotRegistered`.
3. Healthy position: `protect` reverts `NotProtectable`.
4. 18% crash: one step increases HF, the keeper fee is paid, and **the Shield holds zero WETH, USDC and aWETH afterwards** (invariant helper).
5. **Gradual unwind:** maxStep 15%, 20% crash. Takes ≥ 2 steps across rolled blocks and ends within 1% of target with `unwinding == false`.
6. Step cap is respected: debt reduction ≤ maxStep·D.
7. **Shield beats liquidation:** two identical positions, 25% crash. Alice is liquidated (50% close factor, 5% bonus); Bob is shielded. Alice's equity loss is > 5× Bob's. (Reference run: Alice lost ~$476 and Bob ~$64 on a $30k position.)
8. Revoked approval: `protect` reverts.
9. Swap cost 3% against the user's 1% cap: reverts.
10. Paused: preview returns `action == None` and `protect` reverts.
11. Calling `executeOperation` directly, or as the pool with a foreign initiator, reverts `UnauthorizedFlashLoan`.
12. Heartbeat emits. Admin functions are owner-only; fee > 50 reverts.
13. **Fuzz:** `repayBaseForTarget` lands within 0.01% of target for single-collateral positions (coll $1k–$100M, LT 50–95%, HF 0.8–1.5, slippage 10–500 bps).
14. Uniswap adapter: routes, refunds unused input, holds no balance; path validation and NoRoute.
15. **Stale unwinding flag:** start an unwind, recover price above target·0.995, dip to between trigger and target. `protect` clears the flag and emits `UnwindComplete`; no step fires.
16. **Collateral clamp:** allowance (or balance) below the full `maxCollIn` → partial step that still raises HF; zero → `NothingToRepay`.
17. **k includes fees:** with the swap at the full slippage cap, a step lands at or above target (not below), with the premium read from the pool.

Fork tests (`MONAD_RPC_URL` set; otherwise early-return): real Aave, `deal` WETH/USDC, etch `DemoPriceFeed` over `oracle.getSourceOfAsset(WETH)`. (a) A 15% crash unwinds to within 1% of 1.4 HF, Shield holds no funds. (b) A 25% crash: the unprotected position is liquidated via `liquidationCall`.

## 7. Keeper bot (`/keeper`)

**Module boundaries (keep them deep, with small interfaces):**

- `config.ts`: parse and validate env. Fail fast with a clear message.
- `registry.ts`: `class UserRegistry { sync(toBlock): Promise<void>; users(): Address[] }`. Backfills `Registered`/`Unregistered` logs from `DEPLOY_BLOCK` in chunks of `LOG_CHUNK`, then incrementally each block. Optional `USERS` env pins a static list.
- `executor.ts`: `class Executor { maybeProtect(user, preview): Promise<void>; heartbeat(): Promise<void> }`. One in-flight tx per user. `simulateContract` before `writeContract`. viem `nonceManager`. Never throws out of the loop; it logs and counts failures instead.
- `loop.ts`: subscribes to new blocks (WebSocket if `WS_URL` is set, else polling at 200ms). **Skips a tick if the previous one is still running** (no overlap). Per tick: sync the registry → `previewProtect` for all users (bounded concurrency) → `maybeProtect` those with `action != None` → heartbeat every `HEARTBEAT_EVERY_BLOCKS`.
- `status.ts`: `node:http` with CORS. `GET /health` returns `{ok, lastBlock, lastTickMs, lagBlocks}`; `GET /status` returns `{users:[{user, hf, action, unwinding, lastTx, lastError}], stats:{protects, failures, heartbeats}}`.
- `log.ts`: one-line JSON logger.
- Graceful shutdown on SIGINT/SIGTERM.

**Env:** `RPC_URL`, `WS_URL?`, `CHAIN=monad|testnet`, `KEEPER_PRIVATE_KEY`, `SHIELD_ADDRESS`, `DEPLOY_BLOCK`, `HEARTBEAT_EVERY_BLOCKS=10`, `LOG_CHUNK=1000`, `CONCURRENCY=16`, `STATUS_PORT=8787`, `USERS?`, `DRY_RUN=false`. Prefer a provider WebSocket RPC (e.g. Alchemy Monad testnet), and fall back to the public RPC, which is rate-limited.

**Flag clears:** when `previewProtect` returns `ClearUnwind`, send `protect` (no fee earned).

**Tests:** for pure logic, use vitest with a stubbed public client (tick overlap guard, one in-flight tx per user, heartbeat cadence, registry dedup on Registered → Unregistered → Registered, ClearUnwind dispatch, RPC fallback). End-to-end runs against Monad testnet in the demo.

## 8. Web app (`/web`)

**Design direction:** dark, high-contrast "mission control." Monad purple accent. Big numerals. Must read from across a room on a projector. No generic template look.

**Network:** Monad testnet (chain 10143). A "Testnet · chain 10143" badge is always visible. Test tokens are labelled **tWETH / tUSDC**. Every transaction shown links to the testnet explorer.

**Pages:**

1. **`/` (product):** connect wallet (injected connector; chains: Monad testnet, plus mainnet later).
   - **Position card:** collateral $, debt $, HF gauge with the 1.0 line and the trigger/target markers.
   - **Shield form:** collateral/debt selects (from the shared asset list), trigger, target, max step %, max slippage %, with inline validation that mirrors the contract bounds. A two-step CTA: _Approve atWETH_ → _Activate Shield_. Unregister and revoke-approval buttons.
   - **Activity:** `Protected` events for this user (HF before → after, debt repaid, collateral sold, explorer link).
   - **Status badge:** "Shield active · last check 0.3s ago", from the latest `Heartbeat` whose `keeper == NEXT_PUBLIC_KEEPER_ADDRESS` (falling back to the keeper's `/health`). Ignore heartbeats from other addresses.
   - **Approval:** unlimited atWETH approval, with a prominent revoke button. Default max slippage 1%.
   - **Testnet faucet:** "Get 10 tWETH + open sample loan" button. It calls the operator server route (below), which mints tWETH to the connected wallet; the user then supplies and borrows to HF 1.30 with their own wallet.
2. **`/demo` (the hackathon screen):** no wallet. Reads through a public client. Writes go through **operator server routes** (Next.js route handlers) that sign with a testnet-only `OPERATOR_PRIVATE_KEY`, read from server-side env and never exposed to the browser.
   - Two cards side by side, **Unprotected** (Alice) vs **Shielded** (Bob). Same starting loan (20 tWETH collateral at HF 1.30).
   - A **live HF chart** with both lines, one point per block, a red line at 1.0 and dashed lines at trigger and target.
   - A **Crash price** control. Primary: **slow crash**, −3% per second for 10 seconds (compounding, about −26%). Secondary: instant −5% / −15% / −25%. The server route calls the test oracle's owner-only `setAssetPrice`.
   - An event ticker: liquidation (red), each protection step (green) and price changes, **each linked to the testnet explorer**.
   - **A big "$ saved" number** = Alice's liquidation penalty (bonus seized) − Bob's costs (swap cost + flash premium + keeper fees), at the oracle price. Secondary, smaller stat: the equity-change difference (collateral − debt + wallet balances).
   - A **Reset** button. The server route resets the price to $3000, derives a **fresh Alice and Bob** at the next mnemonic index, funds them with MON gas, opens both loans at HF 1.30, registers and approves Bob, then clears the chart. It is idempotent and safe to press repeatedly.

**Data:** read the chain directly with viem/wagmi, refetching on every new block. Configure addresses through `NEXT_PUBLIC_SHIELD_ADDRESS`, `NEXT_PUBLIC_CHAIN`, `NEXT_PUBLIC_KEEPER_URL`, `NEXT_PUBLIC_KEEPER_ADDRESS`, `NEXT_PUBLIC_EXPLORER_URL` and the pool/oracle/token addresses, written by `demo:deploy`. The current Alice and Bob come from the server (`/api/demo/state`).

## 9. Demo tooling (`/demo`, `/scripts`)

- **Network:** Monad testnet, chain **10143**, ~0.3s blocks (measured). Public RPC `https://testnet-rpc.monad.xyz` (WS `wss://testnet-rpc.monad.xyz`); faucet `https://faucet.monad.xyz`. Use a provider RPC for the keeper.
- **Keys:** one `OPERATOR_PRIVATE_KEY` (deployer, pool/oracle owner, MON funder), a `KEEPER_PRIVATE_KEY`, a `LIQUIDATOR_PRIVATE_KEY`, and a `DEMO_MNEMONIC` for Alice/Bob (index 2n = Alice, 2n+1 = Bob for run n). All of them are testnet-only, never committed, and fund the operator from the faucet ahead of demo day.
- `demo deploy` (TypeScript + viem):
  1. Deploy `TestnetAave` (pool, oracle, tWETH, tUSDC; WETH $3000, LT 82.5%, 5% bonus, USDC $1, 5 bps flash premium) owned by the operator. Seed pool liquidity.
  2. Deploy `OracleSwapAdapter` (fee 30 bps) and fund it with tUSDC. Deploy the Shield (keeper fee 10 bps).
  3. Fund the keeper and liquidator with MON gas, and the liquidator with tUSDC.
  4. Write `web/.env.local` and `demo/.deployments.json` (addresses + deploy block).
- `demo seed [--run n]`: what Reset does. Price → $3000; derive Alice/Bob; send MON gas; mint 20 tWETH each; supply + borrow to HF 1.30; Bob registers (trigger 1.15, target 1.40, step 25%, slippage 1%) and approves atWETH; record the current run.
- `demo crash --pct 15 [--slow]`: the CLI equivalent of the UI button (`--slow` = −3%/s for 10s).
- `demo liquidator`: a bot that watches the current Alice and calls `liquidationCall(tWETH, tUSDC, alice, max, false)` once HF < 1. It plays the "real world" for the unprotected side.
- **Run order on demo day:** `npm run demo:deploy` (once, beforehand) → `npm run demo:seed` → `npm run keeper` → `npm run demo:liquidator` → `npm run web` → open `/demo`.

## 10. Verified addresses (Monad mainnet, chain id 143)

From the Aave Address Book (`@aave-dao/aave-address-book`, module `AaveV3Monad`) and Uniswap's Monad v3 deployment page. **Re-verify before any mainnet deploy.**

| Name                       | Address                                               |
| -------------------------- | ----------------------------------------------------- |
| Aave PoolAddressesProvider | `0x34793Fb9935F7bB5E5aE920fb963F39063E7A615`          |
| Aave Pool                  | `0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef`          |
| Aave Oracle                | `0x0c02b2c2038066C10Eab8fe1D5Cdb73d5a78A1Bf`          |
| Aave ProtocolDataProvider  | `0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad`          |
| Aave ACL admin (executor)  | `0xa9d0EAFF48cE1DF468f9eAeb7e628c413343F6A2`          |
| WETH                       | `0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242` (18 dec) |
| aWETH                      | `0x4377b53aAA8b8e3fF7AA2843832CAF004f5Cb8b6`          |
| vWETH                      | `0xd1f352c326731027f0d9a7f62a4742eBdf1EFc8c`          |
| USDC                       | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` (6 dec)  |
| aUSDC                      | `0x35a73BAcb179d3740395A3ceCc87FF2e581d6042`          |
| vUSDC                      | `0x9F555aB84C4e0a531B50283f09Dba7A97134c4e4`          |
| USDT0                      | `0xe7cd86e13AC4309349F30B3435a9d337750fC82D` (6 dec)  |
| Uniswap V3 Factory         | `0x204FAca1764B154221e35c0d20aBb3c525710498`          |
| Uniswap SwapRouter02       | `0xfE31F71C1b106EAc32F1A19239c9a9A72ddfb900`          |
| WMON                       | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A`          |

The other Aave Monad reserves are cbBTC, wstETH, weETH, USDe, sUSDe, mUSD, AUSD, syrupUSDC, GHO and PT tokens. eMode categories exist (e.g. wstETH/WETH), and `getUserAccountData` already accounts for them. Public RPC: `https://rpc.monad.xyz` (rate-limited; use a provider RPC for the fork).

**Foundry config:** `solc_version = "0.8.28"`, `evm_version = "prague"`, optimizer 10k runs, remapping `@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/`. Deploy with `forge script … --legacy` (not `forge create`).

## 11. Vertical slices (input for `/to-issues`, in order)

Each slice is demoable on its own. **Stop wherever time runs out; slice 4 is the minimum viable demo.**

1. **Foundations:** monorepo (npm workspaces: `contracts`, `packages/shared`, `keeper`, `demo`, `web`), Foundry setup, `MonadAddresses.sol`, interfaces, MockAave, and an ABI codegen script (`forge out` → `packages/shared/src/generated.ts`). _AC:_ `forge build` passes; `npm run abis` writes typed ABIs.
2. **Core Shield, single step:** register/unregister, `repayBaseForTarget`, `protect` with the flash loan and OracleSwapAdapter. Unit tests 1–4, 8–13, 16–17. _AC:_ all green; the "Shield holds nothing" invariant holds.
3. **Gradual unwind:** the `unwinding` flag (incl. `ClearUnwind`), the 0.5% target tolerance, `previewProtect`. Tests 5–7, 15. _AC:_ a multi-step unwind lands within 1% of target.
4. **Testnet demo backbone:** `TestnetAave` (promoted from MockAave, owner-gated), `demo deploy`, `demo seed`, `demo crash`, `demo liquidator`, plus a minimal keeper (WS → preview → protect). _AC:_ on Monad testnet, from a terminal, a crash liquidates Alice and Bob unwinds over a few blocks; every transaction is visible on the explorer.
5. **Demo UI:** the `/demo` page with two cards, live HF chart, crash button, ticker and $ saved. _AC:_ the full 2-minute script in §12 runs from the browser.
6. **Keeper hardening:** registry backfill, in-flight dedup, overlap guard, heartbeat, `/health` + `/status`, graceful shutdown. _AC:_ the vitest unit tests pass; the UI badge shows the heartbeat.
7. **Product UI:** the `/` page with position card, Shield form (approve → activate), activity, unregister/revoke. _AC:_ a fresh wallet on Monad testnet can opt in end to end.
8. **[STRETCH] Production adapter:** UniswapV3SwapAdapter + tests 14 + `Deploy.s.sol` for mainnet. Check which WETH/USDC pool fee tier on Monad has liquidity, or route through WMON.
9. **[STRETCH]** auto re-leverage on recovery (with a hysteresis band); a time-to-liquidation trigger (HF slope per block); multi-protocol support (Euler, Morpho, Curvance).

## 12. Demo script (about 2 minutes)

1. "Two identical $X loans on Aave on Monad. The right one has Liquidation Shield, which checks it every block." Point at the heartbeat badge.
2. Click **Slow crash** (−3%/s). Both HF lines drop. Line: "The Shield acts before HF hits 1."
3. The left loan crosses 1.0 and the liquidator bot seizes collateral; the penalty shows in red. The right loan steps down over a few blocks (green ticks) and levels off at 1.40.
4. Point at **"Shield saved $X."**
5. "Checking every block costs fractions of a cent on Monad. On Ethereum, that would cost a fortune." (Every transaction you just saw is on Monad testnet. Click any ticker line for the explorer.)

**Q&A answers to keep ready:** if the bot is down, `protect` is permissionless and the heartbeat makes uptime public. The Shield can't steal funds: it acts only below the user's own trigger, only up to their target and slippage, and never holds funds. Even a malicious owner-set swap adapter can take at most `maxSlippageBps` per step, and only below the trigger; `pause` is the owner's other power (it leaves users unprotected). A slow oracle hits liquidators equally; an early trigger and gradual steps give a buffer. Versus DeFi Saver: same idea, but it isn't on Monad, and per-block checking only makes economic sense on a fast, cheap chain.

## 13. Open questions (the only things to interview about)

> Keeper fee and configs-per-user are resolved in §16. The Uniswap pool question stays open for slice 8; the hosted keeper stays out of scope.

- Keeper fee default (10 bps?) and whether to have a protocol fee recipient at all.
- Whether WETH/USDC on Uniswap V3 Monad has enough liquidity at fee 500 vs 3000, or whether to route through WMON (affects slice 8 only).
- The hosted keeper for after the hackathon (Railway/Fly?), out of scope today.
- Whether to support multiple Shield configs per user (one per collateral/debt pair). Today it's one per user, which is fine because Aave health is account-wide.

## 14. Non-goals (today)

Audits, a mainnet deployment with real funds, governance or a token, a keeper network or MEV protection, non-Aave protocols, mobile layout polish beyond "doesn't break", gasless or EIP-7702 onboarding.

## 15. Definition of done (hackathon)

- `forge test` is green, including the fuzz test. The fork tests (stretch) pass when `MONAD_RPC_URL` is set.
- One command sequence (§9) brings up the full demo against Monad testnet from a laptop.
- `/demo` runs the §12 script with no terminal interaction after start.
- The README covers the architecture diagram, run steps, the safety model (§5.4–5.5, §6.4, plus owner powers and the MEV bound from §16), and the "why Monad" paragraph.

## 16. Grilling decisions (final, folded into the sections above)

Settled on 2026-11-04 by grilling §6–§8 and §13. The sections above already reflect them; this list is the summary.

**Contracts**

1. **k includes fees:** k = (1 + slippage)·(1 + flash premium + keeper fee), compounded. Found in #13: the additive form left a full-slippage Step about 0.005% below target. The premium is read from `POOL.FLASHLOAN_PREMIUM_TOTAL()`. If swaps cost less than the cap, HF overshoots target slightly, which is safe. (§6.3)
2. **Stale unwinding flag:** if `unwinding && hf ≥ target·0.995`, `protect` clears the flag, emits `UnwindComplete`, and returns without reverting and without a fee. Otherwise a later dip between trigger and target would trigger a step above the user's trigger. (§6.4, test 15)
3. **`Preview.action`** is an enum `None | Step | ClearUnwind`, replacing `bool protectable`. (§6.2)
4. **Collateral clamp:** the repay shrinks so `maxCollIn` ≤ min(aToken balance, allowance). If it would be 0, revert `NothingToRepay`. (§6.3, test 16)
5. **No minimum step size.** The 0.5% target band stops dust steps.
6. **Fees:** the keeper fee defaults to 10 bps (max 50), paid to `msg.sender`. There is no protocol fee recipient.
7. **One config per user**, because Aave health is account-wide.
8. **MEV:** permissionless `protect` plus a sandwichable Uniswap swap means the loss per step is bounded by `maxSlippageBps`. This is accepted and documented, and the UI defaults slippage to 1%. MEV protection remains a non-goal.
9. **Owner trust:** no timelock. A malicious adapter can take at most the slippage cap per step, and only below the trigger. `pause` leaves users unprotected. Both go in the README.

**Keeper**

10. **Heartbeats:** the UI only trusts those from `NEXT_PUBLIC_KEEPER_ADDRESS`, because `heartbeat()` is permissionless.
11. **Flag clears:** the keeper dispatches `ClearUnwind` calls (no fee).
12. **Rewind:** if the block number goes backwards, the keeper and liquidator reset their nonce manager, in-flight map and registry cursor. This is covered by a vitest case. _Superseded by §17: no rewinds on testnet._

**Demo and web**

13. **Block time:** the fork runs at `anvil --block-time 0.4`, Monad's real block time. Verified on anvil 1.5.1. _Superseded by §17: testnet runs ~0.3s blocks natively._
14. **Main crash path:** slow crash at −3%/s for 10s (compounding, about −26%). At −2%/s, Alice (HF 1.30) never hits 1.0. Instant crashes are secondary. An instant −25% puts Bob at HF ~0.975, liquidatable in the same block, so the stage line is "Shield acts before HF hits 1."
15. **"$ saved"** = Alice's liquidation penalty − Bob's costs (swap + premium + keeper fees). The equity difference is a secondary stat, because it also counts market exposure Bob avoided by de-risking early.
16. **Reset:** `anvil_revert`, then a fresh `evm_snapshot` (a revert consumes the snapshot), then clear the chart. _Superseded by §17: Reset creates fresh accounts._
17. **`/demo` is wallet-free:** no MetaMask, so no stale-nonce errors after a revert. _Superseded by §17: still wallet-free, but writes go through operator server routes._
18. **`/` has a fork-only faucet:** "Fund 10 WETH + open sample loan", so slice 7's acceptance criterion is reachable. _Superseded by §17: the faucet is the operator mint route._
19. **Approval:** unlimited aWETH approval with a prominent revoke button.

## 17. Testnet demo decisions (2026-11-04; supersede §5.9 and the anvil parts of §16)

The hackathon wants **real transactions on a public network**, so the demo runs on **Monad testnet (chain 10143)** and the anvil fork demo is dropped.

1. **Lending venue:** Aave isn't deployed on Monad testnet; none of the mainnet Aave or Uniswap addresses have code there (checked on-chain). We deploy our own **Aave V3-compatible test pool** (`TestnetAave`, promoted from the MockAave test double) and present it honestly as that. The Shield code is identical; on mainnet it points at real Aave.
2. **Owner-gated test pool:** price setting, minting and reserve listing are owner-only, so nobody else on the public testnet can crash our price mid-demo.
3. **Signer for demo writes:** Next.js server routes sign with a testnet-only `OPERATOR_PRIVATE_KEY` from server-side env. No wallet popups on stage.
4. **Reset:** fresh Alice and Bob per run, derived from `DEMO_MNEMONIC` at the next index, funded, and re-seeded at HF 1.30 with price back at $3000. No snapshots exist on testnet.
5. **Swap venue:** `OracleSwapAdapter` on testnet (already allowed by §5.8).
6. **Anvil dropped:** no fork script, no 31430 gating, no `anvil_*` calls, no rewind handling. The real-Aave fork tests move to stretch, together with the mainnet adapter work.
7. **Keeper RPC:** a provider WebSocket RPC, with the public RPC as fallback (it's rate-limited).
8. **Proof on screen:** every ticker event links to the testnet explorer, and a "Testnet · chain 10143" badge is always shown.
9. **Token naming:** tWETH / tUSDC (and atWETH) in the UI.
10. **Product page `/`:** stays, on testnet, with a faucet that calls the operator mint route. It comes after `/demo` in priority.
