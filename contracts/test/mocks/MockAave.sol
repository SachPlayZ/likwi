// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {
    ITestnetACL,
    TestnetAaveDeployer,
    TestnetAddressesProvider,
    TestnetERC20,
    TestnetOracle,
    TestnetPool
} from "../../src/testnet/TestnetAave.sol";

/// @notice Unit-test wrapper around the deployable test pool (src/testnet/TestnetAave.sol): the same code,
///         with the admin gate opened so tests (and test helpers mid-Step) can set prices, mint and tune the
///         pool freely. Parameters match the spec: WETH $3000 (LTV 80%, LT 82.5%, 5% bonus), USDC $1,
///         5 bps flash premium.

contract MockERC20 is TestnetERC20 {
    constructor(string memory name_, string memory symbol_, uint8 decimals_)
        TestnetERC20(name_, symbol_, decimals_, ITestnetACL(address(0)))
    {}

    function _checkAdmin() internal view override {}
}

contract MockOracle is TestnetOracle {
    constructor() TestnetOracle(ITestnetACL(address(0))) {}

    function _checkAdmin() internal view override {}
}

contract MockPool is TestnetPool {
    constructor(TestnetAddressesProvider provider) TestnetPool(provider) {}

    function _checkAdmin() internal view override {}
}

contract MockAave is TestnetAaveDeployer {
    constructor() TestnetAaveDeployer(msg.sender) {}

    function weth() external view returns (MockERC20) {
        return MockERC20(address(_weth));
    }

    function usdc() external view returns (MockERC20) {
        return MockERC20(address(_usdc));
    }

    function oracle() external view returns (MockOracle) {
        return MockOracle(address(_oracle));
    }

    function pool() external view returns (MockPool) {
        return MockPool(address(_pool));
    }

    function _newTokens(TestnetAddressesProvider) internal override returns (TestnetERC20, TestnetERC20) {
        return (new MockERC20("Wrapped Ether", "WETH", 18), new MockERC20("USD Coin", "USDC", 6));
    }

    function _newOracle(TestnetAddressesProvider) internal override returns (TestnetOracle) {
        return new MockOracle();
    }

    function _newPool(TestnetAddressesProvider provider) internal override returns (TestnetPool) {
        return new MockPool(provider);
    }
}
