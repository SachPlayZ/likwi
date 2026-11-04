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
- **Demo presenter (hackathon):** runs a local Monad fork. One click crashes the price. Two identical loans: the unprotected one gets liquidated and the shielded one survives. A big "$ saved" number.

## 5. Decisions already made (final, don't re-litigate)

1. **Protocol:** Aave V3 on **Monad mainnet (chain id 143)** only. Euler, Morpho and Curvance are future work.
2. **Default pair:** collateral **WETH**, debt **USDC**. The contract supports any listed reserve pair.
3. **Mechanism:** Aave `flashLoanSimple` of the debt asset → `repay` on behalf of the user → pull the user's collateral **aTokens** via `transferFrom` (user-granted allowance) → `withdraw` → swap with **exact output** → re-supply leftover collateral to the user → repay the flash loan.
4. **Non-custodial:** the Shield never holds funds between transactions. The user's only grant is an aToken allowance. They can revoke it or call `unregister` at any time.
5. **Permissionless `protect(user)`**, guarded by the user's own trigger, target and slippage settings. No keeper whitelist.
6. **Gradual unwind:** each step repays at most `maxStepBps` of the debt. Steps continue on later blocks until HF ≥ 99.5% of target.
7. **Repay sizing:** use the closed-form formula in §6.3.
8. **Swap venue:** `UniswapV3SwapAdapter` (SwapRouter02 `exactOutput`, owner-set paths) in production. `OracleSwapAdapter` (inventory filled at the Aave oracle price + fee) **only on forks and testnets.** Reason: after the demo fakes an oracle crash, real AMM pools on the fork still show the old price, which would make swap numbers meaningless.
9. **Demo environment:** an **anvil fork of Monad mainnet** with chain id **31430**, so wallets never confuse it with mainnet. The price crash is done by etching a `DemoPriceFeed` over Aave's WETH price source and writing slot 0.
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
  demo/DemoPriceFeed.sol          // FORKS ONLY: int256 latestAnswer in slot 0, decimals 8, latestRoundData
script/
  MonadAddresses.sol              // constants, see §10
  Deploy.s.sol                    // env-driven, writes deployments/<chainId>.json
test/
  mocks/MockAave.sol              // faithful-enough Aave model for unit tests
  LiquidationShield.t.sol         // unit + fuzz
  fork/ShieldFork.t.sol           // real Aave on a Monad fork; skipped if MONAD_RPC_URL unset
```

### 6.2 `LiquidationShield` public interface

```solidity
struct Config {
  address collateralAsset; address debtAsset;
  uint64 triggerHF; uint64 targetHF;          // WAD
  uint16 maxStepBps; uint16 maxSlippageBps;
  bool active; bool unwinding;
}
struct Preview { bool protectable; uint256 healthFactor; uint256 repayAmount; uint256 estCollateralSold; }

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

**Events:** `Registered(user, collateralAsset, debtAsset, triggerHF, targetHF, maxStepBps, maxSlippageBps)`, `Unregistered(user)`, `Protected(user, keeper, hfBefore, hfAfter, debtRepaid, collateralSold, keeperFee)`, `Heartbeat(keeper, blockNumber)`, `SwapAdapterUpdated`, `KeeperFeeUpdated`.

**Errors:** `InvalidConfig`, `NotRegistered`, `NotProtectable(hf, trigger)`, `NothingToRepay`, `HealthFactorNotImproved(before, after)`, `UnauthorizedFlashLoan`, `ZeroAddress`.

**Registration bounds:** trigger ≥ 1.02; target ≤ 3.0; target ≥ trigger + 0.05; maxStepBps in [500, 10000]; maxSlippageBps in [10, 500]; coll ≠ debt; both must be Aave reserves (non-zero aToken / variable debt token). Re-registering overwrites the config and resets `unwinding`.

### 6.3 Repay sizing (closed form)

