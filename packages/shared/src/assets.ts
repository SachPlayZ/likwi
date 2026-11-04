// Aave reserves the UI offers as collateral / debt (BRIEF §10). WETH/USDC is the default pair.

export type Asset = {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
  aToken: `0x${string}`;
  variableDebtToken?: `0x${string}`;
};

export const assets = {
  WETH: {
    symbol: "WETH",
    address: "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242",
    decimals: 18,
    aToken: "0x4377b53aAA8b8e3fF7AA2843832CAF004f5Cb8b6",
    variableDebtToken: "0xd1f352c326731027f0d9a7f62a4742eBdf1EFc8c",
  },
  USDC: {
    symbol: "USDC",
    address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    decimals: 6,
    aToken: "0x35a73BAcb179d3740395A3ceCc87FF2e581d6042",
    variableDebtToken: "0x9F555aB84C4e0a531B50283f09Dba7A97134c4e4",
  },
} as const satisfies Record<string, Asset>;

export type AssetSymbol = keyof typeof assets;

export const DEFAULT_COLLATERAL: AssetSymbol = "WETH";
export const DEFAULT_DEBT: AssetSymbol = "USDC";
