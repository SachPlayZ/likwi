"use client";
// Pieces shared by / and /demo: the keeper heartbeat badge (BRIEF §8, §16.10) and the brand mark.
import { useEffect, useRef, useState } from "react";
import { getAbiItem, type Address, type Hex } from "viem";
import { explorerTxUrl, liquidationShieldAbi } from "@liquidation-shield/shared";
import { client } from "@/lib/feed";

export type Heartbeat = { block: bigint; hash: Hex };

const heartbeatEvent = getAbiItem({ abi: liquidationShieldAbi, name: "Heartbeat" });

/**
 * The official keeper's latest heartbeat, plus the chain head and a rolling block-time estimate. Heartbeats come
 * every 10 blocks, so the last 100 blocks always hold one while the keeper is live. Only `keeper`'s heartbeats count:
 * `heartbeat()` is permissionless.
 */
export function useHeartbeat(shield?: Address, keeper?: Address) {
  const [heartbeat, setHeartbeat] = useState<Heartbeat>();
  const [head, setHead] = useState<bigint>();
  const [blockTime, setBlockTime] = useState(0.4);
  const seen = useRef<{ block: bigint; t: number }>(undefined);

  useEffect(() => {
    if (!shield || !keeper) return;
    let stopped = false;
    const poll = async () => {
      try {
        const t = performance.now();
        const latest = await client.getBlockNumber();
        const prev = seen.current;
        if (prev && latest > prev.block) {
          setBlockTime((bt) => bt * 0.8 + ((t - prev.t) / 1000 / Number(latest - prev.block)) * 0.2);
        }
        if (!prev || latest > prev.block) seen.current = { block: latest, t };
        const logs = await client.getLogs({
          address: shield,
          event: heartbeatEvent,
          args: { keeper },
          fromBlock: latest > 99n ? latest - 99n : 0n,
          toBlock: latest,
        });
        if (stopped) return;
        setHead(latest);
        const last = logs.at(-1);
        if (last?.blockNumber && last.transactionHash) {
          const hb = { block: last.blockNumber, hash: last.transactionHash };
          setHeartbeat((h) => (!h || hb.block > h.block ? hb : h));
        }
      } catch {
        // rate limit or transient error: try again on the next poll
      }
    };
    void poll();
    const id = setInterval(poll, 2_000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [shield, keeper]);

  return { heartbeat, head, blockTime };
}

export function HeartbeatBadge({ heartbeat, head, blockTime }: { heartbeat?: Heartbeat; head?: bigint; blockTime: number }) {
  // Re-render every 250ms so the age ticks between polls.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  if (!heartbeat || head === undefined) {
    return (
      <span className="badge warn">
        <span className="dot" /> Keeper · no heartbeat yet
      </span>
    );
  }
  const age = Math.max(0, Number(head - heartbeat.block)) * blockTime;
  const live = age < 15;
  return (
    <a className={`badge ${live ? "ok live" : "warn"}`} href={explorerTxUrl(heartbeat.hash)} target="_blank" rel="noreferrer">
      <span className="dot" /> {live ? "Shield active" : "Keeper quiet"} · heartbeat {age.toFixed(1)}s ago
    </a>
  );
}

export function ShieldIcon() {
  return (
    <svg width="20" height="22" viewBox="0 0 20 22" fill="none">
      <path d="M10 1 2 4v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V4l-8-3Z" fill="#0b0716" />
      <path d="m6 11 3 3 5-6" stroke="#b3a6ff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
