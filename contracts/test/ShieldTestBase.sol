// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LiquidationShield} from "../src/LiquidationShield.sol";
import {OracleSwapAdapter} from "../src/adapters/OracleSwapAdapter.sol";
import {MockAave, MockERC20, MockOracle, MockPool} from "./mocks/MockAave.sol";

/// @dev Shared setup for Shield tests that run Steps: MockAave, a funded OracleSwapAdapter, and Bob's
///      registered, approved 20 WETH loan at HF 1.30.
abstract contract ShieldTestBase is Test {
    MockAave aave;
    MockPool pool;
    MockOracle oracle;
    MockERC20 weth;
    MockERC20 usdc;
    IERC20 aWeth;
    IERC20 vUsdc;
    OracleSwapAdapter adapter;
    LiquidationShield shield;

    address owner = makeAddr("owner");
    address bob = makeAddr("bob");
    address keeper = makeAddr("keeper");

    uint64 constant TRIGGER = 1.15e18;
    uint64 constant TARGET = 1.4e18;
    uint16 constant STEP = 2500;
    uint16 constant SLIPPAGE = 100;
    uint16 constant KEEPER_FEE = 10;
    uint16 constant ADAPTER_FEE = 30;

    event Protected(
        address indexed user,
        address indexed keeper,
        uint256 hfBefore,
        uint256 hfAfter,
        uint256 debtRepaid,
        uint256 collateralSold,
        uint256 keeperFee
    );
    event Heartbeat(address indexed keeper, uint256 blockNumber);
    event SwapAdapterUpdated(address swapAdapter);
    event KeeperFeeUpdated(uint16 keeperFeeBps);

    function setUp() public virtual {
        aave = new MockAave();
        pool = aave.pool();
        oracle = aave.oracle();
        weth = aave.weth();
        usdc = aave.usdc();
        aWeth = IERC20(pool.getReserveAToken(address(weth)));
        vUsdc = IERC20(pool.getReserveVariableDebtToken(address(usdc)));

        adapter = _newAdapter(ADAPTER_FEE);
        shield = new LiquidationShield(address(aave.addressesProvider()), address(adapter), KEEPER_FEE, owner);

        _openLoan(bob);
        _register(STEP);
        vm.prank(bob);
        aWeth.approve(address(shield), type(uint256).max);
    }

    // ---------------------------------------------------------------- helpers

    function _newAdapter(uint16 feeBps) internal returns (OracleSwapAdapter a) {
        a = new OracleSwapAdapter(address(aave.addressesProvider()), feeBps, owner);
        usdc.mint(address(a), 10_000_000e6);
    }

    /// 20 WETH at $3000 = $60k collateral, borrowed to HF 1.30.
    function _openLoan(address who) internal {
        weth.mint(who, 20 ether);
        vm.startPrank(who);
        weth.approve(address(pool), type(uint256).max);
        pool.supply(address(weth), 20 ether, who, 0);
        pool.borrow(address(usdc), 38_076_923076, 2, 0, who);
        vm.stopPrank();
    }

    function _register(uint16 step) internal {
        vm.prank(bob);
        shield.register(address(weth), address(usdc), TRIGGER, TARGET, step, SLIPPAGE);
    }

    function _crash(uint256 pct) internal {
        oracle.setAssetPrice(address(weth), 3000e8 * (100 - pct) / 100);
    }

    function _hf(address who) internal view returns (uint256 hf) {
        (,,,,, hf) = pool.getUserAccountData(who);
    }

    function _protect() internal returns (uint256) {
        vm.prank(keeper);
        return shield.protect(bob);
    }

    /// The invariant: the Shield holds no funds after any call.
    function _assertShieldHoldsNothing() internal view {
        assertEq(weth.balanceOf(address(shield)), 0, "shield WETH");
        assertEq(usdc.balanceOf(address(shield)), 0, "shield USDC");
        assertEq(aWeth.balanceOf(address(shield)), 0, "shield aWETH");
    }
}
