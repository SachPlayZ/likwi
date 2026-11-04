// Shape of demo/.deployments.json, written by `demo deploy` / `demo seed` and read by the keeper and web.
import type { Address } from "viem";

export type DemoRun = {
  /** Run index: Alice is mnemonic index 2n, Bob 2n+1. */
  n: number;
  alice: Address;
  bob: Address;
  /** Block the run was seeded at; the UI charts from here. */
  startBlock: string;
};

export type Deployments = {
  chainId: number;
  deployBlock: string;
  operator: Address;
  keeper: Address;
  liquidator: Address;
  testnetAave: Address;
  addressesProvider: Address;
  pool: Address;
  oracle: Address;
  weth: Address;
  usdc: Address;
  aWeth: Address;
  vUsdc: Address;
  adapter: Address;
  shield: Address;
  run?: DemoRun;
};
