// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {LiquidationShield} from "../src/LiquidationShield.sol";
import {MockAave, MockERC20, MockPool} from "./mocks/MockAave.sol";

contract LiquidationShieldTest is Test {
    MockAave aave;
    MockPool pool;
    MockERC20 weth;
    MockERC20 usdc;
    LiquidationShield shield;

    address owner = makeAddr("owner");
    address adapter = makeAddr("adapter");
    address bob = makeAddr("bob");

    // Demo defaults (BRIEF §9): trigger 1.15, target 1.40, step 25%, slippage 1%.
    uint64 constant TRIGGER = 1.15e18;
    uint64 constant TARGET = 1.4e18;
    uint16 constant STEP = 2500;
    uint16 constant SLIPPAGE = 100;

    event Registered(
        address indexed user,
        address collateralAsset,
        address debtAsset,
        uint64 triggerHF,
        uint64 targetHF,
        uint16 maxStepBps,
        uint16 maxSlippageBps
    );
    event Unregistered(address indexed user);

    function setUp() public {
        aave = new MockAave();
        pool = aave.pool();
        weth = aave.weth();
        usdc = aave.usdc();
        shield = new LiquidationShield(address(aave.addressesProvider()), adapter, 10, owner);
    }

    function _register(uint64 trigger, uint64 target, uint16 step, uint16 slippage) internal {
        vm.prank(bob);
        shield.register(address(weth), address(usdc), trigger, target, step, slippage);
    }

    // ---------------------------------------------------------------- constructor

    function test_constructorWiresPoolAndSettings() public view {
        assertEq(address(shield.POOL()), address(pool));
        assertEq(address(shield.ADDRESSES_PROVIDER()), address(aave.addressesProvider()));
        assertEq(shield.swapAdapter(), adapter);
        assertEq(shield.keeperFeeBps(), 10);
        assertEq(shield.owner(), owner);
    }

    function test_constructorRejectsZeroAddresses() public {
        vm.expectRevert(LiquidationShield.ZeroAddress.selector);
        new LiquidationShield(address(0), adapter, 10, owner);
        address provider = address(aave.addressesProvider());
        vm.expectRevert(LiquidationShield.ZeroAddress.selector);
        new LiquidationShield(provider, address(0), 10, owner);
    }

    function test_constructorRejectsKeeperFeeAboveCap() public {
        address provider = address(aave.addressesProvider());
        vm.expectRevert(LiquidationShield.InvalidConfig.selector);
        new LiquidationShield(provider, adapter, 51, owner);
    }

    // ---------------------------------------------------------------- test 1: register

    function test_registerStoresConfigAndEmits() public {
        vm.expectEmit(address(shield));
        emit Registered(bob, address(weth), address(usdc), TRIGGER, TARGET, STEP, SLIPPAGE);
        _register(TRIGGER, TARGET, STEP, SLIPPAGE);

        LiquidationShield.Config memory c = shield.getConfig(bob);
        assertEq(c.collateralAsset, address(weth));
        assertEq(c.debtAsset, address(usdc));
        assertEq(c.triggerHF, TRIGGER);
        assertEq(c.targetHF, TARGET);
        assertEq(c.maxStepBps, STEP);
        assertEq(c.maxSlippageBps, SLIPPAGE);
        assertTrue(c.active);
        assertFalse(c.unwinding);
    }

    function test_registerAcceptsBoundaryValues() public {
        _register(1.02e18, 1.07e18, 500, 10); // lowest trigger, smallest gap, smallest step and slippage
        _register(2.95e18, 3e18, 10000, 500); // highest target, largest step and slippage
        assertEq(shield.getConfig(bob).targetHF, 3e18);
    }

    function test_registerRejectsLowTrigger() public {
        vm.expectRevert(LiquidationShield.InvalidConfig.selector);
        _register(1.02e18 - 1, TARGET, STEP, SLIPPAGE);
    }

    function test_registerRejectsHighTarget() public {
        vm.expectRevert(LiquidationShield.InvalidConfig.selector);
        _register(TRIGGER, 3e18 + 1, STEP, SLIPPAGE);
    }

    function test_registerRejectsSmallGap() public {
        vm.expectRevert(LiquidationShield.InvalidConfig.selector);
        _register(TRIGGER, TRIGGER + 0.05e18 - 1, STEP, SLIPPAGE);
    }

    function test_registerRejectsStepOutOfRange() public {
        vm.expectRevert(LiquidationShield.InvalidConfig.selector);
        _register(TRIGGER, TARGET, 499, SLIPPAGE);
        vm.expectRevert(LiquidationShield.InvalidConfig.selector);
        _register(TRIGGER, TARGET, 10001, SLIPPAGE);
    }

    function test_registerRejectsSlippageOutOfRange() public {
        vm.expectRevert(LiquidationShield.InvalidConfig.selector);
        _register(TRIGGER, TARGET, STEP, 9);
        vm.expectRevert(LiquidationShield.InvalidConfig.selector);
        _register(TRIGGER, TARGET, STEP, 501);
    }

    function test_registerRejectsSameAsset() public {
        vm.expectRevert(LiquidationShield.InvalidConfig.selector);
        vm.prank(bob);
        shield.register(address(weth), address(weth), TRIGGER, TARGET, STEP, SLIPPAGE);
    }

    function test_registerRejectsUnlistedAsset() public {
        MockERC20 junk = new MockERC20("Junk", "JUNK", 18);
        vm.startPrank(bob);
        vm.expectRevert(LiquidationShield.InvalidConfig.selector);
        shield.register(address(junk), address(usdc), TRIGGER, TARGET, STEP, SLIPPAGE);
        vm.expectRevert(LiquidationShield.InvalidConfig.selector);
        shield.register(address(weth), address(junk), TRIGGER, TARGET, STEP, SLIPPAGE);
        vm.stopPrank();
    }

    function test_registerWorksOnLegacyPool() public {
        pool.setLegacyMode(true); // Aave < 3.3: token getters revert, Shield falls back to getReserveData
        _register(TRIGGER, TARGET, STEP, SLIPPAGE);
        assertTrue(shield.getConfig(bob).active);
    }

    /// @dev Resetting a live `unwinding` flag needs a real Unwind; that case is tested with protect (#14).
    function test_reRegisterOverwritesConfig() public {
        _register(TRIGGER, TARGET, STEP, SLIPPAGE);
        _register(1.2e18, 1.5e18, 1500, 50);
        LiquidationShield.Config memory c = shield.getConfig(bob);
        assertEq(c.triggerHF, 1.2e18);
        assertEq(c.targetHF, 1.5e18);
        assertEq(c.maxStepBps, 1500);
        assertEq(c.maxSlippageBps, 50);
        assertFalse(c.unwinding);
    }

    // ---------------------------------------------------------------- test 2: unregister

    function test_unregisterDeactivatesAndEmits() public {
        _register(TRIGGER, TARGET, STEP, SLIPPAGE);
        vm.expectEmit(address(shield));
        emit Unregistered(bob);
        vm.prank(bob);
        shield.unregister();
        assertFalse(shield.getConfig(bob).active);
    }

    function test_unregisterWhenNotRegisteredReverts() public {
        vm.expectRevert(LiquidationShield.NotRegistered.selector);
        vm.prank(bob);
        shield.unregister();
    }

    function test_unregisterThenRegisterAgain() public {
        _register(TRIGGER, TARGET, STEP, SLIPPAGE);
        vm.prank(bob);
        shield.unregister();
        _register(TRIGGER, TARGET, STEP, SLIPPAGE);
        assertTrue(shield.getConfig(bob).active);
    }
}
