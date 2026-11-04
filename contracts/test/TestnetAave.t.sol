// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    TestnetAave,
    TestnetAccess,
    TestnetAddressesProvider,
    TestnetERC20,
    TestnetOracle,
    TestnetPool
} from "../src/testnet/TestnetAave.sol";

/// @notice #27: the deployable, owner-gated test pool. Behaviour is covered by MockAave.t.sol and the
///         Shield suites (they run on the same code through open-admin subclasses); this file covers the
///         one-shot deploy and the admin gate.
contract TestnetAaveTest is Test {
    TestnetAave deployment;
    TestnetAddressesProvider provider;
    TestnetPool pool;
    TestnetOracle oracle;
    TestnetERC20 weth;
    TestnetERC20 usdc;

    address operator = makeAddr("operator");
    address stranger = makeAddr("stranger");
    address alice = makeAddr("alice");

    function setUp() public {
        deployment = new TestnetAave(operator);
        provider = deployment.addressesProvider();
        pool = deployment.pool();
        oracle = deployment.oracle();
        weth = deployment.weth();
        usdc = deployment.usdc();
    }

    // ---------------------------------------------------------------- one deploy, spec parameters

    function test_deployWiresTheFullSet() public view {
        assertEq(provider.owner(), operator);
        assertEq(provider.getPool(), address(pool));
        assertEq(provider.getPriceOracle(), address(oracle));
        assertEq(address(pool.ADDRESSES_PROVIDER()), address(provider));

        assertEq(weth.symbol(), "tWETH");
        assertEq(weth.decimals(), 18);
        assertEq(usdc.symbol(), "tUSDC");
        assertEq(usdc.decimals(), 6);
        assertEq(IERC20Meta(pool.getReserveAToken(address(weth))).symbol(), "atWETH");
        assertEq(IERC20Meta(pool.getReserveVariableDebtToken(address(usdc))).symbol(), "vtUSDC");
        assertEq(pool.getReserveData(address(weth)).aTokenAddress, pool.getReserveAToken(address(weth)));

        assertEq(oracle.getAssetPrice(address(weth)), 3000e8);
        assertEq(oracle.getAssetPrice(address(usdc)), 1e8);
        assertEq(oracle.BASE_CURRENCY_UNIT(), 1e8);
        assertEq(pool.FLASHLOAN_PREMIUM_TOTAL(), 5);

        assertGt(weth.balanceOf(address(pool)), 0, "no WETH liquidity");
        assertGt(usdc.balanceOf(address(pool)), 0, "no USDC liquidity");
    }

    function test_reserveParamsMatchSpec() public {
        vm.prank(operator);
        weth.mint(alice, 1 ether);
        vm.startPrank(alice);
        weth.approve(address(pool), 1 ether);
        pool.supply(address(weth), 1 ether, alice, 0);
        vm.stopPrank();

        (uint256 c,,, uint256 lt, uint256 ltv,) = pool.getUserAccountData(alice);
        assertEq(c, 3000e8);
        assertEq(lt, 8250);
        assertEq(ltv, 8000);
    }

    function test_liquidationBonusIsFivePercent() public {
        vm.prank(operator);
        weth.mint(alice, 1 ether);
        vm.startPrank(alice);
        weth.approve(address(pool), 1 ether);
        pool.supply(address(weth), 1 ether, alice, 0);
        pool.borrow(address(usdc), 2_400e6, 2, 0, alice);
        vm.stopPrank();

        vm.prank(operator);
        oracle.setAssetPrice(address(weth), 2_000e8);
        vm.prank(operator);
        usdc.mint(stranger, 1_200e6);
        vm.startPrank(stranger);
        usdc.approve(address(pool), 1_200e6);
        pool.liquidationCall(address(weth), address(usdc), alice, type(uint256).max, false); // 50% = 1200
        vm.stopPrank();
        assertEq(weth.balanceOf(stranger), uint256(1_200e6) * 1e8 * 1e18 * 10500 / (2_000e8 * 1e6 * 1e4));
    }

    // ---------------------------------------------------------------- admin gate

    function test_strangerCannotSetPrice() public {
        _expectNotAdmin(stranger);
        oracle.setAssetPrice(address(weth), 1e8);
        assertEq(oracle.getAssetPrice(address(weth)), 3000e8);
    }

    function test_strangerCannotMint() public {
        _expectNotAdmin(stranger);
        weth.mint(stranger, 1 ether);
    }

    function test_strangerCannotBurn() public {
        _expectNotAdmin(stranger);
        usdc.burn(address(pool), 1);
    }

    function test_strangerCannotListReserve() public {
        TestnetERC20 junk = _newToken();
        _expectNotAdmin(stranger);
        pool.listReserve(address(junk), 5000, 6000, 11000);
    }

    function test_strangerCannotSetPremium() public {
        _expectNotAdmin(stranger);
        pool.setFlashLoanPremiumTotal(500);
    }

    function test_strangerCannotTouchOtherAdminHooks() public {
        _expectNotAdmin(stranger);
        pool.setLegacyMode(true);
        _expectNotAdmin(stranger);
        oracle.setSourceOfAsset(address(weth), stranger);
        _expectNotAdmin(stranger);
        provider.setPool(stranger);
        _expectNotAdmin(stranger);
        provider.setPriceOracle(stranger);
    }

    function test_ownerCanDoAllFour() public {
        TestnetERC20 junk = _newToken();
        vm.startPrank(operator);
        oracle.setAssetPrice(address(weth), 2_500e8);
        weth.mint(alice, 2 ether);
        pool.listReserve(address(junk), 5000, 6000, 11000);
        pool.setFlashLoanPremiumTotal(9);
        vm.stopPrank();

        assertEq(oracle.getAssetPrice(address(weth)), 2_500e8);
        assertEq(weth.balanceOf(alice), 2 ether);
        assertTrue(pool.getReserveAToken(address(junk)) != address(0));
        assertEq(pool.FLASHLOAN_PREMIUM_TOTAL(), 9);
    }

    function test_deployerKeepsNoPower() public {
        assertFalse(provider.isAdmin(address(deployment)));
        assertFalse(provider.isAdmin(address(this)));
        assertTrue(provider.isAdmin(operator));
        _expectNotAdmin(address(deployment));
        oracle.setAssetPrice(address(weth), 1e8);
    }

    function test_ownershipIsTwoStep() public {
        address next = makeAddr("next");
        vm.prank(operator);
        provider.transferOwnership(next);

        // pending: old owner still rules, new one can't act yet
        assertTrue(provider.isAdmin(operator));
        _expectNotAdmin(next);
        oracle.setAssetPrice(address(weth), 1e8);

        vm.prank(next);
        provider.acceptOwnership();
        assertFalse(provider.isAdmin(operator));
        vm.prank(next);
        oracle.setAssetPrice(address(weth), 1e8);
        assertEq(oracle.getAssetPrice(address(weth)), 1e8);
    }

    function test_constructorRejectsZeroOwner() public {
        vm.expectRevert();
        new TestnetAave(address(0));
    }

    // ---------------------------------------------------------------- helpers

    function _expectNotAdmin(address who) internal {
        vm.prank(who);
        vm.expectRevert(abi.encodeWithSelector(TestnetAccess.NotAdmin.selector, who));
    }

    function _newToken() internal returns (TestnetERC20) {
        return new TestnetERC20("Junk", "JUNK", 18, provider);
    }
}

interface IERC20Meta {
    function symbol() external view returns (string memory);
}
