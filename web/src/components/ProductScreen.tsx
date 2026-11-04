"use client";
// The product page (BRIEF §8, #18): a real borrower opts in on Monad testnet with their own wallet.
// Faucet (operator route) → approve / supply / borrow to HF 1.30 → Approve atWETH → Activate Shield → watch Steps →
// Unregister / Revoke. Every tx links to the testnet explorer.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { getAbiItem, maxUint256, type Address, type Hex } from "viem";
import { useBalance, useConnect, useConnection, useConnectors, useDisconnect, useReadContracts, useSwitchChain, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  explorerAddressUrl,
  explorerTxUrl,
  liquidationShieldAbi,
  TESTNET_CHAIN_ID,
  testnetERC20Abi,
  testnetOracleAbi,
  testnetPoolAbi,
} from "@liquidation-shield/shared";
import { client, useDemoState, type DemoState } from "@/lib/feed";
import { DEFAULT_FORM, formFromConfig, validateShieldForm, type ShieldForm } from "@/lib/shieldForm";
import { wagmiConfig } from "@/lib/wagmi";
import { LogoMark } from "@/components/landing/Logo";
import { HeartbeatBadge, useHeartbeat } from "@/components/common";

const WAD = 1e18;
const BASE = 1e8; // Aave base currency: USD, 8 decimals
const START_HF_MILLI = 1_300n; // the sample loan opens at HF 1.30
const ACTIONS = ["None", "Step", "ClearUnwind"] as const;

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const amt = (raw: bigint, decimals: number, digits = 3) =>
  (Number(raw) / 10 ** decimals).toLocaleString("en-US", { maximumFractionDigits: digits });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const hfOf = (raw: bigint) => (raw > 10n ** 30n ? Infinity : Number(raw) / WAD);
const hfText = (hf: number | undefined) => (hf === undefined ? "—" : Number.isFinite(hf) ? hf.toFixed(3) : "∞");

function errorText(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string; name?: string };
  const msg = err.shortMessage ?? err.message ?? String(e);
  if (/user rejected|denied/i.test(msg)) return "Rejected in wallet.";
  return msg.split("\n")[0]!;
}

function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

// ------------------------------------------------------------------------------------------------ page

export function ProductScreen() {
  const mounted = useMounted();
  const state = useDemoState();
  const s = state.data;
  const { heartbeat, head, blockTime } = useHeartbeat(s?.shield, s?.keeper);
  const { address, chainId, isConnected } = useConnection();
  const onTestnet = chainId === TESTNET_CHAIN_ID;

  return (
    <main className="demo product">
      <header className="topbar">
        <div className="brand">
          <Link href="/" className="brand-mark" aria-label="Home">
            <LogoMark />
          </Link>
          <div>
            <h1>Liquidation Shield</h1>
            <p className="eyebrow">Per-block protection · Aave V3-compatible test pool</p>
          </div>
        </div>
        <div className="badges">
          <span className="badge badge-testnet">
            <span className="dot" /> Testnet · chain {TESTNET_CHAIN_ID}
          </span>
          <HeartbeatBadge heartbeat={heartbeat} head={head} blockTime={blockTime} />
          <Link className="badge" href="/demo">
            Live demo ↗
          </Link>
          {mounted && <WalletButton />}
        </div>
      </header>

      {state.error && !s ? (
        <section className="panel">
          <p className="eyebrow">Not deployed</p>
          <p>{state.error.message}</p>
        </section>
      ) : !mounted || !isConnected || !address ? (
        <Intro />
      ) : !onTestnet ? (
        <WrongChain />
      ) : !s ? (
        <section className="panel">Loading deployment…</section>
      ) : (
        <Dashboard s={s} user={address} />
      )}
    </main>
  );
}

