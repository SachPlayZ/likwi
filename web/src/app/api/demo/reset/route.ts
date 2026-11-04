// POST /api/demo/reset: fresh Alice and Bob at the next mnemonic index, both at HF 1.30, price $3000 (BRIEF §17.4).
import { operator } from "@/server/operator";

export const dynamic = "force-dynamic";

export function POST() {
  return operator.reset()
    ? Response.json({ started: "reset" }, { status: 202 })
    : Response.json({ ...operator.status(), error: "busy" }, { status: 409 });
}
