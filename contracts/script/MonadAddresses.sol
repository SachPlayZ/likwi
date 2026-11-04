// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Monad mainnet (chain 143) addresses, from BRIEF §10.
/// @dev Sources: Aave Address Book (`AaveV3Monad`) and Uniswap's Monad v3 deployment page.
///      Re-verify before any mainnet action.
library MonadAddresses {
    uint256 internal constant CHAIN_ID = 143;
    uint256 internal constant TESTNET_CHAIN_ID = 10143;

    // Aave V3
    address internal constant POOL_ADDRESSES_PROVIDER = 0x34793Fb9935F7bB5E5aE920fb963F39063E7A615;
    address internal constant POOL = 0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef;
    address internal constant ORACLE = 0x0c02b2c2038066C10Eab8fe1D5Cdb73d5a78A1Bf;
    address internal constant PROTOCOL_DATA_PROVIDER = 0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad;
    address internal constant ACL_ADMIN = 0xa9d0EAFF48cE1DF468f9eAeb7e628c413343F6A2;

    // Reserves
    address internal constant WETH = 0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242; // 18 dec
    address internal constant A_WETH = 0x4377b53aAA8b8e3fF7AA2843832CAF004f5Cb8b6;
    address internal constant V_WETH = 0xd1f352c326731027f0d9a7f62a4742eBdf1EFc8c;
    address internal constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603; // 6 dec
    address internal constant A_USDC = 0x35a73BAcb179d3740395A3ceCc87FF2e581d6042;
    address internal constant V_USDC = 0x9F555aB84C4e0a531B50283f09Dba7A97134c4e4;
    address internal constant USDT0 = 0xe7cd86e13AC4309349F30B3435a9d337750fC82D; // 6 dec

    // Uniswap V3
    address internal constant UNISWAP_V3_FACTORY = 0x204FAca1764B154221e35c0d20aBb3c525710498;
    address internal constant UNISWAP_SWAP_ROUTER_02 = 0xfE31F71C1b106EAc32F1A19239c9a9A72ddfb900;
    address internal constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;
}
