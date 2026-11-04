// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal Uniswap SwapRouter02 (`IV3SwapRouter`) surface. Router02's params have no deadline.
interface ISwapRouter02 {
    struct ExactOutputParams {
        bytes path; // tokenOut, fee, ..., fee, tokenIn (reversed)
        address recipient;
        uint256 amountOut;
        uint256 amountInMaximum;
    }

    function exactOutput(ExactOutputParams calldata params) external payable returns (uint256 amountIn);
}
