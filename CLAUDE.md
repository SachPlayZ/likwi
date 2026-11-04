# Liquidation Shield

Non-custodial, per-block liquidation protection for Aave V3 borrowers on Monad. A permissionless `protect(user)` call deleverages a Position with a flash loan, gradually across blocks, before it can be liquidated. Built in one day for Monad Blitz (DevCon Mumbai); the demo is the deliverable.

## Sources of truth (read before working)

1. **`BRIEF.md`**: full design. §5 and §16 are **final decisions; don't re-litigate them**. §3 is the vocabulary (Position, HF, Trigger/Target HF, Step, Unwind, Keeper, ...). Use those terms in code, tests, issues and commits.
2. **Spec: GitHub issue #10** (`gh issue view 10`): user stories, implementation and testing decisions.
3. **Tickets: #11–#20**: sub-issues of #10 with native blocking links. Work only on a ticket whose blockers are all closed. Slice #15 is the minimum viable demo; #19–#20 are stretch.

If code and BRIEF disagree, flag it to the user; don't silently pick one.

## Workflow

- Pick a frontier ticket: `gh issue list --label ready-for-agent --state open`, then check that its blockers are closed (see `docs/agents/issue-tracker.md`).
- One ticket = one branch = one PR. Reference the ticket (`Closes #N`). Don't commit to `main` directly.
- **Tests first** (`/tdd`). Each ticket lists its tests (numbering follows BRIEF §6.7).
- A ticket is done only when its acceptance criteria are checked and its tests are green. Paste the test output in the PR.
- Keep commits and PR text short. Conventional prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `test:`).

## Test seams (agreed; don't add new ones without asking)

1. **`LiquidationShield` public interface**: unit and fuzz tests against MockAave; fork tests against real Aave (skipped when `MONAD_RPC_URL` is unset). Test through the external interface only.
2. **Keeper tick with an injected viem client**: vitest with a stubbed client. The registry, executor and loop are tested only through tick behaviour.
3. **End-to-end demo on anvil**: the BRIEF §12 script, run from the browser, is the acceptance test for web and demo tooling.

## Invariants that must never break

- **The Shield holds no funds after any call.** Assert it after every Step in tests.
- Repay debt **before** pulling collateral aTokens (aToken transfers re-check HF).
- k = 1 + slippage + flash premium + keeper fee. The flash premium is read from the pool (`FLASHLOAN_PREMIUM_TOTAL`), **never hardcoded**.
- `protect` acts only if `hf < trigger || (unwinding && hf < target·0.995)`. If `unwinding && hf ≥ target·0.995`, it clears the flag (ClearUnwind) and returns without a fee.
- A Step must strictly raise HF, or revert.
- Use `SafeERC20.forceApprove`, and reset the adapter approval to 0 after each swap.
- `OracleSwapAdapter` and `DemoPriceFeed` are **forks/testnets only**. Never wire them into a mainnet deploy.

## Stack and environment

- Contracts: Foundry, solc **0.8.28**, `evm_version = "prague"`, optimizer 10k runs, OpenZeppelin v5. Don't turn on via-IR; split functions instead.
- Keeper and demo scripts: TypeScript + viem. Web: Next.js App Router + wagmi + viem + TanStack Query + Recharts.
- npm workspaces: `contracts`, `packages/shared`, `keeper`, `demo`, `web`. ABIs come from codegen into `packages/shared`; never hand-write ABIs.
- Monad mainnet is chain **143**. The demo fork is chain **31430** (`anvil --block-time 0.4`). Anything that writes anvil RPC (crash, reset, faucet) must be gated to 31430.
- Addresses are in BRIEF §10. Re-verify them before any mainnet action. **No mainnet deploys with real funds** (non-goal).
- Never commit secrets (`KEEPER_PRIVATE_KEY`, RPC keys). Generated env files (`web/.env.local`, `demo/.deployments.json`) stay untracked.

## Commands

Planned in BRIEF §9 and §11; they become real as tickets #11 and #15 land. Check `package.json` before relying on them, and update this section when they change.

- `forge build` / `forge test` (in `contracts/`)
- `npm run abis`: regenerate typed ABIs
- Demo day order: `npm run fork` → `npm run demo:setup` → `npm run keeper` → `npm run demo:liquidator` → `npm run web`, then open `/demo`

## Agent skills

### Issue tracker

GitHub Issues on `SachPlayZ/monad-blitz-devcon-mumbai` via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.
