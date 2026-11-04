// Monad mainnet addresses (BRIEF §10). Mirrors contracts/script/MonadAddresses.sol.
// Re-verify before any mainnet action.

export const MONAD_CHAIN_ID = 143 as const;
/** Monad testnet, where the demo runs (BRIEF §17). Demo writes must be gated to this id. */
export const TESTNET_CHAIN_ID = 10143 as const;

export const monadAddresses = {
  aave: {
    poolAddressesProvider: "0x34793Fb9935F7bB5E5aE920fb963F39063E7A615",
    pool: "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef",
    oracle: "0x0c02b2c2038066C10Eab8fe1D5Cdb73d5a78A1Bf",
    protocolDataProvider: "0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad",
    aclAdmin: "0xa9d0EAFF48cE1DF468f9eAeb7e628c413343F6A2",
  },
  uniswap: {
    v3Factory: "0x204FAca1764B154221e35c0d20aBb3c525710498",
    swapRouter02: "0xfE31F71C1b106EAc32F1A19239c9a9A72ddfb900",
  },
  wmon: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
} as const;