function WalletButton() {
  const { address, isConnected } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  if (isConnected && address) {
    return (
      <button className="badge wallet" onClick={() => disconnect.mutate()} title="Disconnect">
        <span className="dot" /> {short(address)} · disconnect
      </button>
    );
  }
  const injected = connectors[0];
  return (
    <button className="btn btn-primary" disabled={!injected || connect.isPending} onClick={() => injected && connect.mutate({ connector: injected })}>
      {connect.isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}

function Intro() {
  const connectors = useConnectors();
  const connect = useConnect();
  const injected = connectors[0];
  return (
    <section className="panel intro">
      <p className="eyebrow">Monad testnet · bring your own wallet</p>
      <h2>Don&apos;t get liquidated. Get deleveraged, a little every block.</h2>
      <p className="muted">
        Opt in with your trigger and target health factor, grant one revocable atWETH allowance, and the keeper checks
        your loan every block (~0.4s). Below your trigger, a flash-loan Step repays debt and sells just enough collateral,
        step by step, until you&apos;re back at target. You pay a small swap cost instead of a 5–10% liquidation penalty.
      </p>
      <ol className="intro-steps">
        <li>Connect a wallet on Monad testnet</li>
        <li>Get 10 tWETH from the faucet and open a sample loan at HF 1.30</li>
        <li>Approve atWETH, then activate your Shield</li>
        <li>Watch Steps land after a price crash; unregister and revoke any time</li>
      </ol>
      <div className="row">
        <button className="btn btn-primary" disabled={!injected || connect.isPending} onClick={() => injected && connect.mutate({ connector: injected })}>
          {injected ? (connect.isPending ? "Connecting…" : "Connect wallet") : "No browser wallet found"}
        </button>
        <Link className="btn btn-ghost" href="/demo">
          Watch the live demo →
        </Link>
      </div>
      {connect.error && <p className="field-error">{errorText(connect.error)}</p>}
    </section>
  );
}

function WrongChain() {
  const sw = useSwitchChain();
  return (
    <section className="panel intro">
      <p className="eyebrow">Wrong network</p>
      <h2>Switch your wallet to Monad testnet (chain {TESTNET_CHAIN_ID}).</h2>
      <p className="muted">Nothing on this page sends a transaction on any other chain.</p>
      <div className="row">
        <button className="btn btn-primary" disabled={sw.isPending} onClick={() => sw.mutate({ chainId: TESTNET_CHAIN_ID })}>
          {sw.isPending ? "Check your wallet…" : "Switch to Monad testnet"}
        </button>
      </div>
      {sw.error && <p className="field-error">{errorText(sw.error)}</p>}
    </section>
  );
}

// ------------------------------------------------------------------------------------------- dashboard

type Reads = {
  account: readonly [bigint, bigint, bigint, bigint, bigint, bigint];
  wethPrice: number;
  weth: bigint; // wallet tWETH
  usdc: bigint; // wallet tUSDC
  aWeth: bigint; // supplied (atWETH)
  wethAllowance: bigint; // tWETH → pool
  aWethAllowance: bigint; // atWETH → Shield
  config: {
    collateralAsset: Address;
    debtAsset: Address;
    triggerHF: bigint;
    targetHF: bigint;
    maxStepBps: number;
    maxSlippageBps: number;
    active: boolean;
    unwinding: boolean;
  };
  preview: { action: number; healthFactor: bigint };
};

function useUserReads(s: DemoState, user: Address) {
  const erc = (token: Address, fn: "balanceOf", args: readonly [Address]) =>
    ({ address: token, abi: testnetERC20Abi, functionName: fn, args }) as const;
  const q = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: s.pool, abi: testnetPoolAbi, functionName: "getUserAccountData", args: [user] },
      { address: s.oracle, abi: testnetOracleAbi, functionName: "getAssetPrice", args: [s.weth] },
      erc(s.weth, "balanceOf", [user]),
      erc(s.usdc, "balanceOf", [user]),
      erc(s.aWeth, "balanceOf", [user]),
      { address: s.weth, abi: testnetERC20Abi, functionName: "allowance", args: [user, s.pool] },
      { address: s.aWeth, abi: testnetERC20Abi, functionName: "allowance", args: [user, s.shield] },
      { address: s.shield, abi: liquidationShieldAbi, functionName: "getConfig", args: [user] },
      { address: s.shield, abi: liquidationShieldAbi, functionName: "previewProtect", args: [user] },
    ],
    query: { refetchInterval: 1_500 },
  });
  const data: Reads | undefined = q.data
    ? {
        account: q.data[0],
        wethPrice: Number(q.data[1]) / BASE,
        weth: q.data[2],
        usdc: q.data[3],
        aWeth: q.data[4],
        wethAllowance: q.data[5],
        aWethAllowance: q.data[6],
        config: q.data[7],
        preview: q.data[8],
      }
    : undefined;
  return { data, refetch: q.refetch, error: q.error };
}

