// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IAaveOracle, IFlashLoanSimpleReceiver, IPool, IPoolAddressesProvider} from "./interfaces/IAave.sol";
import {ISwapAdapter} from "./interfaces/ISwapAdapter.sol";

/// @title Liquidation Shield
/// @notice Non-custodial, permissionless liquidation protection for Aave V3 Positions.
///         A borrower registers a Trigger HF, Target HF, max step and max slippage, and grants an aToken
///         allowance. When HF falls below the trigger, anyone may call `protect` to run a flash-loan Step.
/// @dev Holds no funds between transactions. Trust model: the owner can swap the adapter (a malicious one can
///      take at most the user's `maxSlippageBps` per Step, and only below the trigger) and can pause, which
///      leaves users unprotected.
contract LiquidationShield is IFlashLoanSimpleReceiver, Ownable2Step, Pausable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

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

    /// @notice What `protect` would do now. `ClearUnwind` ends a stale Unwind after the price recovered.
    enum Action {
        None,
        Step,
        ClearUnwind
    }

    struct Preview {
        Action action;
        uint256 healthFactor; // WAD
        uint256 repayAmount; // debt units; 0 unless action == Step
        uint256 estCollateralSold; // collateral units; upper bound at the user's slippage cap
    }

    uint64 internal constant MIN_TRIGGER_HF = 1.02e18;
    uint64 internal constant MAX_TARGET_HF = 3e18;
    uint64 internal constant MIN_TARGET_GAP = 0.05e18;
    uint16 internal constant MIN_STEP_BPS = 500;
    uint16 internal constant MAX_STEP_BPS = 10_000;
    uint16 internal constant MIN_SLIPPAGE_BPS = 10;
    uint16 internal constant MAX_SLIPPAGE_BPS = 500;
    uint16 internal constant MAX_KEEPER_FEE_BPS = 50;
    uint256 internal constant VARIABLE_RATE = 2;
    /// @dev An Unwind is done once HF ≥ target · 99.5%.
    uint256 internal constant UNWIND_BAND_BPS = 9950;

    IPoolAddressesProvider public immutable ADDRESSES_PROVIDER;
    IPool public immutable POOL;

    address public swapAdapter;
    uint16 public keeperFeeBps;

    mapping(address user => Config) internal _configs;

    // Per-Step scratch, only alive inside `protect`.
    address internal transient _activeUser;
    uint256 internal transient _lastRepaid;
    uint256 internal transient _lastCollateralSold;
    uint256 internal transient _lastKeeperFee;

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
    event UnwindComplete(address indexed user);
    event Protected(
        address indexed user,
        address indexed keeper,
        uint256 hfBefore,
        uint256 hfAfter,
        uint256 debtRepaid,
        uint256 collateralSold,
        uint256 keeperFee
    );
    event Heartbeat(address indexed keeper, uint256 blockNumber);
    event SwapAdapterUpdated(address swapAdapter);
    event KeeperFeeUpdated(uint16 keeperFeeBps);

    error InvalidConfig();
    error NotRegistered();
    error NotProtectable(uint256 hf, uint256 trigger);
    error NothingToRepay();
    error HealthFactorNotImproved(uint256 before, uint256 afterHF);
    error UnauthorizedFlashLoan();
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

    // ---------------------------------------------------------------- protection

    /// @notice Run one Step for `user`: flash-borrow the debt asset, repay, sell just enough collateral, repay
    ///         the flash loan. Permissionless; the caller earns the keeper fee.
    ///         Allowed below the trigger, or mid-Unwind below target·0.995. Mid-Unwind at or above that band it
    ///         only clears the flag (ClearUnwind: no Step, no fee), so a later dip above the trigger can't Step.
    /// @return hfAfter The user's HF after the call.
    function protect(address user) external nonReentrant whenNotPaused returns (uint256 hfAfter) {
        Config memory c = _configs[user];
        if (!c.active) revert NotRegistered();
        (,,,,, uint256 hfBefore) = POOL.getUserAccountData(user);
        Action action = _action(c, hfBefore);
        if (action == Action.ClearUnwind) {
            _configs[user].unwinding = false;
            emit UnwindComplete(user);
            return hfBefore;
        }
        if (action == Action.None) revert NotProtectable(hfBefore, c.triggerHF);

        uint256 amount = _repayAmount(c, user);
        if (amount == 0) revert NothingToRepay();

        _activeUser = user;
        POOL.flashLoanSimple(address(this), c.debtAsset, amount, abi.encode(user, msg.sender), 0);
        _activeUser = address(0);

        (,,,,, hfAfter) = POOL.getUserAccountData(user);
        if (hfAfter <= hfBefore) revert HealthFactorNotImproved(hfBefore, hfAfter);
        bool unwinding = hfAfter < _band(c);
        _configs[user].unwinding = unwinding;
        emit Protected(user, msg.sender, hfBefore, hfAfter, _lastRepaid, _lastCollateralSold, _lastKeeperFee);
        if (c.unwinding && !unwinding) emit UnwindComplete(user);
    }

    /// @notice What `protect(user)` would do right now. The keeper calls `protect` when `action != None`.
    function previewProtect(address user) external view returns (Preview memory p) {
        Config memory c = _configs[user];
        (,,,,, p.healthFactor) = POOL.getUserAccountData(user);
        if (paused()) return p;
        p.action = _action(c, p.healthFactor);
        if (p.action != Action.Step) return p;

        p.repayAmount = _repayAmount(c, user);
        if (p.repayAmount == 0) {
            p.action = Action.None;
            return p;
        }
        uint256 premium = Math.mulDiv(p.repayAmount, POOL.FLASHLOAN_PREMIUM_TOTAL(), 1e4, Math.Rounding.Ceil);
        uint256 needed = p.repayAmount + premium + p.repayAmount * keeperFeeBps / 1e4;
        p.estCollateralSold = Math.min(_maxCollateralIn(c, needed), _availableCollateral(c, user));
    }

    /// @notice Aave flash-loan callback. Only accepts the loan `protect` itself started.
    function executeOperation(address asset, uint256 amount, uint256 premium, address initiator, bytes calldata params)
        external
        returns (bool)
    {
        if (msg.sender != address(POOL) || initiator != address(this)) revert UnauthorizedFlashLoan();
        (address user, address keeper) = abi.decode(params, (address, address));
        if (user == address(0) || user != _activeUser) revert UnauthorizedFlashLoan();

        // Repay before pulling collateral: aToken transfers re-check the sender's HF.
        IERC20 debt = IERC20(asset);
        debt.forceApprove(address(POOL), amount);
        uint256 repaid = POOL.repay(asset, amount, VARIABLE_RATE, user);
        uint256 fee = repaid * keeperFeeBps / 1e4;
        uint256 sold = _sellCollateral(_configs[user], user, repaid + premium + fee);

        if (fee != 0) debt.safeTransfer(keeper, fee);
        debt.forceApprove(address(POOL), amount + premium);

        _lastRepaid = repaid;
        _lastCollateralSold = sold;
        _lastKeeperFee = fee;
        return true;
    }

    /// @notice Debt to repay (base currency) so that selling collateral worth `k·x` lands HF on target.
    /// @dev Closed form (BRIEF §6.3): x = (target·D − C·LT) / (target − k·LT), k = 1 + costBps. Exact for
    ///      single-collateral Positions; an estimate for multi-collateral ones, where the next Step corrects the
    ///      residual. Rounds up so Steps err toward over-deleveraging.
    /// @param coll    total collateral, base currency
    /// @param debt    total debt, base currency
    /// @param ltBps   weighted liquidation threshold, bps
    /// @param targetHF target HF, WAD
    /// @param costBps k − 1 in bps: the slippage cap compounded with flash premium + keeper fee
    function repayBaseForTarget(uint256 coll, uint256 debt, uint256 ltBps, uint256 targetHF, uint256 costBps)
        public
        pure
        returns (uint256)
    {
        uint256 want = targetHF * debt; // WAD·base
        uint256 have = coll * ltBps * 1e14; // C·LT/1e4, scaled to WAD·base
        if (want <= have) return 0;
        uint256 lostPerRepaid = (1e4 + costBps) * ltBps * 1e10; // k·LT/1e4, WAD
        if (targetHF <= lostPerRepaid) return debt; // unreachable by selling collateral; the step cap bounds it
        return Math.min(Math.ceilDiv(want - have, targetHF - lostPerRepaid), debt);
    }

    function heartbeat() external {
        emit Heartbeat(msg.sender, block.number);
    }

    // ---------------------------------------------------------------- admin

    function setSwapAdapter(address swapAdapter_) external onlyOwner {
        if (swapAdapter_ == address(0)) revert ZeroAddress();
        swapAdapter = swapAdapter_;
        emit SwapAdapterUpdated(swapAdapter_);
    }

    function setKeeperFeeBps(uint16 keeperFeeBps_) external onlyOwner {
        if (keeperFeeBps_ > MAX_KEEPER_FEE_BPS) revert InvalidConfig();
        keeperFeeBps = keeperFeeBps_;
        emit KeeperFeeUpdated(keeperFeeBps_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Sweep tokens sent here by mistake. The Shield never holds user funds between transactions.
    function rescue(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    // ---------------------------------------------------------------- Step internals

    /// @dev The Unwind state machine. Inactive → None. Mid-Unwind → Step below the band, else ClearUnwind.
    ///      Otherwise → Step below the trigger, else None.
    function _action(Config memory c, uint256 hf) internal pure returns (Action) {
        if (!c.active) return Action.None;
        if (c.unwinding) return hf < _band(c) ? Action.Step : Action.ClearUnwind;
        return hf < c.triggerHF ? Action.Step : Action.None;
    }

    function _band(Config memory c) internal pure returns (uint256) {
        return uint256(c.targetHF) * UNWIND_BAND_BPS / 1e4;
    }

    /// @dev Flash amount in debt units: closed-form size, clamped to the step cap, the variable debt, and what the
    ///      user's collateral balance and allowance can cover.
    function _repayAmount(Config memory c, address user) internal view returns (uint256 amount) {
        (uint256 coll, uint256 debtBase,, uint256 ltBps,,) = POOL.getUserAccountData(user);
        uint256 premiumBps = POOL.FLASHLOAN_PREMIUM_TOTAL();
        // The swap's slippage applies to repaid + premium + fee, so the costs compound:
        // k = (1 + slippage)(1 + premium + fee), rounded up to whole bps.
        uint256 costBps = Math.ceilDiv((1e4 + c.maxSlippageBps) * (1e4 + premiumBps + keeperFeeBps), 1e4) - 1e4;
        uint256 xBase = repayBaseForTarget(coll, debtBase, ltBps, c.targetHF, costBps);
        xBase = Math.min(xBase, debtBase * c.maxStepBps / 1e4);

        (, uint256 pDebt,, uint256 uDebt) = _prices(c);
        amount = Math.mulDiv(xBase, uDebt, pDebt, Math.Rounding.Ceil);
        amount = Math.min(amount, IERC20(_variableDebtToken(c.debtAsset)).balanceOf(user));
        amount = Math.min(amount, _coverableRepay(c, user, premiumBps));
    }

    /// @dev Largest repay whose collateral pull (`_maxCollateralIn` of repay + premium + fee) fits in
    ///      min(balance, allowance). Its inverse, rounded down, less one unit for the premium's half-up rounding.
    function _coverableRepay(Config memory c, address user, uint256 premiumBps) internal view returns (uint256) {
        (uint256 pColl, uint256 pDebt, uint256 uColl, uint256 uDebt) = _prices(c);
        uint256 coverable = Math.mulDiv(
            _availableCollateral(c, user) * pColl,
            uDebt * 1e8,
            pDebt * uColl * (1e4 + c.maxSlippageBps) * (1e4 + keeperFeeBps + premiumBps)
        );
        return coverable > 0 ? coverable - 1 : 0;
    }

    /// @dev Pull collateral aTokens worth `needed` debt at the slippage cap, withdraw, swap exact-output, and
    ///      re-supply the leftover to the user.
    /// @return sold Collateral that left the Position.
    function _sellCollateral(Config memory c, address user, uint256 needed) internal returns (uint256 sold) {
        IERC20 aToken = IERC20(_aToken(c.collateralAsset));
        uint256 maxIn = Math.min(_maxCollateralIn(c, needed), _availableCollateral(c, user));
        aToken.safeTransferFrom(user, address(this), maxIn);
        uint256 withdrawn = POOL.withdraw(c.collateralAsset, type(uint256).max, address(this));

        IERC20 collateral = IERC20(c.collateralAsset);
        address adapter = swapAdapter;
        collateral.forceApprove(adapter, withdrawn);
        ISwapAdapter(adapter).swapExactOutput(c.collateralAsset, c.debtAsset, needed, withdrawn, address(this));
        collateral.forceApprove(adapter, 0);

        uint256 leftover = collateral.balanceOf(address(this));
        sold = withdrawn - leftover;
        if (leftover != 0) {
            collateral.forceApprove(address(POOL), leftover);
            POOL.supply(c.collateralAsset, leftover, user, 0);
        }
    }

    /// @dev ceil(needed · pDebt · 10^dColl · (1e4 + slippage) / (pColl · 10^dDebt · 1e4)).
    function _maxCollateralIn(Config memory c, uint256 needed) internal view returns (uint256) {
        (uint256 pColl, uint256 pDebt, uint256 uColl, uint256 uDebt) = _prices(c);
        return Math.mulDiv(needed * pDebt * uColl, 1e4 + c.maxSlippageBps, pColl * uDebt * 1e4, Math.Rounding.Ceil);
    }

    function _availableCollateral(Config memory c, address user) internal view returns (uint256) {
        IERC20 aToken = IERC20(_aToken(c.collateralAsset));
        return Math.min(aToken.balanceOf(user), aToken.allowance(user, address(this)));
    }

    /// @return pColl, pDebt oracle prices (base currency); uColl, uDebt 10^decimals.
    function _prices(Config memory c) internal view returns (uint256, uint256, uint256, uint256) {
        IAaveOracle oracle = IAaveOracle(ADDRESSES_PROVIDER.getPriceOracle());
        return (
            oracle.getAssetPrice(c.collateralAsset),
            oracle.getAssetPrice(c.debtAsset),
            10 ** IERC20Metadata(c.collateralAsset).decimals(),
            10 ** IERC20Metadata(c.debtAsset).decimals()
        );
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
