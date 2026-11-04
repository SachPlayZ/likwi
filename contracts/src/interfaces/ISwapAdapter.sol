// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Turns collateral into an exact amount of debt asset.
interface ISwapAdapter {
    /// @notice Pulls up to `maxAmountIn` of `tokenIn` from the caller, sends exactly `amountOut`
    ///         of `tokenOut` to `recipient`, and refunds unused input to the caller.
    /// @return amountIn The amount of `tokenIn` actually spent.
    function swapExactOutput(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 maxAmountIn,
        address recipient
    ) external returns (uint256 amountIn);
}