type TxView = { label: string; hash?: Hex; state: "wallet" | "pending" | "done" | "error"; error?: string };

/** Sends one wallet tx at a time and tracks it until its receipt. */
function useTx(onDone: () => void) {
  const write = useWriteContract();
  const [tx, setTx] = useState<TxView>();
  const busy = tx?.state === "wallet" || tx?.state === "pending";

  async function run(label: string, params: Parameters<typeof write.mutateAsync>[0]): Promise<boolean> {
    setTx({ label, state: "wallet" });
    let hash: Hex | undefined;
    try {
      hash = await write.mutateAsync({ ...params, chainId: TESTNET_CHAIN_ID });
      setTx({ label, hash, state: "pending" });
      const r = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: TESTNET_CHAIN_ID });
      if (r.status !== "success") throw new Error("Transaction reverted.");
      setTx({ label, hash, state: "done" });
      onDone();
      return true;
    } catch (e) {
      setTx({ label, hash, state: "error", error: errorText(e) });
      return false;
    }
  }
  return { tx, busy, run, setTx };
}

function Dashboard({ s, user }: { s: DemoState; user: Address }) {
  const reads = useUserReads(s, user);
  const gas = useBalance({ address: user, chainId: TESTNET_CHAIN_ID, query: { refetchInterval: 3_000 } });
  const refresh = () => {
    void reads.refetch();
    void gas.refetch();
  };
  const tx = useTx(refresh);
  const r = reads.data;

  if (!r) {
    return <section className="panel">{reads.error ? `Couldn't read your position: ${errorText(reads.error)}` : "Reading your position…"}</section>;
  }

  const hasDebt = r.account[1] > 0n;
  return (
    <>
      <section className="product-grid">
        <PositionCard r={r} gas={gas.data?.value} />
        <ShieldCard s={s} r={r} tx={tx} />
      </section>
      {!hasDebt || r.weth > 0n ? <LoanCard s={s} user={user} r={r} gas={gas.data?.value} tx={tx} refresh={refresh} /> : null}
      <TxLine tx={tx.tx} />
      <Activity s={s} user={user} />
    </>
  );
}

