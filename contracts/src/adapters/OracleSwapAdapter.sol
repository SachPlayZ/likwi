// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAaveOracle, IPoolAddressesProvider} from "../interfaces/IAave.sol";
import {ISwapAdapter} from "../interfaces/ISwapAdapter.sol";

/// @title OracleSwapAdapter
/// @notice **FORKS / TESTNETS ONLY.** Fills exact-output swaps from its own inventory at the Aave oracle
///         price plus `FEE_BPS`. On a fork the demo fakes an oracle crash while real AMM pools keep the old
///         price, so AMM swap numbers would be meaningless (BRIEF §5.8). Never wire this into a mainnet deploy.
/// @dev Pulls exactly the quoted input, so there is never anything to refund. Holds inventory by design;
///      the owner tops it up and withdraws it.
contract OracleSwapAdapter is ISwapAdapter, Ownable2Step {
    using SafeERC20 for IERC20;

    IPoolAddressesProvider public immutable ADDRESSES_PROVIDER;
    uint16 public immutable FEE_BPS;

    error SlippageExceeded(uint256 quoteIn, uint256 maxAmountIn);
    error ZeroAddress();

    constructor(address addressesProvider, uint16 feeBps, address owner_) Ownable(owner_) {
        if (addressesProvider == address(0)) revert ZeroAddress();
        ADDRESSES_PROVIDER = IPoolAddressesProvider(addressesProvider);
        FEE_BPS = feeBps;
    }

    /// @notice Input needed for exactly `amountOut`, at the oracle price plus the fee (rounded up).
    function quoteIn(address tokenIn, address tokenOut, uint256 amountOut) public view returns (uint256) {
        IAaveOracle oracle = IAaveOracle(ADDRESSES_PROVIDER.getPriceOracle());
        uint256 valueOut = amountOut * oracle.getAssetPrice(tokenOut) * 10 ** IERC20Metadata(tokenIn).decimals();
        uint256 unitIn = oracle.getAssetPrice(tokenIn) * 10 ** IERC20Metadata(tokenOut).decimals();
        return Math.mulDiv(valueOut, 1e4 + FEE_BPS, unitIn * 1e4, Math.Rounding.Ceil);
    }

    /// @inheritdoc ISwapAdapter
    function swapExactOutput(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 maxAmountIn,
        address recipient
    ) external returns (uint256 amountIn) {
        amountIn = quoteIn(tokenIn, tokenOut, amountOut);
        if (amountIn > maxAmountIn) revert SlippageExceeded(amountIn, maxAmountIn);
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
    }

    /// @notice Withdraw inventory.
    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
