// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal Aave V3 interfaces used by the Shield. Signatures match Aave V3.2+.

interface IPoolAddressesProvider {
    function getPool() external view returns (address);
    function getPriceOracle() external view returns (address);
}

/// @dev Same layout as Aave's `DataTypes.ReserveDataLegacy` (returned by `getReserveData` on V3.2+).
///      `configuration` is the `ReserveConfigurationMap { uint256 data; }` wrapper, which ABI-encodes identically.
struct ReserveDataLegacy {
    uint256 configuration;
    uint128 liquidityIndex;
    uint128 currentLiquidityRate;
    uint128 variableBorrowIndex;
    uint128 currentVariableBorrowRate;
    uint128 currentStableBorrowRate;
    uint40 lastUpdateTimestamp;
    uint16 id;
    address aTokenAddress;
    address stableDebtTokenAddress;
    address variableDebtTokenAddress;
    address interestRateStrategyAddress;
    uint128 accruedToTreasury;
    uint128 unbacked;
    uint128 isolationModeTotalDebt;
}

interface IPool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;

    function withdraw(address asset, uint256 amount, address to) external returns (uint256);

    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)
        external;

    function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf)
        external
        returns (uint256);

    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;

    function liquidationCall(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        bool receiveAToken
    ) external;

    /// @return totalCollateralBase  base currency (8 dec)
    /// @return totalDebtBase        base currency (8 dec)
    /// @return availableBorrowsBase base currency (8 dec)
    /// @return currentLiquidationThreshold weighted, bps
    /// @return ltv weighted, bps
    /// @return healthFactor WAD
    function getUserAccountData(address user)
        external
        view
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        );

    /// @notice Flash-loan premium in bps. Read it; never hardcode it.
    function FLASHLOAN_PREMIUM_TOTAL() external view returns (uint128);

    function ADDRESSES_PROVIDER() external view returns (IPoolAddressesProvider);

    function getReserveData(address asset) external view returns (ReserveDataLegacy memory);

    /// @dev Aave V3.3+ only. Callers should `try` this and fall back to `getReserveData`.
    function getReserveAToken(address asset) external view returns (address);

    /// @dev Aave V3.3+ only. Callers should `try` this and fall back to `getReserveData`.
    function getReserveVariableDebtToken(address asset) external view returns (address);
}

interface IAaveOracle {
    /// @return price in base currency (8 dec)
    function getAssetPrice(address asset) external view returns (uint256);
    function getSourceOfAsset(address asset) external view returns (address);
    function BASE_CURRENCY_UNIT() external view returns (uint256);
}

interface IFlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);

    function ADDRESSES_PROVIDER() external view returns (IPoolAddressesProvider);
    function POOL() external view returns (IPool);
}
