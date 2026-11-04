// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LiquidationShield} from "../src/LiquidationShield.sol";
import {ShieldTestBase} from "./ShieldTestBase.sol";

/// @notice Gradual Unwind, ClearUnwind and previewProtect (ticket #14). Test numbers follow BRIEF §6.7.
contract LiquidationShieldUnwindTest is ShieldTestBase {
    event UnwindComplete(address indexed user);

    // ---------------------------------------------------------------- helpers

    function _action(address who) internal view returns (LiquidationShield.Action) {
        return shield.previewProtect(who).action;
    }

    /// Keeper loop: one Step per block until preview says there's nothing to do. Returns the Step count.
    function _unwind() internal returns (uint256 steps) {
        for (uint256 i; i < 20; ++i) {
            vm.roll(block.number + 1);
            if (_action(bob) != LiquidationShield.Action.Step) return steps;
            uint256 debtBefore = vUsdc.balanceOf(bob);
            _protect();
            // test 6: each Step repays at most maxStep of the debt (+1 unit for round-up).
            uint16 step = shield.getConfig(bob).maxStepBps;
            assertLe(debtBefore - vUsdc.balanceOf(bob), debtBefore * step / 1e4 + 1, "step cap");
            _assertShieldHoldsNothing();
            ++steps;
        }
        revert("unwind did not finish in 20 blocks");
    }

    /// Collateral − debt + wallet balances, base currency (8 dec) at the oracle price.
    function _equity(address who) internal view returns (uint256) {
        (uint256 c, uint256 d,,,,) = pool.getUserAccountData(who);
        uint256 wallet = weth.balanceOf(who) * oracle.getAssetPrice(address(weth)) / 1e18 + usdc.balanceOf(who)
            * oracle.getAssetPrice(address(usdc)) / 1e6;
        return c + wallet - d;
    }

    /// Moves the WETH price so Bob's HF becomes `hf` (HF scales linearly with a single-collateral price).
    function _setHf(uint256 hf) internal {
        uint256 price = oracle.getAssetPrice(address(weth));
        oracle.setAssetPrice(address(weth), price * hf / _hf(bob));
    }

    // ---------------------------------------------------------------- test 5 + 6: gradual Unwind

    function test_gradualUnwindReachesTargetAcrossBlocks() public {
        _register(1500);
        _crash(20);

        uint256 steps = _unwind();

        assertGe(steps, 2, "takes several Steps");
        assertApproxEqRel(_hf(bob), TARGET, 0.01e18, "within 1% of target");
        assertGe(_hf(bob), uint256(TARGET) * 995 / 1000, "inside the 0.5% band");
        assertFalse(shield.getConfig(bob).unwinding, "flag cleared");
    }

    function test_unwindContinuesAboveTrigger() public {
        _crash(15); // HF ≈ 1.105; one 25% Step lands ≈ 1.19: above the trigger, short of target
        _protect();
        uint256 hf = _hf(bob);
        assertGt(hf, TRIGGER, "first Step lifts HF above the trigger");
        assertLt(hf, uint256(TARGET) * 995 / 1000, "but short of target");
        assertTrue(shield.getConfig(bob).unwinding);

        vm.roll(block.number + 1);
        assertGt(_protect(), hf, "flag lets the next Step run above the trigger");
    }

    // ---------------------------------------------------------------- test 7: Shield beats liquidation

    function test_shieldBeatsLiquidation() public {
        address alice = makeAddr("alice");
        address liquidator = makeAddr("liquidator");
        _openLoan(alice);
        usdc.mint(liquidator, 1_000_000e6);
        vm.prank(liquidator);
        usdc.approve(address(pool), type(uint256).max);

        _crash(25);
        uint256 aliceBefore = _equity(alice);
        uint256 bobBefore = _equity(bob);

        vm.prank(liquidator);
        pool.liquidationCall(address(weth), address(usdc), alice, type(uint256).max, false);
        _unwind();

        uint256 aliceLoss = aliceBefore - _equity(alice);
        uint256 bobLoss = bobBefore - _equity(bob);
        emit log_named_decimal_uint("Alice loss ($, liquidated)", aliceLoss, 8);
        emit log_named_decimal_uint("Bob loss ($, shielded)", bobLoss, 8);
        assertGt(bobLoss, 0, "Bob pays swap + fees");
        assertGt(aliceLoss, 5 * bobLoss, "liquidation costs > 5x protection");
        assertGe(_hf(bob), uint256(TARGET) * 995 / 1000);
    }

    // ---------------------------------------------------------------- test 15: stale flag / ClearUnwind

    function test_staleFlagClearsInsteadOfStepping() public {
        _register(1500);
        _crash(20);
        _protect();
        assertTrue(shield.getConfig(bob).unwinding, "Unwind in progress");

        // Price recovers past target·0.995: preview flags a clear, protect clears without a Step or fee.
        _setHf(1.6e18);
        assertEq(uint8(_action(bob)), uint8(LiquidationShield.Action.ClearUnwind));
        uint256 debt = vUsdc.balanceOf(bob);
        uint256 keeperBal = usdc.balanceOf(keeper);

        vm.expectEmit(address(shield));
        emit UnwindComplete(bob);
        assertEq(_protect(), _hf(bob), "returns current HF");

        assertFalse(shield.getConfig(bob).unwinding, "flag cleared");
        assertEq(vUsdc.balanceOf(bob), debt, "no Step");
        assertEq(usdc.balanceOf(keeper), keeperBal, "no fee");

        // A later dip between trigger and target must not Step.
        _setHf(1.25e18);
        assertEq(uint8(_action(bob)), uint8(LiquidationShield.Action.None));
        vm.expectRevert(abi.encodeWithSelector(LiquidationShield.NotProtectable.selector, _hf(bob), TRIGGER));
        _protect();
    }

    // ---------------------------------------------------------------- re-register (moved from #12)

    function test_reRegisterMidUnwindResetsFlag() public {
        _register(1500);
        _crash(20);
        _protect();
        assertTrue(shield.getConfig(bob).unwinding);

        _register(STEP);
        assertFalse(shield.getConfig(bob).unwinding);
    }

    // ---------------------------------------------------------------- previewProtect

    function test_previewNoneWhenHealthy() public view {
        LiquidationShield.Preview memory p = shield.previewProtect(bob);
        assertEq(uint8(p.action), uint8(LiquidationShield.Action.None));
        assertEq(p.healthFactor, _hf(bob));
        assertEq(p.repayAmount, 0);
    }

    function test_previewNoneWhenUnregistered() public {
        vm.prank(bob);
        shield.unregister();
        _crash(20);
        assertEq(uint8(_action(bob)), uint8(LiquidationShield.Action.None));
    }

    function test_previewNoneWhenPaused() public {
        _crash(20);
        vm.prank(owner);
        shield.pause();
        assertEq(uint8(_action(bob)), uint8(LiquidationShield.Action.None));
    }

    function test_previewNoneWhenNothingToRepay() public {
        vm.prank(bob);
        IERC20(aWeth).approve(address(shield), 0);
        _crash(20);
        assertEq(uint8(_action(bob)), uint8(LiquidationShield.Action.None));
    }

    function test_previewStepMatchesProtect() public {
        _crash(20);
        LiquidationShield.Preview memory p = shield.previewProtect(bob);
        assertEq(uint8(p.action), uint8(LiquidationShield.Action.Step));
        assertEq(p.healthFactor, _hf(bob));
        assertGt(p.repayAmount, 0);

        uint256 debtBefore = vUsdc.balanceOf(bob);
        uint256 aBefore = aWeth.balanceOf(bob);
        _protect();
        assertEq(debtBefore - vUsdc.balanceOf(bob), p.repayAmount, "repay matches preview");
        assertLe(aBefore - aWeth.balanceOf(bob), p.estCollateralSold, "estimate is an upper bound");
    }
}
