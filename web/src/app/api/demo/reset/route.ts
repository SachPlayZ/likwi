// POST /api/demo/reset: fresh Alice and Bob at the next mnemonic index, both at HF 1.30, price $3000 (BRIEF §17.4).
import { operator } from "@/server/operator";

import { after } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // the action runs after the response (after()), up to ~30s

export function POST() {
  const started = operator.reset();
  if (started) after(operator.pending);
  return started
    ? Response.json({ started: "reset" }, { status: 202 })
    : Response.json({ ...operator.status(), error: "busy" }, { status: 409 });
}
