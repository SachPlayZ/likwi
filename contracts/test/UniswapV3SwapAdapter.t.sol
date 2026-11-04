// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {UniswapV3SwapAdapter} from "../src/adapters/UniswapV3SwapAdapter.sol";
import {MockERC20} from "./mocks/MockAave.sol";
import {MockSwapRouter} from "./mocks/MockSwapRouter.sol";

/// @dev BRIEF §6.7 test 14: routing, refund, no residual balance, path validation, NoRoute.
contract UniswapV3SwapAdapterTest is Test {
    UniswapV3SwapAdapter adapter;
    MockSwapRouter router;
    MockERC20 weth;
    MockERC20 usdc;
    MockERC20 wmon;

    address owner = makeAddr("owner");
    address shield = makeAddr("shield"); // the caller in production
    address recipient = makeAddr("recipient");

    uint24 constant FEE_500 = 500;
    uint24 constant FEE_3000 = 3000;

    function setUp() public {
        router = new MockSwapRouter();
        adapter = new UniswapV3SwapAdapter(address(router), owner);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        wmon = new MockERC20("Wrapped MON", "WMON", 18);
        router.setPrice(address(weth), 3000e8);
        router.setPrice(address(usdc), 1e8);
        router.setPrice(address(wmon), 2e8);

        weth.mint(shield, 10 ether);
        vm.prank(shield);
        weth.approve(address(adapter), type(uint256).max);
    }

    // exact-output paths are reversed: tokenOut first, tokenIn last
    function _direct() internal view returns (bytes memory) {
        return abi.encodePacked(address(usdc), FEE_500, address(weth));
    }

    function _viaWmon() internal view returns (bytes memory) {
        return abi.encodePacked(address(usdc), FEE_3000, address(wmon), FEE_3000, address(weth));
    }

    function _setPath(bytes memory path) internal {
        vm.prank(owner);
        adapter.setPath(address(weth), address(usdc), path);
    }

    function _swap(uint256 amountOut, uint256 maxIn) internal returns (uint256) {
        vm.prank(shield);
        return adapter.swapExactOutput(address(weth), address(usdc), amountOut, maxIn, recipient);
    }

    function _assertNoResidual() internal view {
        assertEq(weth.balanceOf(address(adapter)), 0, "adapter holds WETH");
        assertEq(usdc.balanceOf(address(adapter)), 0, "adapter holds USDC");
        assertEq(wmon.balanceOf(address(adapter)), 0, "adapter holds WMON");
        assertEq(weth.allowance(address(adapter), address(router)), 0, "router approval not reset");
    }

    // ---------------------------------------------------------------- routing

    function test_routesDirectPathAndRefundsUnusedInput() public {
        _setPath(_direct());

        uint256 amountIn = _swap(3000e6, 1.1 ether);

        assertEq(amountIn, 1 ether); // $3000 of USDC at $3000/WETH
        assertEq(usdc.balanceOf(recipient), 3000e6);
        assertEq(weth.balanceOf(shield), 10 ether - amountIn, "unused input not refunded");
        assertEq(router.lastPath(), _direct());
        _assertNoResidual();
    }

    function test_routesMultiHopPath() public {
        _setPath(_viaWmon());
        uint256 amountIn = _swap(1500e6, 1 ether);
        assertEq(amountIn, 0.5 ether);
        assertEq(router.lastPath(), _viaWmon());
        assertEq(usdc.balanceOf(recipient), 1500e6);
        _assertNoResidual();
    }

    function test_exactMaxInputLeavesNothingToRefund() public {
        _setPath(_direct());
        uint256 amountIn = _swap(3000e6, 1 ether);
        assertEq(amountIn, 1 ether);
        assertEq(weth.balanceOf(shield), 9 ether);
        _assertNoResidual();
    }

    function test_revertsWhenSwapCostsMoreThanMax() public {
        _setPath(_direct());
        router.setCostBps(300); // 3% worse than fair
        vm.prank(shield);
        vm.expectRevert(bytes("Too much requested"));
        adapter.swapExactOutput(address(weth), address(usdc), 3000e6, 1.01 ether, recipient);
        assertEq(weth.balanceOf(shield), 10 ether);
    }

    function test_returnedAmountMatchesWhatWasPulled() public {
        _setPath(_direct());
        router.setCostBps(50);
        uint256 before = weth.balanceOf(shield);
        uint256 amountIn = _swap(3000e6, 2 ether);
        assertEq(before - weth.balanceOf(shield), amountIn);
        assertEq(weth.balanceOf(address(router)), amountIn);
        _assertNoResidual();
    }

    // ---------------------------------------------------------------- NoRoute

    function test_noRouteForUnsetPair() public {
        vm.prank(shield);
        vm.expectRevert(abi.encodeWithSelector(UniswapV3SwapAdapter.NoRoute.selector, address(weth), address(usdc)));
        adapter.swapExactOutput(address(weth), address(usdc), 1e6, 1 ether, recipient);
    }

    function test_pathsAreDirectional() public {
        _setPath(_direct());
        vm.prank(shield);
        vm.expectRevert(abi.encodeWithSelector(UniswapV3SwapAdapter.NoRoute.selector, address(usdc), address(weth)));
        adapter.swapExactOutput(address(usdc), address(weth), 1 ether, 4000e6, recipient);
    }

    function test_clearingAPathRemovesTheRoute() public {
        _setPath(_direct());
        _setPath("");
        assertEq(adapter.paths(address(weth), address(usdc)), "");
        vm.prank(shield);
        vm.expectRevert(abi.encodeWithSelector(UniswapV3SwapAdapter.NoRoute.selector, address(weth), address(usdc)));
        adapter.swapExactOutput(address(weth), address(usdc), 1e6, 1 ether, recipient);
    }

    // ---------------------------------------------------------------- path validation

    function test_setPathStoresAndEmits() public {
        vm.expectEmit(address(adapter));
        emit UniswapV3SwapAdapter.PathSet(address(weth), address(usdc), _direct());
        _setPath(_direct());
        assertEq(adapter.paths(address(weth), address(usdc)), _direct());
    }

    function test_invalidPathTooShort() public {
        _expectInvalid(abi.encodePacked(address(usdc))); // 20 bytes, no hop
    }

    function test_invalidPathBadLength() public {
        _expectInvalid(abi.encodePacked(address(usdc), FEE_500, address(weth), uint8(0)));
    }

    function test_invalidPathTokenOutNotFirst() public {
        _expectInvalid(abi.encodePacked(address(weth), FEE_500, address(usdc))); // input-order path
    }

    function test_invalidPathTokenInNotLast() public {
        _expectInvalid(abi.encodePacked(address(usdc), FEE_500, address(wmon)));
    }

    function test_invalidPathSameToken() public {
        vm.prank(owner);
        vm.expectRevert(UniswapV3SwapAdapter.InvalidPath.selector);
        adapter.setPath(address(weth), address(weth), abi.encodePacked(address(weth), FEE_500, address(weth)));
    }

    function _expectInvalid(bytes memory path) internal {
        vm.prank(owner);
        vm.expectRevert(UniswapV3SwapAdapter.InvalidPath.selector);
        adapter.setPath(address(weth), address(usdc), path);
    }

    // ---------------------------------------------------------------- admin

    function test_setPathIsOwnerOnly() public {
        vm.prank(shield);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, shield));
        adapter.setPath(address(weth), address(usdc), _direct());
    }

    function test_ownershipIsTwoStep() public {
        address next = makeAddr("next");
        vm.prank(owner);
        adapter.transferOwnership(next);
        assertEq(adapter.owner(), owner);
        vm.prank(next);
        adapter.acceptOwnership();
        assertEq(adapter.owner(), next);
    }

    function test_constructorRejectsZeroRouter() public {
        vm.expectRevert(UniswapV3SwapAdapter.ZeroAddress.selector);
        new UniswapV3SwapAdapter(address(0), owner);
    }

    // ---------------------------------------------------------------- fuzz

    function testFuzz_neverHoldsFundsAndRefundsExactly(uint256 amountOut, uint256 slackBps, uint16 costBps) public {
        amountOut = bound(amountOut, 1, 20_000e6);
        slackBps = bound(slackBps, 0, 5000);
        costBps = uint16(bound(costBps, 0, 500));
        _setPath(_direct());
        router.setCostBps(costBps);

        uint256 fairIn = amountOut * 1e8 * 1e18 * (1e4 + costBps);
        fairIn = (fairIn + 3000e8 * 1e6 * 1e4 - 1) / (3000e8 * 1e6 * 1e4);
        uint256 maxIn = fairIn * (1e4 + slackBps) / 1e4;
        vm.assume(maxIn <= 10 ether);

        uint256 amountIn = _swap(amountOut, maxIn);
        assertEq(amountIn, fairIn);
        assertEq(weth.balanceOf(shield), 10 ether - amountIn);
        assertEq(usdc.balanceOf(recipient), amountOut);
        _assertNoResidual();
    }
}
