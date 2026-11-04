// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPool, IFlashLoanSimpleReceiver, IPoolAddressesProvider} from "../../src/interfaces/IAave.sol";
import {MockAave, MockERC20, MockPool} from "./MockAave.sol";
import {TestnetPool} from "../../src/testnet/TestnetAave.sol";

/// @dev Sanity checks for the test double itself, so Shield tests can trust it.
contract FlashBorrower is IFlashLoanSimpleReceiver {
    IPool public immutable POOL;
    bool public repay = true;
    uint256 public seenAmount;
    uint256 public seenPremium;
    address public seenInitiator;

    constructor(IPool pool) {
        POOL = pool;
    }

    function ADDRESSES_PROVIDER() external view returns (IPoolAddressesProvider) {
        return POOL.ADDRESSES_PROVIDER();
    }

    function setRepay(bool r) external {
        repay = r;
    }

    function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata)
        external
        returns (bool)
    {
        seenAmount = IERC20(asset).balanceOf(address(this));
        seenPremium = premium;
        seenInitiator = initiator;
        if (repay) IERC20(asset).approve(address(POOL), amount + premium);
        return true;
    }
}

contract MockAaveTest is Test {
    MockAave aave;
    MockPool pool;
    MockERC20 weth;
    MockERC20 usdc;
    IERC20 aWeth;
    IERC20 vUsdc;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address liquidator = makeAddr("liquidator");

    function setUp() public {
        aave = new MockAave();
        pool = aave.pool();
        weth = aave.weth();
        usdc = aave.usdc();
        aWeth = IERC20(pool.getReserveAToken(address(weth)));
        vUsdc = IERC20(pool.getReserveVariableDebtToken(address(usdc)));
    }

    /// 20 WETH at $3000 = $60k collateral; borrow so HF = 1.30.
    function _openLoan(address who) internal returns (uint256 borrowed) {
        weth.mint(who, 20 ether);
        vm.startPrank(who);
        weth.approve(address(pool), type(uint256).max);
        pool.supply(address(weth), 20 ether, who, 0);
        // HF = 60000 * 0.825 / D = 1.30  =>  D = 38076.923076
        borrowed = 38_076_923076;
        pool.borrow(address(usdc), borrowed, 2, 0, who);
        vm.stopPrank();
    }

    function test_listsWethAndUsdcWithSpecParams() public view {
        assertEq(aave.oracle().getAssetPrice(address(weth)), 3000e8);
        assertEq(aave.oracle().getAssetPrice(address(usdc)), 1e8);
        assertEq(aave.oracle().BASE_CURRENCY_UNIT(), 1e8);
        assertEq(pool.FLASHLOAN_PREMIUM_TOTAL(), 5);
        assertEq(address(pool.ADDRESSES_PROVIDER()), address(aave.addressesProvider()));
        assertEq(aave.addressesProvider().getPool(), address(pool));
        assertEq(aave.addressesProvider().getPriceOracle(), address(aave.oracle()));
        assertEq(weth.decimals(), 18);
        assertEq(usdc.decimals(), 6);
    }

    function test_supplyBorrowAccountData() public {
        uint256 borrowed = _openLoan(alice);
        assertEq(aWeth.balanceOf(alice), 20 ether);
        assertEq(vUsdc.balanceOf(alice), borrowed);
        assertEq(usdc.balanceOf(alice), borrowed);

        (uint256 c, uint256 d,, uint256 lt,, uint256 hf) = pool.getUserAccountData(alice);
        assertEq(c, 60_000e8);
        assertEq(d, 38_076_923076 * 100);
        assertEq(lt, 8250);
        assertApproxEqRel(hf, 1.30e18, 1e12);
    }

    function test_noDebtHasMaxHealthFactor() public {
        weth.mint(alice, 1 ether);
        vm.startPrank(alice);
        weth.approve(address(pool), 1 ether);
        pool.supply(address(weth), 1 ether, alice, 0);
        vm.stopPrank();
        (,,,,, uint256 hf) = pool.getUserAccountData(alice);
        assertEq(hf, type(uint256).max);
    }

    function test_borrowAboveLtvReverts() public {
        weth.mint(alice, 1 ether);
        vm.startPrank(alice);
        weth.approve(address(pool), 1 ether);
        pool.supply(address(weth), 1 ether, alice, 0);
        vm.expectRevert(TestnetPool.CollateralCannotCoverBorrow.selector);
        pool.borrow(address(usdc), 2_500e6, 2, 0, alice); // LTV 80% of $3000 = $2400
        vm.stopPrank();
    }

    function test_repayOnBehalfAndMaxRepay() public {
        uint256 borrowed = _openLoan(alice);
        usdc.mint(bob, 100_000e6);
        vm.startPrank(bob);
        usdc.approve(address(pool), type(uint256).max);
        assertEq(pool.repay(address(usdc), 1_000e6, 2, alice), 1_000e6);
        assertEq(vUsdc.balanceOf(alice), borrowed - 1_000e6);
        uint256 paid = pool.repay(address(usdc), type(uint256).max, 2, alice);
        vm.stopPrank();
        assertEq(paid, borrowed - 1_000e6);
        assertEq(vUsdc.balanceOf(alice), 0);
    }

    function test_withdrawMaxAndHealthCheck() public {
        _openLoan(alice);
        vm.prank(alice);
        vm.expectRevert(TestnetPool.HealthFactorLowerThanLiquidationThreshold.selector);
        pool.withdraw(address(weth), 10 ether, alice);

        vm.prank(alice);
        uint256 out = pool.withdraw(address(weth), 1 ether, alice);
        assertEq(out, 1 ether);

        weth.mint(bob, 3 ether);
        vm.startPrank(bob);
        weth.approve(address(pool), 3 ether);
        pool.supply(address(weth), 3 ether, bob, 0);
        assertEq(pool.withdraw(address(weth), type(uint256).max, bob), 3 ether);
        vm.stopPrank();
        assertEq(weth.balanceOf(bob), 3 ether);
        assertEq(aWeth.balanceOf(bob), 0);
    }

    function test_aTokenTransferRechecksSenderHealth() public {
        _openLoan(alice);
        vm.prank(alice);
        vm.expectRevert(TestnetPool.HealthFactorLowerThanLiquidationThreshold.selector);
        aWeth.transfer(bob, 10 ether);

        vm.prank(alice);
        aWeth.approve(bob, 1 ether);
        vm.prank(bob);
        aWeth.transferFrom(alice, bob, 1 ether);
        assertEq(aWeth.balanceOf(bob), 1 ether);
    }

    function test_debtTokenIsNotTransferable() public {
        _openLoan(alice);
        vm.prank(alice);
        vm.expectRevert(TestnetPool.OperationNotSupported.selector);
        vUsdc.transfer(bob, 1);
    }

    function test_flashLoanSimpleChargesPoolPremium() public {
        FlashBorrower fb = new FlashBorrower(pool);
        usdc.mint(address(fb), 5e6); // to cover the premium
        uint256 poolBefore = usdc.balanceOf(address(pool));

        vm.prank(bob);
        pool.flashLoanSimple(address(fb), address(usdc), 10_000e6, "", 0);

        assertEq(fb.seenAmount(), 10_000e6 + 5e6);
        assertEq(fb.seenPremium(), 5e6); // 5 bps
        assertEq(fb.seenInitiator(), bob);
        assertEq(usdc.balanceOf(address(pool)), poolBefore + 5e6);
    }

    function test_flashLoanSimpleRevertsWithoutRepayment() public {
        FlashBorrower fb = new FlashBorrower(pool);
        fb.setRepay(false);
        vm.expectRevert();
        pool.flashLoanSimple(address(fb), address(usdc), 1_000e6, "", 0);
    }

    function test_premiumIsSettable() public {
        pool.setFlashLoanPremiumTotal(9);
        assertEq(pool.FLASHLOAN_PREMIUM_TOTAL(), 9);
    }

    function test_liquidationHealthyReverts() public {
        _openLoan(alice);
        usdc.mint(liquidator, 100_000e6);
        vm.startPrank(liquidator);
        usdc.approve(address(pool), type(uint256).max);
        vm.expectRevert(TestnetPool.HealthFactorNotBelowThreshold.selector);
        pool.liquidationCall(address(weth), address(usdc), alice, type(uint256).max, false);
        vm.stopPrank();
    }

    function test_liquidationCloseFactorAndBonus() public {
        uint256 borrowed = _openLoan(alice);
        aave.oracle().setAssetPrice(address(weth), 2250e8); // -25%
        (,,,,, uint256 hf) = pool.getUserAccountData(alice);
        assertLt(hf, 1e18);

        usdc.mint(liquidator, 100_000e6);
        vm.startPrank(liquidator);
        usdc.approve(address(pool), type(uint256).max);
        pool.liquidationCall(address(weth), address(usdc), alice, type(uint256).max, false);
        vm.stopPrank();

        uint256 repaid = borrowed / 2; // 50% close factor
        assertEq(vUsdc.balanceOf(alice), borrowed - repaid);
        assertEq(usdc.balanceOf(liquidator), 100_000e6 - repaid);
        // seized = repaid * $1 * 1.05 / $2250, in WETH units
        uint256 seized = repaid * 1e8 * 1e18 * 10500 / (2250e8 * 1e6 * 1e4);
        assertEq(weth.balanceOf(liquidator), seized);
        assertEq(aWeth.balanceOf(alice), 20 ether - seized);
    }

    function test_liquidationCanReceiveATokens() public {
        _openLoan(alice);
        aave.oracle().setAssetPrice(address(weth), 2250e8);
        usdc.mint(liquidator, 100_000e6);
        vm.startPrank(liquidator);
        usdc.approve(address(pool), type(uint256).max);
        pool.liquidationCall(address(weth), address(usdc), alice, 1_000e6, true);
        vm.stopPrank();
        assertEq(aWeth.balanceOf(liquidator), uint256(1_000e6) * 1e8 * 1e18 * 10500 / (2250e8 * 1e6 * 1e4));
    }

    function test_reserveLookupsAndLegacyFallback() public {
        assertEq(pool.getReserveData(address(weth)).aTokenAddress, address(aWeth));
        assertEq(pool.getReserveData(address(usdc)).variableDebtTokenAddress, address(vUsdc));

        address unlisted = makeAddr("unlisted");
        assertEq(pool.getReserveAToken(unlisted), address(0));
        assertEq(pool.getReserveData(unlisted).aTokenAddress, address(0));

        pool.setLegacyMode(true); // models Aave < 3.3, where these getters don't exist
        vm.expectRevert();
        pool.getReserveAToken(address(weth));
        vm.expectRevert();
        pool.getReserveVariableDebtToken(address(weth));
        assertEq(pool.getReserveData(address(weth)).aTokenAddress, address(aWeth));
    }
}
