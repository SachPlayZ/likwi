"use client";
// The hackathon screen (BRIEF §8, §12): Alice (unprotected) vs Bob (shielded), live on Monad testnet.
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { explorerAddressUrl, explorerTxUrl, TESTNET_CHAIN_ID } from "@liquidation-shield/shared";
import {
  deriveTicker,
  operatorEvents,
  postAction,
  useBlockFeed,
  useDemoState,
  useLogFeed,
  type Point,
  type Side,
  type Snapshot,
  type TickerEvent,
  type Totals,
} from "@/lib/feed";
import { HeartbeatBadge, ShieldIcon } from "@/components/common";

const usd = (n: number, digits = 0) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
const hfText = (hf: number | undefined) => (hf === undefined ? "—" : Number.isFinite(hf) ? hf.toFixed(3) : "∞");
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function DemoScreen() {
  const state = useDemoState();
  const s = state.data;
  const { snap, points, blockTime } = useBlockFeed(s);
  const { events, heartbeat, head } = useLogFeed(s);
  const [actionError, setActionError] = useState<string>();

  const { ticker, totals } = useMemo(() => {
    const { lines, totals } = deriveTicker(events, s?.txs ?? []);
    // Newest first. Inputs are chronological, so reverse before the (stable) sort keeps same-block order newest first too.
    const ticker = [...lines, ...operatorEvents(s)].reverse().sort((a, b) => (a.block === b.block ? 0 : a.block > b.block ? -1 : 1));
    return { ticker, totals };
  }, [events, s]);

  const act = (path: "reset" | "crash", body?: object) => {
    setActionError(undefined);
    postAction(path, body)
      .then(() => state.refetch())
      .catch((e: Error) => setActionError(e.message));
  };

  if (state.error && !s) {
    return (
      <main className="demo">
        <div className="panel">
          <p className="eyebrow">Not deployed</p>
          <p>{state.error.message}</p>
        </div>
      </main>
    );
  }

  const busy = s?.busy ?? null;
  const ready = Boolean(s?.run);
  const error = actionError ?? s?.error;

  return (
    <main className="demo">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            <ShieldIcon />
          </div>
          <div>
            <h1>Liquidation Shield</h1>
            <p className="eyebrow">Per-block protection · Aave V3-compatible test pool</p>
          </div>
        </div>
        <div className="badges">
          <span className="badge badge-testnet">
            <span className="dot" /> Testnet · chain {TESTNET_CHAIN_ID}
          </span>
          <HeartbeatBadge heartbeat={heartbeat} head={snap?.block ?? head} blockTime={blockTime} />
          <div className="price">
            <span className="eyebrow">tWETH</span>
            <span className="price-value mono">{snap ? usd(snap.price, 2) : "—"}</span>
          </div>
        </div>
      </header>

      <section className="hero">
        <PositionCard
          who="Alice"
          role="Unprotected"
          address={s?.run?.alice}
          side={snap?.alice}
          status={aliceStatus(snap, totals)}
          className="side-alice"
          flash={totals.liquidations > 0}
        />
        <SavedPanel snap={snap} totals={totals} />
        <PositionCard
          who="Bob"
          role="Shielded"
          address={s?.run?.bob}
          side={snap?.bob}
          status={bobStatus(snap, totals)}
          className="side-bob"
          extra={`${totals.steps} Step${totals.steps === 1 ? "" : "s"}`}
        />
      </section>

      <section className="middle">
        <HfChart points={points} snap={snap} />
        <Ticker events={ticker} />
      </section>

      <section className="panel controls">
        <button className="btn btn-primary" disabled={!ready || !!busy} onClick={() => act("crash", { mode: "slow" })}>
          ▼ Slow crash · −3%/s for 10s
        </button>
        {[5, 15, 25].map((pct) => (
          <button key={pct} className="btn" disabled={!ready || !!busy} onClick={() => act("crash", { pct })}>
            −{pct}%
          </button>
        ))}
        <span className="spacer" />
        <span className={`status${error ? " err" : ""}`}>
          {error ?? (busy === "crash" ? "Crashing tWETH…" : busy === "reset" ? "Resetting…" : s?.run ? `Run ${s.run.n}` : "")}
        </span>
        <button className="btn btn-ghost" disabled={!s || !!busy} onClick={() => act("reset")}>
          ↺ Reset
        </button>
      </section>

      {busy === "reset" && (
        <div className="overlay">
          <div>
            <p className="eyebrow" style={{ textAlign: "center" }}>
              Reset
            </p>
            Opening fresh loans for a new Alice &amp; Bob on testnet…
          </div>
        </div>
      )}
    </main>
  );
}

// ------------------------------------------------------------------------------------------- pieces

type Status = { label: string; tone: "ok" | "warn" | "bad" | "purple" };

function aliceStatus(snap: Snapshot | undefined, t: Totals): Status {
  if (t.liquidations > 0) return { label: "LIQUIDATED", tone: "bad" };
  if (!snap) return { label: "LOADING", tone: "warn" };
  if (snap.alice.hf < 1) return { label: "LIQUIDATABLE", tone: "bad" };
  if (snap.alice.hf < snap.trigger) return { label: "AT RISK", tone: "warn" };
  return { label: "NO PROTECTION", tone: "warn" };
}

function bobStatus(snap: Snapshot | undefined, t: Totals): Status {
  if (!snap) return { label: "LOADING", tone: "warn" };
  if (snap.unwinding) return { label: "UNWINDING", tone: "purple" };
  if (t.steps > 0) return { label: "PROTECTED", tone: "ok" };
  return { label: "SHIELD ARMED", tone: "ok" };
}