From `getUserAccountData` take C = total collateral (base), D = total debt (base), LT = weighted liquidation threshold (bps). Repaying x (base) and selling collateral worth k·x, where k = (10000 + maxSlippageBps + 10 flash buffer) / 10000, gives:

```
(C·LT/1e4 − x·k·LT/1e4) / (D − x) = target
⇒ x = (target·D − C·LT/1e4) / (target − k·LT/1e4)
```

- If `target·D ≤ C·LT/1e4`, return 0 (already at target).
- If the denominator ≤ 0 (target unreachable by selling collateral), return D. The step cap bounds it anyway.
- Clamp to D, then to `D · maxStepBps / 1e4`. Convert to debt-asset units with the oracle price and decimals. Clamp to the user's variable debt token balance.
- The formula is exact for single-collateral positions. For multi-collateral ones it is an estimate; the next step corrects the residual. **Document this.**

### 6.4 `protect(user)` flow

1. `require active`; read account data. Allowed only if **`hf < trigger || (unwinding && hf < target·0.995)`**, else revert `NotProtectable`.
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
10. Paused: preview says not protectable and `protect` reverts.
11. Calling `executeOperation` directly, or as the pool with a foreign initiator, reverts `UnauthorizedFlashLoan`.
12. Heartbeat emits. Admin functions are owner-only; fee > 50 reverts.
13. **Fuzz:** `repayBaseForTarget` lands within 0.01% of target for single-collateral positions (coll $1k–$100M, LT 50–95%, HF 0.8–1.5, slippage 10–500 bps).
14. Uniswap adapter: routes, refunds unused input, holds no balance; path validation and NoRoute.

Fork tests (`MONAD_RPC_URL` set; otherwise early-return): real Aave, `deal` WETH/USDC, etch `DemoPriceFeed` over `oracle.getSourceOfAsset(WETH)`. (a) A 15% crash unwinds to within 1% of 1.4 HF, Shield holds no funds. (b) A 25% crash: the unprotected position is liquidated via `liquidationCall`.

## 7. Keeper bot (`/keeper`)

**Module boundaries (keep them deep, with small interfaces):**

- `config.ts`: parse and validate env. Fail fast with a clear message.
- `registry.ts`: `class UserRegistry { sync(toBlock): Promise<void>; users(): Address[] }`. Backfills `Registered`/`Unregistered` logs from `DEPLOY_BLOCK` in chunks of `LOG_CHUNK`, then incrementally each block. Optional `USERS` env pins a static list.
- `executor.ts`: `class Executor { maybeProtect(user, preview): Promise<void>; heartbeat(): Promise<void> }`. One in-flight tx per user. `simulateContract` before `writeContract`. viem `nonceManager`. Never throws out of the loop; it logs and counts failures instead.
- `loop.ts`: subscribes to new blocks (WebSocket if `WS_URL` is set, else polling at 200ms). **Skips a tick if the previous one is still running** (no overlap). Per tick: sync the registry → `previewProtect` for all users (bounded concurrency) → `maybeProtect` the protectable ones → heartbeat every `HEARTBEAT_EVERY_BLOCKS`.
- `status.ts`: `node:http` with CORS. `GET /health` returns `{ok, lastBlock, lastTickMs, lagBlocks}`; `GET /status` returns `{users:[{user, hf, protectable, unwinding, lastTx, lastError}], stats:{protects, failures, heartbeats}}`.
- `log.ts`: one-line JSON logger.
- Graceful shutdown on SIGINT/SIGTERM.

**Env:** `RPC_URL`, `WS_URL?`, `CHAIN=monad|fork`, `KEEPER_PRIVATE_KEY`, `SHIELD_ADDRESS`, `DEPLOY_BLOCK`, `HEARTBEAT_EVERY_BLOCKS=10`, `LOG_CHUNK=1000`, `CONCURRENCY=16`, `STATUS_PORT=8787`, `USERS?`, `DRY_RUN=false`.

