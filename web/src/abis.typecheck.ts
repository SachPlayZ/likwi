// Compile-time proof that the shared ABIs are typed (`as const`): viem narrows function names.
// If codegen ever drops `as const`, the @ts-expect-error below stops erroring and tsc fails.
import type { ContractFunctionName } from "viem";
import { iPoolAbi, monadAddresses } from "@liquidation-shield/shared";

export const accountData: ContractFunctionName<typeof iPoolAbi, "view"> = "getUserAccountData";
// @ts-expect-error not a function on the pool ABI
export const notAFunction: ContractFunctionName<typeof iPoolAbi> = "notAFunction";
export const pool: `0x${string}` = monadAddresses.aave.pool;