function toneColor(tone: Status["tone"]) {
  return tone === "purple" ? "var(--purple-hi)" : `var(--${tone === "ok" ? "green" : tone === "warn" ? "amber" : "red"})`;
}

function hfColor(hf: number | undefined, trigger = 1.15) {
  if (hf === undefined) return "var(--dim)";
  if (hf < 1) return "var(--red)";
  if (hf < trigger) return "var(--amber)";
  return "var(--text)";
}

function PositionCard(props: {
  who: string;
  role: string;
  address?: string;
  side?: Side;
  status: Status;
  className: string;
  flash?: boolean;
  extra?: string;
}) {
  const { who, role, address, side, status, className, flash, extra } = props;
  return (
    <article className={`panel ${className}${flash ? " card-flash-bad" : ""}`} key={flash ? "flashed" : "steady"}>
      <div className="card-head">
        <div>
          <p className="eyebrow">{role}</p>
          <h2 className="card-title">
            {who}{" "}
            {address && (
              <a className="mono" style={{ color: "var(--dim)", fontSize: "0.85rem", fontWeight: 400 }} href={explorerAddressUrl(address)} target="_blank" rel="noreferrer">
                {short(address)} ↗
              </a>
            )}
          </h2>
        </div>
        <span className="chip" style={{ color: toneColor(status.tone) }}>
          {status.label}
        </span>
      </div>
      <div className="hf">
        <span className="hf-value mono" style={{ color: hfColor(side?.hf) }}>
          {hfText(side?.hf)}
        </span>
        <span className="hf-label">HEALTH FACTOR</span>
      </div>
      <div className="stats">
        <Stat label="Collateral" value={side ? usd(side.collateralUsd) : "—"} />
        <Stat label="Debt" value={side ? usd(side.debtUsd) : "—"} />
        <Stat label={extra ? "Shield" : "Equity"} value={extra ?? (side ? usd(side.equityUsd) : "—")} />
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="stat-value mono">{value}</div>
    </div>
  );
}

function SavedPanel({ snap, totals }: { snap?: Snapshot; totals: Totals }) {
  const liquidated = totals.liquidations > 0;
  const saved = totals.penaltyUsd - totals.shieldCostUsd;
  const equityGap = snap ? snap.bob.equityUsd - snap.alice.equityUsd : undefined;
  return (
    <article className="panel saved">
      <p className="eyebrow">Shield saved</p>
      <div className={`saved-value mono${liquidated ? "" : " pending"}`}>{liquidated ? usd(saved) : "$—"}</div>
      <p className="saved-sub">
        {liquidated
          ? `Alice's liquidation penalty ${usd(totals.penaltyUsd)} − Bob's Shield costs ${usd(totals.shieldCostUsd)}`
          : "Alice's liquidation penalty − Bob's Shield costs (swap, flash premium, keeper fee)"}
      </p>
      <div className="saved-secondary">
        <span>
          Shield costs <b className="mono">{usd(totals.shieldCostUsd, 2)}</b>
        </span>
        <span>
          Equity gap <b className="mono">{equityGap === undefined ? "—" : usd(equityGap)}</b>
        </span>
      </div>
    </article>
  );
}

function HfChart({ points, snap }: { points: Point[]; snap?: Snapshot }) {
  const trigger = snap?.trigger ?? 1.15;
  const target = snap?.target ?? 1.4;
  return (
    <div className="panel chart">
      <div className="legend">
        <span className="eyebrow" style={{ marginRight: 8 }}>
          Health factor · per block
        </span>
        <span>
          <i style={{ background: "var(--coral)" }} />
          Alice
        </span>
        <span>
          <i style={{ background: "var(--purple-hi)" }} />
          Bob
        </span>
        <span style={{ color: "var(--amber)" }}>
          <i className="dashed" />
          trigger {trigger.toFixed(2)}
        </span>
        <span style={{ color: "var(--green)" }}>
          <i className="dashed" />
          target {target.toFixed(2)}
        </span>
        <span style={{ color: "var(--red)" }}>
          <i style={{ background: "var(--red)" }} />
          liquidation 1.00
        </span>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="block" type="number" domain={["dataMin", "dataMax"]} tick={false} axisLine={{ stroke: "var(--line)" }} />
          <YAxis
            domain={[0.8, 1.6]}
            ticks={[0.8, 1, 1.2, 1.4, 1.6]}
            allowDataOverflow
            tick={{ fill: "var(--muted)", fontSize: 13, fontFamily: "var(--font-mono)" }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 8 }}
            labelFormatter={(b) => `block ${b}`}
            formatter={(v, name) => [Number(v).toFixed(3), name === "alice" ? "Alice" : "Bob"]}
          />
          <ReferenceLine y={1} stroke="var(--red)" strokeWidth={2} />
          <ReferenceLine y={trigger} stroke="var(--amber)" strokeDasharray="6 5" />
          <ReferenceLine y={target} stroke="var(--green)" strokeDasharray="6 5" />
          <Line type="stepAfter" dataKey="alice" stroke="var(--coral)" strokeWidth={3} dot={false} isAnimationActive={false} />
          <Line type="stepAfter" dataKey="bob" stroke="var(--purple-hi)" strokeWidth={3} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Ticker({ events }: { events: TickerEvent[] }) {
  return (
    <div className="panel ticker">
      <p className="eyebrow">Events · every line opens on the testnet explorer</p>
      <ol>
        {events.length === 0 && <li className="empty">Waiting for the crash…</li>}
        {events.map((e) => (
          <li key={e.id}>
            <a className={`k-${e.kind}`} href={explorerTxUrl(e.hash)} target="_blank" rel="noreferrer">
              <span className="dot" />
              <span className="text">{e.text}</span>
              <span className="blk mono">#{e.block.toString()} ↗</span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
