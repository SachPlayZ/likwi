// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IPool, IPoolAddressesProvider} from "./interfaces/IAave.sol";

/// @title Liquidation Shield
/// @notice Non-custodial, permissionless liquidation protection for Aave V3 Positions.
///         A borrower registers a Trigger HF, Target HF, max step and max slippage, and grants an aToken
///         allowance. When HF falls below the trigger, anyone may call `protect` to run a flash-loan Step.
contract LiquidationShield is Ownable2Step {
    struct Config {
        address collateralAsset;
        address debtAsset;
        uint64 triggerHF; // WAD
        uint64 targetHF; // WAD
        uint16 maxStepBps;
        uint16 maxSlippageBps;
        bool active;
        bool unwinding;
    }

    uint64 internal constant MIN_TRIGGER_HF = 1.02e18;
    uint64 internal constant MAX_TARGET_HF = 3e18;
    uint64 internal constant MIN_TARGET_GAP = 0.05e18;
    uint16 internal constant MIN_STEP_BPS = 500;
    uint16 internal constant MAX_STEP_BPS = 10_000;
    uint16 internal constant MIN_SLIPPAGE_BPS = 10;
    uint16 internal constant MAX_SLIPPAGE_BPS = 500;
    uint16 internal constant MAX_KEEPER_FEE_BPS = 50;

    IPoolAddressesProvider public immutable ADDRESSES_PROVIDER;
    IPool public immutable POOL;

    address public swapAdapter;
    uint16 public keeperFeeBps;

    mapping(address user => Config) internal _configs;

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

    error InvalidConfig();
    error NotRegistered();
    error ZeroAddress();

    constructor(address addressesProvider, address swapAdapter_, uint16 keeperFeeBps_, address owner_) Ownable(owner_) {
        if (addressesProvider == address(0) || swapAdapter_ == address(0)) revert ZeroAddress();
        if (keeperFeeBps_ > MAX_KEEPER_FEE_BPS) revert InvalidConfig();
        ADDRESSES_PROVIDER = IPoolAddressesProvider(addressesProvider);
        POOL = IPool(IPoolAddressesProvider(addressesProvider).getPool());
        swapAdapter = swapAdapter_;
        keeperFeeBps = keeperFeeBps_;
    }

    // ---------------------------------------------------------------- registration

    /// @notice Opt in, or overwrite an existing config (which also resets any in-progress Unwind).
    function register(
        address collateralAsset,
        address debtAsset,
        uint64 triggerHF,
        uint64 targetHF,
        uint16 maxStepBps,
        uint16 maxSlippageBps
    ) external {
        if (
            triggerHF < MIN_TRIGGER_HF || targetHF > MAX_TARGET_HF || targetHF < triggerHF + MIN_TARGET_GAP
                || maxStepBps < MIN_STEP_BPS || maxStepBps > MAX_STEP_BPS || maxSlippageBps < MIN_SLIPPAGE_BPS
                || maxSlippageBps > MAX_SLIPPAGE_BPS || collateralAsset == debtAsset || !_isListed(collateralAsset)
                || !_isListed(debtAsset)
        ) revert InvalidConfig();

        _configs[msg.sender] = Config({
            collateralAsset: collateralAsset,
            debtAsset: debtAsset,
            triggerHF: triggerHF,
            targetHF: targetHF,
            maxStepBps: maxStepBps,
            maxSlippageBps: maxSlippageBps,
            active: true,
            unwinding: false
        });
        emit Registered(msg.sender, collateralAsset, debtAsset, triggerHF, targetHF, maxStepBps, maxSlippageBps);
    }

    /// @notice Opt out. The user should also revoke the aToken allowance.
    function unregister() external {
        if (!_configs[msg.sender].active) revert NotRegistered();
        delete _configs[msg.sender];
        emit Unregistered(msg.sender);
    }

    function getConfig(address user) external view returns (Config memory) {
        return _configs[user];
    }

    // ---------------------------------------------------------------- reserve lookups

    /// @dev Aave V3.3+ getters, falling back to `getReserveData` on older pools.
    function _aToken(address asset) internal view returns (address) {
        try POOL.getReserveAToken(asset) returns (address a) {
            return a;
        } catch {
            return POOL.getReserveData(asset).aTokenAddress;
        }
    }

    function _variableDebtToken(address asset) internal view returns (address) {
        try POOL.getReserveVariableDebtToken(asset) returns (address d) {
            return d;
        } catch {
            return POOL.getReserveData(asset).variableDebtTokenAddress;
        }
    }

    function _isListed(address asset) internal view returns (bool) {
        return _aToken(asset) != address(0) && _variableDebtToken(asset) != address(0);
    }
}