**Tests:** for pure logic, use vitest with a stubbed public client (tick overlap guard, one in-flight tx per user, heartbeat cadence, registry dedup on Registered → Unregistered → Registered). End-to-end runs against anvil in the demo.

## 8. Web app (`/web`)

**Design direction:** dark, high-contrast "mission control." Monad purple accent. Big numerals. Must read from across a room on a projector. No generic template look.

**Pages:**

1. **`/` (product):** connect wallet (injected connector; chains: Monad mainnet + local fork).
   - **Position card:** collateral $, debt $, HF gauge with the 1.0 line and the trigger/target markers.
   - **Shield form:** collateral/debt selects (from the shared asset list), trigger, target, max step %, max slippage %, with inline validation that mirrors the contract bounds. A two-step CTA: _Approve aWETH_ → _Activate Shield_. Unregister and revoke-approval buttons.
   - **Activity:** `Protected` events for this user (HF before → after, debt repaid, collateral sold, tx link).
   - **Status badge:** "Shield active · last check 0.4s ago", from the latest `Heartbeat` (falling back to the keeper's `/health`).
2. **`/demo` (the hackathon screen):**
   - Two cards side by side, **Unprotected** vs **Shielded**. Same starting loan (e.g. 20 WETH collateral at HF 1.30).
   - A **live HF chart** with both lines, one point per block, a red line at 1.0 and dashed lines at trigger and target.
   - A **Crash price** button (−5% / −15% / −25%, plus "slow crash": −2% per second for 10 seconds). It calls anvil RPC directly (`anvil_setStorageAt` on the etched feed). Only enabled on chain 31430.
   - An event ticker: liquidation (red) and each protection step (green).
   - **A big "$ saved" number** = unprotected loss − shielded loss, both computed as the change in equity (collateral − debt + wallet balances) at the oracle price.
   - A Reset button that calls `anvil_revert` to a snapshot taken at setup.

**Data:** read the chain directly with viem/wagmi, refetching on every new block. Configure addresses through `NEXT_PUBLIC_SHIELD_ADDRESS`, `NEXT_PUBLIC_CHAIN`, `NEXT_PUBLIC_KEEPER_URL`, `NEXT_PUBLIC_DEMO_FEED`, `NEXT_PUBLIC_DEMO_ALICE/BOB`, written by `demo:setup`.

## 9. Demo tooling (`/demo`, `/scripts`)

- `scripts/fork.sh`: `anvil --fork-url $MONAD_RPC_URL --chain-id 31430 --block-time 1` (anvil's block time is in whole seconds; mention that real Monad is ~0.4s on the slide) plus `--steps-tracing` off and a generous `--gas-limit`.
- `demo setup` (TypeScript + viem test client):
  1. Deploy the Shield with `OracleSwapAdapter`. Fund the adapter with USDC.
  2. Accounts: anvil #0 = deployer/keeper, #1 = Alice (unprotected), #2 = Bob (shielded), #3 = liquidator.
  3. **Fund tokens** with `anvil_setStorageAt`: find the `balanceOf` mapping slot by probing slots 0–50 plus OpenZeppelin v5's ERC-7201 ERC20 slot (`0x52c63247…bace00`), checking `balanceOf` after each write.
  4. Alice and Bob each supply 20 WETH and borrow USDC to HF 1.30. Bob registers (trigger 1.15, target 1.40, step 25%, slippage 1%) and approves aWETH.
  5. Etch `DemoPriceFeed` runtime bytecode over `AaveOracle.getSourceOfAsset(WETH)`. Write the current price into slot 0.
  6. Take an `evm_snapshot`. Write `web/.env.local` and `demo/.deployments.json`.
- `demo crash --pct 15 [--slow]`: the CLI equivalent of the UI button.
- `demo liquidator`: a bot that watches Alice and calls `liquidationCall(WETH, USDC, alice, max, false)` once HF < 1. It plays the "real world" for the unprotected side.
- **Run order on demo day:** `npm run fork` → `npm run demo:setup` → `npm run keeper` → `npm run demo:liquidator` → `npm run web` → open `/demo`.

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
2. **Core Shield, single step:** register/unregister, `repayBaseForTarget`, `protect` with the flash loan and OracleSwapAdapter. Unit tests 1–4, 8–13. _AC:_ all green; the "Shield holds nothing" invariant holds.
3. **Gradual unwind:** the `unwinding` flag, the 0.5% target tolerance, `previewProtect`. Tests 5–7. _AC:_ a multi-step unwind lands within 1% of target.
4. **Fork demo backbone:** `fork.sh`, `demo setup`, `demo crash`, `demo liquidator`, plus a minimal keeper (poll each block → preview → protect). _AC:_ in a terminal, a crash liquidates Alice and Bob unwinds over a few blocks; the logs show both.
5. **Demo UI:** the `/demo` page with two cards, live HF chart, crash button, ticker and $ saved. _AC:_ the full 2-minute script in §12 runs from the browser.
6. **Keeper hardening:** registry backfill, in-flight dedup, overlap guard, heartbeat, `/health` + `/status`, graceful shutdown. _AC:_ the vitest unit tests pass; the UI badge shows the heartbeat.
7. **Product UI:** the `/` page with position card, Shield form (approve → activate), activity, unregister/revoke. _AC:_ a fresh wallet on the fork can opt in end to end.
8. **[STRETCH] Production adapter:** UniswapV3SwapAdapter + tests 14 + `Deploy.s.sol` for mainnet. Check which WETH/USDC pool fee tier on Monad has liquidity, or route through WMON.
9. **[STRETCH]** auto re-leverage on recovery (with a hysteresis band); a time-to-liquidation trigger (HF slope per block); multi-protocol support (Euler, Morpho, Curvance).

## 12. Demo script (about 2 minutes)

1. "Two identical $X loans on Aave on Monad. The right one has Liquidation Shield, which checks it every block." Point at the heartbeat badge.
2. Click **Crash −25%** (or slow crash). Both HF lines drop.
3. The left loan crosses 1.0 and the liquidator bot seizes collateral; the penalty shows in red. The right loan steps down over a few blocks (green ticks) and levels off at 1.40.
4. Point at **"Shield saved $X."**
5. "Checking every block costs fractions of a cent on Monad. On Ethereum, that would cost a fortune."

**Q&A answers to keep ready:** if the bot is down, `protect` is permissionless and the heartbeat makes uptime public. The Shield can't steal funds: it acts only below the user's own trigger, only up to their target and slippage, and never holds funds. A slow oracle hits liquidators equally; an early trigger and gradual steps give a buffer. Versus DeFi Saver: same idea, but it isn't on Monad, and per-block checking only makes economic sense on a fast, cheap chain.

## 13. Open questions (the only things to interview about)

- Keeper fee default (10 bps?) and whether to have a protocol fee recipient at all.
- Whether WETH/USDC on Uniswap V3 Monad has enough liquidity at fee 500 vs 3000, or whether to route through WMON (affects slice 8 only).
- The hosted keeper for after the hackathon (Railway/Fly?), out of scope today.
- Whether to support multiple Shield configs per user (one per collateral/debt pair). Today it's one per user, which is fine because Aave health is account-wide.

## 14. Non-goals (today)

Audits, a mainnet deployment with real funds, governance or a token, a keeper network or MEV protection, non-Aave protocols, mobile layout polish beyond "doesn't break", gasless or EIP-7702 onboarding.

## 15. Definition of done (hackathon)

- `forge test` is green, including the fuzz test. The fork tests pass when `MONAD_RPC_URL` is set.
- One command sequence (§9) brings up the full demo on a laptop.
- `/demo` runs the §12 script with no terminal interaction after start.
- The README covers the architecture diagram, run steps, the safety model (§5.4–5.5, §6.4), and the "why Monad" paragraph.
