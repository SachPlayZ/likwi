// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISwapRouter02} from "../../src/interfaces/ISwapRouter02.sol";
import {MockERC20} from "./MockAave.sol";

/// @notice SwapRouter02 stand-in. Fills `exactOutput` at a fixed price per token (in a common unit),
///         pulling exactly the input it needs, like the real router.
contract MockSwapRouter is ISwapRouter02 {
    mapping(address => uint256) public unitPrice; // price of 1 whole token, 8 dec
    uint256 public costBps; // extra swap cost on top of the fair price
    bytes public lastPath;
    uint256 public calls;

    function setPrice(address token, uint256 price) external {
        unitPrice[token] = price;
    }

    function setCostBps(uint256 bps) external {
        costBps = bps;
    }

    function exactOutput(ExactOutputParams calldata p) external payable returns (uint256 amountIn) {
        address tokenOut = address(bytes20(p.path[:20]));
        address tokenIn = address(bytes20(p.path[p.path.length - 20:]));
        uint256 dIn = 10 ** MockERC20(tokenIn).decimals();
        uint256 dOut = 10 ** MockERC20(tokenOut).decimals();
        uint256 num = p.amountOut * unitPrice[tokenOut] * dIn * (1e4 + costBps);
        uint256 den = unitPrice[tokenIn] * dOut * 1e4;
        amountIn = (num + den - 1) / den; // round up, like the real router
        require(amountIn <= p.amountInMaximum, "Too much requested");

        lastPath = p.path;
        ++calls;
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        MockERC20(tokenOut).mint(p.recipient, p.amountOut);
    }
}
