// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapAdapter} from "../interfaces/ISwapAdapter.sol";
import {ISwapRouter02} from "../interfaces/ISwapRouter02.sol";

/// @title UniswapV3SwapAdapter
/// @notice Production swap venue for the Shield: exact-output swaps through Uniswap SwapRouter02
///         along owner-set paths (BRIEF §6.6).
/// @dev Holds no funds between calls: it pulls `maxAmountIn`, swaps, refunds the rest to the caller
///      and resets the router approval to 0. The owner chooses routes, so a malicious owner can pick a
///      bad pool; the Shield's `maxAmountIn` (the user's slippage cap) bounds the loss per swap.
contract UniswapV3SwapAdapter is ISwapAdapter, Ownable2Step {
    using SafeERC20 for IERC20;

    /// @dev Exact-output paths are encoded tokenOut, fee, ..., fee, tokenIn.
    uint256 private constant ADDR = 20;
    uint256 private constant HOP = 23; // uint24 fee + address

    ISwapRouter02 public immutable ROUTER;

    /// @notice tokenIn => tokenOut => exact-output path. Directional.
    mapping(address => mapping(address => bytes)) public paths;

    event PathSet(address indexed tokenIn, address indexed tokenOut, bytes path);

    error NoRoute(address tokenIn, address tokenOut);
    error InvalidPath();
    error ZeroAddress();

    constructor(address router, address owner_) Ownable(owner_) {
        if (router == address(0)) revert ZeroAddress();
        ROUTER = ISwapRouter02(router);
    }

    /// @notice Sets (or, with an empty `path`, clears) the route for tokenIn -> tokenOut.
    function setPath(address tokenIn, address tokenOut, bytes calldata path) external onlyOwner {
        if (path.length != 0) _validate(tokenIn, tokenOut, path);
        paths[tokenIn][tokenOut] = path;
        emit PathSet(tokenIn, tokenOut, path);
    }

    /// @inheritdoc ISwapAdapter
    function swapExactOutput(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 maxAmountIn,
        address recipient
    ) external returns (uint256 amountIn) {
        bytes memory path = paths[tokenIn][tokenOut];
        if (path.length == 0) revert NoRoute(tokenIn, tokenOut);

        IERC20 tIn = IERC20(tokenIn);
        tIn.safeTransferFrom(msg.sender, address(this), maxAmountIn);
        tIn.forceApprove(address(ROUTER), maxAmountIn);
        amountIn = ROUTER.exactOutput(
            ISwapRouter02.ExactOutputParams({
                path: path,
                recipient: recipient,
                amountOut: amountOut,
                amountInMaximum: maxAmountIn
            })
        );
        tIn.forceApprove(address(ROUTER), 0);
        if (maxAmountIn > amountIn) tIn.safeTransfer(msg.sender, maxAmountIn - amountIn);
    }

    function _validate(address tokenIn, address tokenOut, bytes calldata path) private pure {
        uint256 len = path.length;
        if (tokenIn == tokenOut || len < ADDR + HOP || (len - ADDR) % HOP != 0) revert InvalidPath();
        if (address(bytes20(path[:ADDR])) != tokenOut) revert InvalidPath();
        if (address(bytes20(path[len - ADDR:])) != tokenIn) revert InvalidPath();
    }
}