function TxLine({ tx }: { tx?: TxView }) {
  if (!tx) return null;
  const text =
    tx.state === "wallet" ? "Confirm in your wallet…" : tx.state === "pending" ? "Waiting for the block…" : tx.state === "done" ? "Confirmed" : tx.error;
  return (
    <section className={`panel txline tx-${tx.state}`}>
      <span className="eyebrow">{tx.label}</span>
      <span>{text}</span>
      {tx.hash && (
        <a className="mono" href={explorerTxUrl(tx.hash)} target="_blank" rel="noreferrer">
          {short(tx.hash)} ↗
        </a>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------- position

function PositionCard({ r, gas }: { r: Reads; gas?: bigint }) {
  const hf = hfOf(r.account[5]);
  const collateral = Number(r.account[0]) / BASE;
  const debt = Number(r.account[1]) / BASE;
  const trigger = r.config.active ? Number(r.config.triggerHF) / WAD : undefined;
  const target = r.config.active ? Number(r.config.targetHF) / WAD : undefined;
  const color = hf < 1 ? "var(--red)" : trigger && hf < trigger ? "var(--amber)" : "var(--text)";
  return (
    <article className="panel">
      <div className="card-head">
        <div>
          <p className="eyebrow">Your Position</p>
          <h2 className="card-title">tWETH collateral · tUSDC debt</h2>
        </div>
        <span className="chip">tWETH {usd(r.wethPrice)}</span>
      </div>
      <div className="hf">
        <span className="hf-value mono" style={{ color }}>
          {debt > 0 ? hfText(hf) : "—"}
        </span>
        <span className="hf-label">{debt > 0 ? "HEALTH FACTOR" : "NO LOAN YET"}</span>
      </div>
      <HfGauge hf={debt > 0 ? hf : undefined} trigger={trigger} target={target} />
      <div className="stats">
        <Stat label="Collateral" value={usd(collateral)} sub={`${amt(r.aWeth, 18)} atWETH`} />
        <Stat label="Debt" value={usd(debt)} sub="tUSDC" />
        <Stat label="Wallet" value={`${amt(r.weth, 18)} tWETH`} sub={`${amt(r.usdc, 6, 0)} tUSDC · ${gas === undefined ? "—" : amt(gas, 18, 3)} MON`} />
      </div>
    </article>
  );
}

/** HF gauge from 0.9 to 2.0, with the 1.0 liquidation line and the user's trigger and target markers. */
function HfGauge({ hf, trigger, target }: { hf?: number; trigger?: number; target?: number }) {
  const lo = 0.9;
  const hi = 2.0;
  const pos = (x: number) => `${((Math.min(Math.max(x, lo), hi) - lo) / (hi - lo)) * 100}%`;
  return (
    <div className="gauge" aria-label={`Health factor ${hfText(hf)}`}>
      <div className="gauge-track">
        <div className="gauge-zone zone-red" style={{ width: pos(1) }} />
        {hf !== undefined && <div className="gauge-needle" style={{ left: pos(hf) }} />}
      </div>
      <div className="gauge-marks">
        <span className="mark mark-liq" style={{ left: pos(1) }}>
          1.00
        </span>
        {trigger !== undefined && (
          <span className="mark mark-trigger" style={{ left: pos(trigger) }}>
            trigger {trigger.toFixed(2)}
          </span>
        )}
        {target !== undefined && (
          <span className="mark mark-target" style={{ left: pos(target) }}>
            target {target.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="stat-value mono">{value}</div>
      {sub && <div className="stat-sub mono">{sub}</div>}
    </div>
  );
}

// ------------------------------------------------------------------------------------------- sample loan

function LoanCard({
  s,
  user,
  r,
  gas,
  tx,
  refresh,
}: {
  s: DemoState;
  user: Address;
  r: Reads;
  gas?: bigint;
  tx: ReturnType<typeof useTx>;
  refresh: () => void;
}) {
  const [faucet, setFaucet] = useState<{ state: "idle" | "busy" | "done" | "error"; msg?: string; mint?: Hex; gas?: Hex }>({ state: "idle" });
  const hasDebt = r.account[1] > 0n;
  const hasWeth = r.weth > 0n;
  const supplied = r.aWeth > 0n;
  const approved = r.wethAllowance >= r.weth && r.wethAllowance > 0n;
  const noGas = gas !== undefined && gas === 0n;

  // tUSDC to borrow so the Position sits at HF 1.30: C·LT/1.30 − D, base (8 dec) → tUSDC (6 dec).
  const [c, d, , lt] = r.account;
  const want = (c * lt * 1_000n) / (10_000n * START_HF_MILLI);
  const borrow = want > d ? (want - d) / 100n : 0n;

  async function getTokens() {
    setFaucet({ state: "busy" });
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: user }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setFaucet({ state: "done", mint: body.mint, gas: body.gas });
      refresh();
    } catch (e) {
      setFaucet({ state: "error", msg: (e as Error).message });
    }
  }

  const steps: { done: boolean; label: string; detail: ReactNode; action?: ReactNode }[] = [
    {
      done: hasWeth || supplied,
      label: "Get 10 tWETH",
      detail: (
        <>
          Testnet faucet: the operator mints 10 tWETH to your wallet{noGas ? " and sends a little MON for gas" : ""}.
          {faucet.mint && (
            <>
              {" "}
              <a href={explorerTxUrl(faucet.mint)} target="_blank" rel="noreferrer" className="mono">
                mint ↗
              </a>
            </>
          )}
          {faucet.gas && (
            <>
              {" "}
              <a href={explorerTxUrl(faucet.gas)} target="_blank" rel="noreferrer" className="mono">
                gas ↗
              </a>
            </>
          )}
          {faucet.state === "error" && <span className="field-error"> {faucet.msg}</span>}
        </>
      ),
      action: (
        <button className="btn btn-primary" disabled={faucet.state === "busy" || hasWeth || supplied} onClick={getTokens}>
          {faucet.state === "busy" ? "Minting…" : "Get 10 tWETH"}
        </button>
      ),
    },
    {
      done: supplied || (approved && hasWeth),
      label: "Approve tWETH",
      detail: "Let the test pool take the tWETH you supply.",
      action: (
        <button
          className="btn"
          disabled={tx.busy || !hasWeth || approved}
          onClick={() => tx.run("Approve tWETH", { address: s.weth, abi: testnetERC20Abi, functionName: "approve", args: [s.pool, maxUint256] })}
        >
          Approve
        </button>
      ),
    },
    {
      done: supplied && !hasWeth,
      label: `Supply ${hasWeth ? amt(r.weth, 18) : ""} tWETH`.replace("  ", " "),
      detail: "Deposit it as collateral; you receive atWETH.",
      action: (
        <button
          className="btn"
          disabled={tx.busy || !hasWeth || !approved}
          onClick={() => tx.run("Supply tWETH", { address: s.pool, abi: testnetPoolAbi, functionName: "supply", args: [s.weth, r.weth, user, 0] })}
        >
          Supply
        </button>
      ),
    },
    {
      done: hasDebt,
      label: `Borrow ${borrow > 0n ? amt(borrow, 6, 0) : ""} tUSDC → HF 1.30`.replace("  ", " "),
      detail: "Open the sample loan at the demo's starting health factor.",
      action: (
        <button
          className="btn"
          disabled={tx.busy || !supplied || borrow === 0n || hasDebt}
          onClick={() => tx.run("Borrow tUSDC", { address: s.pool, abi: testnetPoolAbi, functionName: "borrow", args: [s.usdc, borrow, 2n, 0, user] })}
        >
          Borrow
        </button>
      ),
    },
  ];

  return (
    <section className="panel">
      <div className="card-head">
        <div>
          <p className="eyebrow">Sample loan</p>
          <h2 className="card-title">Open a loan to protect</h2>
        </div>
      </div>
      <ol className="checklist">
        {steps.map((st, i) => (
          <li key={st.label} className={st.done ? "done" : ""}>
            <span className="check mono">{st.done ? "✓" : i + 1}</span>
            <div>
              <div className="check-label">{st.label}</div>
              <div className="check-detail">{st.detail}</div>
            </div>
            {!st.done && st.action}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ------------------------------------------------------------------------------------------- shield

function ShieldCard({ s, r, tx }: { s: DemoState; r: Reads; tx: ReturnType<typeof useTx> }) {
  const active = r.config.active;
  const [form, setForm] = useState<ShieldForm>(() =>
    active ? formFromConfig(r.config) : { collateral: s.weth, debt: s.usdc, ...DEFAULT_FORM },
  );
  const [touched, setTouched] = useState(false);
  // When a config appears (or changes) on-chain and the user hasn't edited, mirror it.
  useEffect(() => {
    if (active && !touched) setForm(formFromConfig(r.config));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, r.config.triggerHF, r.config.targetHF, r.config.maxStepBps, r.config.maxSlippageBps]);

  const listed = [s.weth, s.usdc];
  const { errors, args } = useMemo(() => validateShieldForm(form, listed), [form, s.weth, s.usdc]); // eslint-disable-line react-hooks/exhaustive-deps
  const approved = r.aWethAllowance > 0n;
  const unlimited = r.aWethAllowance > maxUint256 / 2n;
  const set = (k: keyof ShieldForm) => (e: { target: { value: string } }) => {
    setTouched(true);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  const status = !active
    ? { label: "NOT ACTIVE", tone: "var(--dim)" }
    : r.config.unwinding
      ? { label: "UNWINDING", tone: "var(--purple-hi)" }
      : approved
        ? { label: "SHIELD ARMED", tone: "var(--green)" }
        : { label: "NEEDS APPROVAL", tone: "var(--amber)" };

  const assetOptions = [
    { value: s.weth, label: "tWETH" },
    { value: s.usdc, label: "tUSDC" },
  ];

  return (
    <article className="panel shield-card">
      <div className="card-head">
        <div>
          <p className="eyebrow">Liquidation Shield</p>
          <h2 className="card-title">{active ? "Your Shield" : "Activate your Shield"}</h2>
        </div>
        <span className="chip" style={{ color: status.tone }}>
          {status.label}
        </span>
      </div>
      {active && (
        <p className="muted small">
          Keeper preview: <b className="mono">{ACTIONS[r.preview.action] ?? "None"}</b>
          {r.config.unwinding ? " · stepping back to target" : ""}
        </p>
      )}

      <form
        className="shield-form"
        onSubmit={(e) => {
          e.preventDefault();
        }}
        noValidate
      >
        <Field label="Collateral" error={errors.collateral}>
          <select value={form.collateral} onChange={set("collateral")}>
            {assetOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Debt" error={errors.debt}>
          <select value={form.debt} onChange={set("debt")}>
            {assetOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Trigger HF" hint="act below this · ≥ 1.02" error={errors.trigger}>
          <input inputMode="decimal" value={form.trigger} onChange={set("trigger")} />
        </Field>
        <Field label="Target HF" hint="unwind back to · ≥ trigger + 0.05, ≤ 3.00" error={errors.target}>
          <input inputMode="decimal" value={form.target} onChange={set("target")} />
        </Field>
        <Field label="Max step %" hint="of debt per Step · 5–100" error={errors.stepPct}>
          <input inputMode="decimal" value={form.stepPct} onChange={set("stepPct")} />
        </Field>
        <Field label="Max slippage %" hint="swap cost cap · 0.1–5" error={errors.slippagePct}>
          <input inputMode="decimal" value={form.slippagePct} onChange={set("slippagePct")} />
        </Field>
      </form>

      <div className="cta">
        <button
          className={`btn ${approved ? "" : "btn-primary"}`}
          disabled={tx.busy || approved}
          onClick={() => tx.run("Approve atWETH", { address: s.aWeth, abi: testnetERC20Abi, functionName: "approve", args: [s.shield, maxUint256] })}
        >
          <span className="mono">1</span> {approved ? "atWETH approved" : "Approve atWETH"}
        </button>
        <button
          className={`btn ${approved ? "btn-primary" : ""}`}
          disabled={tx.busy || !approved || !args}
          onClick={() =>
            args &&
            tx
              .run(active ? "Update Shield" : "Activate Shield", { address: s.shield, abi: liquidationShieldAbi, functionName: "register", args })
              .then((ok) => ok && setTouched(false))
          }
        >
          <span className="mono">2</span> {active ? "Update Shield" : "Activate Shield"}
        </button>
      </div>
      {!args && <p className="field-error">Fix the highlighted fields first. Nothing is sent until the form is valid.</p>}

      <div className="danger">
        <div>
          <p className="eyebrow">Opt out any time</p>
          <p className="muted small">
            Allowance to the Shield:{" "}
            <b className="mono">{approved ? (unlimited ? "unlimited atWETH" : `${amt(r.aWethAllowance, 18)} atWETH`) : "none"}</b>
          </p>
        </div>
        <div className="row">
          <button
            className="btn btn-ghost"
            disabled={tx.busy || !active}
            onClick={() => tx.run("Unregister", { address: s.shield, abi: liquidationShieldAbi, functionName: "unregister" })}
          >
            Unregister
          </button>
          <button
            className="btn btn-danger"
            disabled={tx.busy || !approved}
            onClick={() => tx.run("Revoke atWETH approval", { address: s.aWeth, abi: testnetERC20Abi, functionName: "approve", args: [s.shield, 0n] })}
          >
            Revoke approval
          </button>
        </div>
      </div>
      <p className="muted small">
        Shield{" "}
        <a className="mono" href={explorerAddressUrl(s.shield)} target="_blank" rel="noreferrer">
          {short(s.shield)} ↗
        </a>{" "}
        · it only acts below your trigger, only up to your target, within your slippage cap, and holds no funds.
      </p>
    </article>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className={`field${error ? " invalid" : ""}`}>
      <span className="field-label">
        {label}
        {hint && <span className="field-hint">{hint}</span>}
      </span>
      {children}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

// ------------------------------------------------------------------------------------------- activity

type Row = {
  id: string;
  kind: "step" | "unwound";
  block: bigint;
  hash: Hex;
  hfBefore?: number;
  hfAfter?: number;
  repaid?: bigint;
  sold?: bigint;
  fee?: bigint;
};

const protectedEvent = getAbiItem({ abi: liquidationShieldAbi, name: "Protected" });
const unwoundEvent = getAbiItem({ abi: liquidationShieldAbi, name: "UnwindComplete" });
const BACKFILL_BLOCKS = 3_000n; // ~20 min at 0.4s; the public RPC caps eth_getLogs at 100 blocks per call

/** This user's Protected / UnwindComplete events: a bounded backfill, then incremental polling. */
function useActivity(s: DemoState, user: Address) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    setRows([]);
    let cursor: bigint | undefined;
    let stopped = false;
    let polling = false;
    const deployBlock = BigInt(s.deployBlock);

    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const latest = await client.getBlockNumber();
        let next = cursor ?? (latest > BACKFILL_BLOCKS ? latest - BACKFILL_BLOCKS : 0n);
        if (next < deployBlock) next = deployBlock;
        while (!stopped && next <= latest) {
          const toBlock = next + 99n < latest ? next + 99n : latest;
          const [steps, unwinds] = await Promise.all([
            client.getLogs({ address: s.shield, event: protectedEvent, args: { user }, fromBlock: next, toBlock }),
            client.getLogs({ address: s.shield, event: unwoundEvent, args: { user }, fromBlock: next, toBlock }),
          ]);
          if (stopped) return;
          const out: Row[] = [
            ...steps.map((l) => ({
              id: `${l.transactionHash}-${l.logIndex}`,
              kind: "step" as const,
              block: l.blockNumber!,
              hash: l.transactionHash!,
              hfBefore: Number(l.args.hfBefore) / WAD,
              hfAfter: Number(l.args.hfAfter) / WAD,
              repaid: l.args.debtRepaid,
              sold: l.args.collateralSold,
              fee: l.args.keeperFee,
            })),
            ...unwinds.map((l) => ({ id: `${l.transactionHash}-${l.logIndex}`, kind: "unwound" as const, block: l.blockNumber!, hash: l.transactionHash! })),
          ];
          if (out.length) setRows((prev) => [...prev, ...out]);
          next = toBlock + 1n;
          cursor = next;
        }
      } catch {
        // rate limit or transient error: retry from the same cursor
      } finally {
        polling = false;
      }
    };
    void poll();
    const id = setInterval(poll, 3_000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [s.shield, user]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => [...rows].sort((a, b) => (a.block === b.block ? 0 : a.block > b.block ? -1 : 1)), [rows]);
}

function Activity({ s, user }: { s: DemoState; user: Address }) {
  const rows = useActivity(s, user);
  return (
    <section className="panel ticker activity">
      <p className="eyebrow">Activity · your protection Steps · every line opens on the testnet explorer</p>
      <ol>
        {rows.length === 0 && <li className="empty">No Steps yet. They appear here when your HF drops below the trigger.</li>}
        {rows.map((e) => (
          <li key={e.id}>
            <a className={e.kind === "step" ? "k-step" : "k-unwound"} href={explorerTxUrl(e.hash)} target="_blank" rel="noreferrer">
              <span className="dot" />
              <span className="text">
                {e.kind === "step"
                  ? `Step · HF ${e.hfBefore!.toFixed(3)} → ${e.hfAfter!.toFixed(3)} · repaid ${amt(e.repaid!, 6, 0)} tUSDC · sold ${amt(e.sold!, 18)} tWETH · keeper fee ${amt(e.fee!, 6, 2)} tUSDC`
                  : "Unwind complete · back at target HF"}
              </span>
              <span className="blk mono">#{e.block.toString()} ↗</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
