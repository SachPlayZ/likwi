// POST /api/demo/crash: { "mode": "slow" } (−3%/s × 10 s) or { "pct": 5 | 15 | 25 } (instant).
import { operator } from "@/server/operator";

import { after } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // the action runs after the response (after()), up to ~30s

const INSTANT = new Set([5, 15, 25]);

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { mode?: string; pct?: number };
  let started: boolean;
  if (body.mode === "slow") started = operator.slowCrash();
  else if (typeof body.pct === "number" && INSTANT.has(body.pct)) started = operator.crash(BigInt(body.pct));
  else return Response.json({ error: 'expected { "mode": "slow" } or { "pct": 5 | 15 | 25 }' }, { status: 400 });
  if (started) after(operator.pending);
  return started
    ? Response.json({ started: "crash" }, { status: 202 })
    : Response.json({ ...operator.status(), error: "busy" }, { status: 409 });
}
