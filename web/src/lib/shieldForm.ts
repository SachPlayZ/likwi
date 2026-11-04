// Shield form → `register(...)` args, with inline validation that mirrors LiquidationShield's bounds (BRIEF §6.2):
// trigger ≥ 1.02, target ≤ 3.0, target ≥ trigger + 0.05, max step 5–100%, max slippage 0.1–5%, collateral ≠ debt,
// both listed. Invalid input never reaches a transaction.
import { parseUnits, type Address } from "viem";

export type ShieldForm = {
  collateral: string;
  debt: string;
  trigger: string; // HF, e.g. "1.15"
  target: string; // HF, e.g. "1.40"
  stepPct: string; // % of debt per Step, e.g. "25"
  slippagePct: string; // %, e.g. "1"
};

export type RegisterArgs = readonly [Address, Address, bigint, bigint, number, number];

export const DEFAULT_FORM: Omit<ShieldForm, "collateral" | "debt"> = {
  trigger: "1.15",
  target: "1.40",
  stepPct: "25",
  slippagePct: "1",
};

const WAD = 10n ** 18n;
const MIN_TRIGGER = (102n * WAD) / 100n; // 1.02
const MAX_TARGET = 3n * WAD; // 3.0
const MIN_GAP = (5n * WAD) / 100n; // 0.05
const DECIMAL = /^\d+(\.\d+)?$/;

type Errors = Partial<Record<keyof ShieldForm, string>>;

function hf(v: string, field: keyof ShieldForm, errors: Errors): bigint | undefined {
  const s = v.trim();
  if (!DECIMAL.test(s)) {
    errors[field] = "Enter a number, e.g. 1.15";
    return undefined;
  }
  if ((s.split(".")[1]?.length ?? 0) > 4) {
    errors[field] = "Use at most 4 decimals";
    return undefined;
  }
  return parseUnits(s, 18);
}

/** "25" → 2500 bps. Percent with at most 2 decimals, so bps stay whole. */
function bps(v: string, field: keyof ShieldForm, errors: Errors): number | undefined {
  const s = v.trim();
  if (!DECIMAL.test(s)) {
    errors[field] = "Enter a percentage, e.g. 1";
    return undefined;
  }
  if ((s.split(".")[1]?.length ?? 0) > 2) {
    errors[field] = "Use at most 2 decimals";
    return undefined;
  }
  return Number(parseUnits(s, 2));
}

export function validateShieldForm(
  f: ShieldForm,
  listed: readonly string[],
): { errors: Errors; args?: RegisterArgs } {
  const errors: Errors = {};
  const isListed = (a: string) => listed.some((l) => l.toLowerCase() === a.toLowerCase());

  if (!f.collateral) errors.collateral = "Pick a collateral asset";
  else if (!isListed(f.collateral)) errors.collateral = "Not a listed reserve";
  if (!f.debt) errors.debt = "Pick a debt asset";
  else if (!isListed(f.debt)) errors.debt = "Not a listed reserve";
  if (f.collateral && f.debt && f.collateral.toLowerCase() === f.debt.toLowerCase()) {
    errors.debt = "Debt must differ from collateral";
  }

  const trigger = hf(f.trigger, "trigger", errors);
  const target = hf(f.target, "target", errors);
  if (trigger !== undefined && trigger < MIN_TRIGGER) errors.trigger = "Trigger HF must be at least 1.02";
  if (target !== undefined && target > MAX_TARGET) errors.target = "Target HF can be at most 3.00";
  if (trigger !== undefined && target !== undefined && !errors.target && target < trigger + MIN_GAP) {
    errors.target = "Target must be at least 0.05 above the trigger";
  }

  const step = bps(f.stepPct, "stepPct", errors);
  if (step !== undefined && (step < 500 || step > 10_000)) errors.stepPct = "Max step must be 5–100%";
  const slippage = bps(f.slippagePct, "slippagePct", errors);
  if (slippage !== undefined && (slippage < 10 || slippage > 500)) errors.slippagePct = "Max slippage must be 0.1–5%";

  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    args: [f.collateral as Address, f.debt as Address, trigger!, target!, step!, slippage!],
  };
}

/** Form values from an on-chain config, so "Update Shield" starts from what's registered. */
export function formFromConfig(c: {
  collateralAsset: Address;
  debtAsset: Address;
  triggerHF: bigint;
  targetHF: bigint;
  maxStepBps: number;
  maxSlippageBps: number;
}): ShieldForm {
  const hfStr = (x: bigint) => (Number(x) / 1e18).toFixed(2);
  return {
    collateral: c.collateralAsset,
    debt: c.debtAsset,
    trigger: hfStr(c.triggerHF),
    target: hfStr(c.targetHF),
    stepPct: String(c.maxStepBps / 100),
    slippagePct: String(c.maxSlippageBps / 100),
  };
}
