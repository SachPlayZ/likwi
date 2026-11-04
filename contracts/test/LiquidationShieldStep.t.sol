// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {LiquidationShield} from "../src/LiquidationShield.sol";
import {OracleSwapAdapter} from "../src/adapters/OracleSwapAdapter.sol";
import {ISwapAdapter} from "../src/interfaces/ISwapAdapter.sol";
import {MockAave, MockERC20, MockOracle, MockPool} from "./mocks/MockAave.sol";

/// @dev Fills at whatever it's asked, then crashes the oracle: models the price moving against the Position
///      mid-Step, so the Shield's "HF must improve" backstop is what catches it.
contract PriceDroppingAdapter is ISwapAdapter {
    using SafeERC20 for IERC20;

    MockOracle immutable oracle;
    address immutable weth;

    constructor(MockOracle oracle_, address weth_) {
        oracle = oracle_;
        weth = weth_;
    }

    function swapExactOutput(address tokenIn, address tokenOut, uint256 amountOut, uint256 maxAmountIn, address)
        external
        returns (uint256)
    {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), maxAmountIn);
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
        oracle.setAssetPrice(weth, oracle.getAssetPrice(weth) * 6 / 10);
        return maxAmountIn;
    }
}

/// @notice Single protect Step against MockAave (ticket #13). Test numbers follow BRIEF §6.7.
contract LiquidationShieldStepTest is Test {
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

    function setUp() public {
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

    // ---------------------------------------------------------------- test 2 (moved from #12)

    function test_unregisterThenProtectReverts() public {
        vm.prank(bob);
        shield.unregister();
        _crash(18);
        vm.expectRevert(LiquidationShield.NotRegistered.selector);
        _protect();
    }

    // ---------------------------------------------------------------- test 3

    function test_healthyPositionNotProtectable() public {
        uint256 hf = _hf(bob);
        vm.expectRevert(abi.encodeWithSelector(LiquidationShield.NotProtectable.selector, hf, TRIGGER));
        _protect();
    }

    // ---------------------------------------------------------------- test 4

    function test_oneStepRaisesHfPaysKeeperHoldsNothing() public {
        _crash(18);
        uint256 hfBefore = _hf(bob);
        assertLt(hfBefore, TRIGGER);
        uint256 debtBefore = vUsdc.balanceOf(bob);

        uint256 hfAfter = _protect();

        assertGt(hfAfter, hfBefore, "HF improves");
        assertEq(hfAfter, _hf(bob), "returns HF after");
        uint256 repaid = debtBefore - vUsdc.balanceOf(bob);
        assertGt(repaid, 0);
        assertEq(usdc.balanceOf(keeper), repaid * KEEPER_FEE / 1e4, "keeper fee");
        _assertShieldHoldsNothing();
    }

    function test_protectEmitsProtected() public {
        _crash(18);
        uint256 hfBefore = _hf(bob);
        vm.expectEmit(true, true, false, false, address(shield));
        emit Protected(bob, keeper, hfBefore, 0, 0, 0, 0);
        _protect();
    }

    function test_leftoverCollateralResuppliedToUser() public {
        _crash(18);
        uint256 aBefore = aWeth.balanceOf(bob);
        _protect();
        // The adapter only takes what it quotes; the rest of the pulled collateral comes back as aWETH.
        uint256 sold = aBefore - aWeth.balanceOf(bob);
        assertEq(weth.balanceOf(address(adapter)), sold, "only the sold amount left the Position");
    }

    // ---------------------------------------------------------------- test 8 + 16: allowance / collateral clamp

    function test_revokedApprovalNothingToRepay() public {
        vm.prank(bob);
        aWeth.approve(address(shield), 0);
        _crash(18);
        vm.expectRevert(LiquidationShield.NothingToRepay.selector);
        _protect();
    }

    function test_shortAllowanceGivesPartialStep() public {
        vm.prank(bob);
        aWeth.approve(address(shield), 0.5 ether);
        _crash(18);
        uint256 hfBefore = _hf(bob);
        uint256 aBefore = aWeth.balanceOf(bob);

        uint256 hfAfter = _protect();

        assertGt(hfAfter, hfBefore, "partial Step still raises HF");
        assertLt(hfAfter, TARGET, "partial: short of target");
        assertLe(aBefore - aWeth.balanceOf(bob), 0.5 ether, "never pulls beyond the allowance");
        _assertShieldHoldsNothing();
    }

    // ---------------------------------------------------------------- test 9: slippage cap

    function test_swapCostAboveSlippageCapReverts() public {
        OracleSwapAdapter pricey = _newAdapter(300); // 3% vs the user's 1% cap
        vm.prank(owner);
        shield.setSwapAdapter(address(pricey));
        _crash(18);
        vm.expectPartialRevert(OracleSwapAdapter.SlippageExceeded.selector);
        _protect();
    }

    // ---------------------------------------------------------------- test 10: pause

    function test_pausedProtectReverts() public {
        vm.prank(owner);
        shield.pause();
        _crash(18);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        _protect();

        vm.prank(owner);
        shield.unpause();
        _protect();
    }

    // ---------------------------------------------------------------- test 11: flash-loan callback auth

    function test_directCallbackReverts() public {
        vm.expectRevert(LiquidationShield.UnauthorizedFlashLoan.selector);
        shield.executeOperation(address(usdc), 1e6, 0, address(shield), abi.encode(bob, keeper));
    }

    function test_callbackFromPoolWithForeignInitiatorReverts() public {
        vm.prank(address(pool));
        vm.expectRevert(LiquidationShield.UnauthorizedFlashLoan.selector);
        shield.executeOperation(address(usdc), 1e6, 0, keeper, abi.encode(bob, keeper));
    }

    function test_callbackOutsideProtectReverts() public {
        // Right pool, right initiator, but no Step in progress for this user.
        vm.prank(address(pool));
        vm.expectRevert(LiquidationShield.UnauthorizedFlashLoan.selector);
        shield.executeOperation(address(usdc), 1e6, 0, address(shield), abi.encode(bob, keeper));
    }

    // ---------------------------------------------------------------- test 12: heartbeat + admin

    function test_heartbeatEmits() public {
        vm.roll(42);
        vm.expectEmit(address(shield));
        emit Heartbeat(keeper, 42);
        vm.prank(keeper);
        shield.heartbeat();
    }

    function test_adminIsOwnerOnly() public {
        bytes memory notOwner = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob);
        vm.startPrank(bob);
        vm.expectRevert(notOwner);
        shield.setSwapAdapter(address(1));
        vm.expectRevert(notOwner);
        shield.setKeeperFeeBps(5);
        vm.expectRevert(notOwner);
        shield.pause();
        vm.expectRevert(notOwner);
        shield.unpause();
        vm.expectRevert(notOwner);
        shield.rescue(address(usdc), bob, 1);
        vm.stopPrank();
    }

    function test_setKeeperFee() public {
        vm.startPrank(owner);
        vm.expectEmit(address(shield));
        emit KeeperFeeUpdated(50);
        shield.setKeeperFeeBps(50);
        assertEq(shield.keeperFeeBps(), 50);
        vm.expectRevert(LiquidationShield.InvalidConfig.selector);
        shield.setKeeperFeeBps(51);
        vm.stopPrank();
    }

    function test_setSwapAdapter() public {
        vm.startPrank(owner);
        vm.expectRevert(LiquidationShield.ZeroAddress.selector);
        shield.setSwapAdapter(address(0));
        vm.expectEmit(address(shield));
        emit SwapAdapterUpdated(address(7));
        shield.setSwapAdapter(address(7));
        assertEq(shield.swapAdapter(), address(7));
        vm.stopPrank();
    }

    function test_rescueSweepsStrayTokens() public {
        usdc.mint(address(shield), 5e6);
        vm.prank(owner);
        shield.rescue(address(usdc), owner, 5e6);
        assertEq(usdc.balanceOf(owner), 5e6);
    }

    // ---------------------------------------------------------------- HF backstop

    function test_stepThatLowersHfReverts() public {
        PriceDroppingAdapter bad = new PriceDroppingAdapter(oracle, address(weth));
        usdc.mint(address(bad), 10_000_000e6);
        vm.prank(owner);
        shield.setSwapAdapter(address(bad));
        _crash(18);
        vm.expectPartialRevert(LiquidationShield.HealthFactorNotImproved.selector);
        _protect();
    }

    // ---------------------------------------------------------------- test 17: k includes fees

    function test_fullSlippageStepLandsAtOrAboveTarget() public {
        // Swap costs exactly the user's cap, step uncapped: only k's fee terms keep the Step from undershooting.
        OracleSwapAdapter atCap = _newAdapter(SLIPPAGE);
        vm.prank(owner);
        shield.setSwapAdapter(address(atCap));
        _register(10_000);
        _crash(18);
        uint256 hfAfter = _protect();
        assertGe(hfAfter, TARGET, "at or above target");
        assertApproxEqRel(hfAfter, TARGET, 0.005e18, "and close to it");
    }

    function test_premiumReadFromPool() public {
        // A pricier flash loan needs a bigger k; with the swap at the cap, the Step must still reach target.
        pool.setFlashLoanPremiumTotal(50);
        OracleSwapAdapter atCap = _newAdapter(SLIPPAGE);
        vm.prank(owner);
        shield.setSwapAdapter(address(atCap));
        _register(10_000);
        _crash(18);
        assertGe(_protect(), TARGET);
    }

    // ---------------------------------------------------------------- test 13: sizing fuzz

    /// Single-collateral: selling x·k of collateral to repay x lands on target within 0.01%.
    function testFuzz_repayBaseForTargetHitsTarget(
        uint256 coll,
        uint256 ltBps,
        uint256 hf,
        uint256 slippageBps,
        uint256 target
    ) public view {
        coll = bound(coll, 1_000e8, 100_000_000e8);
        ltBps = bound(ltBps, 5000, 9500);
        hf = bound(hf, 0.8e18, 1.5e18);
        slippageBps = bound(slippageBps, 10, 500);
        target = bound(target, 1.07e18, 3e18);
        uint256 costBps = slippageBps + 5 + KEEPER_FEE;
        vm.assume(target > hf);
        vm.assume(target > (1e4 + costBps) * ltBps * 1e10 * 101 / 100); // reachable with margin

        uint256 debt = coll * ltBps * 1e14 / hf;
        uint256 x = shield.repayBaseForTarget(coll, debt, ltBps, target, costBps);
        vm.assume(x < debt * 99 / 100); // not clamped to the whole debt

        uint256 collAfter = coll - x * (1e4 + costBps) / 1e4;
        uint256 hfAfter = collAfter * ltBps * 1e14 / (debt - x);
        assertApproxEqRel(hfAfter, target, 1e14);
    }

    function test_repayBaseForTargetEdges() public view {
        // Already at target: nothing to repay.
        assertEq(shield.repayBaseForTarget(60_000e8, 10_000e8, 8250, 1.4e18, 115), 0);
        // Target unreachable by selling collateral (k·LT ≥ target): repay everything.
        assertEq(shield.repayBaseForTarget(60_000e8, 58_000e8, 9500, 1.07e18, 1500), 58_000e8);
    }
}
