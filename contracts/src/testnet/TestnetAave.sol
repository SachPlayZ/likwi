// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    IPool,
    IPoolAddressesProvider,
    IAaveOracle,
    IFlashLoanSimpleReceiver,
    ReserveDataLegacy
} from "../interfaces/IAave.sol";

/// @notice **TESTNET ONLY.** An Aave V3-compatible test pool for the Monad testnet demo (BRIEF §17.1–17.2),
/// because Aave isn't deployed there. It is presented as our own test pool, not as Aave. Never wire any of
/// these contracts into a mainnet deploy: on mainnet the Shield points at real Aave.
///
/// Modelled: account data in 8-dec base currency, weighted LT/LTV, WAD health factor, variable debt only,
/// the aToken HF re-check on transfer, `withdraw(type(uint256).max)`, `flashLoanSimple` with the premium read
/// from `FLASHLOAN_PREMIUM_TOTAL`, and `liquidationCall` with a 50% close factor and the reserve's bonus.
/// Simplifications: no interest (indexes stay 1), every supplied reserve counts as collateral, no eMode /
/// isolation / caps, no credit delegation (`borrow` requires onBehalfOf == msg.sender), and underlying sits in
/// the pool rather than in the aToken.
///
/// Admin: every admin action (set price, mint/burn test tokens, list a reserve, set the flash premium, ...)
/// is gated by one owner: the `TestnetAddressesProvider` owner, with two-step transfer. So nobody else on the
/// public testnet can move our price mid-demo. Unit tests use open-admin subclasses (test/mocks/MockAave.sol).

interface ITestnetACL {
    function isAdmin(address account) external view returns (bool);
}

/// @dev Shared admin gate. `_checkAdmin` is virtual so test doubles can open it up.
abstract contract TestnetAccess {
    ITestnetACL public immutable ACL;

    error NotAdmin(address account);

    constructor(ITestnetACL acl) {
        ACL = acl;
    }

    modifier onlyAdmin() {
        _checkAdmin();
        _;
    }

    function _checkAdmin() internal view virtual {
        if (!ACL.isAdmin(msg.sender)) revert NotAdmin(msg.sender);
    }
}

/// @notice TESTNET ONLY. Holds the admin role (two-step ownership) and the pool / oracle pointers.
/// @dev The deploying contract gets a temporary bootstrap role to wire the set, then gives it up.
contract TestnetAddressesProvider is IPoolAddressesProvider, ITestnetACL, Ownable2Step {
    address public pool;
    address public priceOracle;
    address public bootstrap;

    error NotAdmin(address account);

    constructor(address owner_) Ownable(owner_) {
        bootstrap = msg.sender;
    }

    modifier onlyAdmin() {
        if (!isAdmin(msg.sender)) revert NotAdmin(msg.sender);
        _;
    }

    function isAdmin(address account) public view returns (bool) {
        return account != address(0) && (account == owner() || account == bootstrap);
    }

    /// @notice Ends the deployer's bootstrap role. Only the bootstrap address can call it.
    function endBootstrap() external {
        if (msg.sender != bootstrap) revert NotAdmin(msg.sender);
        bootstrap = address(0);
    }

    function setPool(address p) external onlyAdmin {
        pool = p;
    }

    function setPriceOracle(address o) external onlyAdmin {
        priceOracle = o;
    }

    function getPool() external view returns (address) {
        return pool;
    }

    function getPriceOracle() external view returns (address) {
        return priceOracle;
    }
}

/// @notice TESTNET ONLY. Admin-mintable test token (tWETH, tUSDC).
contract TestnetERC20 is ERC20, TestnetAccess {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, ITestnetACL acl)
        ERC20(name_, symbol_)
        TestnetAccess(acl)
    {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external onlyAdmin {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyAdmin {
        _burn(from, amount);
    }
}

/// @dev Pool-controlled token base: only the pool mints, burns or moves balances internally.
abstract contract TestnetPoolToken is ERC20 {
    TestnetPool public immutable POOL;
    address public immutable UNDERLYING_ASSET_ADDRESS;
    uint8 private immutable _decimals;

    error OnlyPool();

    modifier onlyPool() {
        if (msg.sender != address(POOL)) revert OnlyPool();
        _;
    }

    constructor(TestnetPool pool_, address underlying, string memory symbol_, uint8 decimals_)
        ERC20(symbol_, symbol_)
    {
        POOL = pool_;
        UNDERLYING_ASSET_ADDRESS = underlying;
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external onlyPool {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyPool {
        _burn(from, amount);
    }
}

/// @notice TESTNET ONLY. Like Aave, a user transfer re-checks the sender's HF afterwards.
contract TestnetAToken is TestnetPoolToken {
    constructor(TestnetPool pool_, address underlying, string memory symbol_, uint8 decimals_)
        TestnetPoolToken(pool_, underlying, symbol_, decimals_)
    {}

    /// @dev Liquidation with `receiveAToken`: moves balance without the HF check.
    function poolTransfer(address from, address to, uint256 amount) external onlyPool {
        _transfer(from, to, amount);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        super.transfer(to, amount);
        POOL.finalizeTransfer(msg.sender);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        super.transferFrom(from, to, amount);
        POOL.finalizeTransfer(from);
        return true;
    }
}

/// @notice TESTNET ONLY. Non-transferable variable debt.
contract TestnetVariableDebtToken is TestnetPoolToken {
    constructor(TestnetPool pool_, address underlying, string memory symbol_, uint8 decimals_)
        TestnetPoolToken(pool_, underlying, symbol_, decimals_)
    {}

    function transfer(address, uint256) public pure override returns (bool) {
        revert TestnetPool.OperationNotSupported();
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        revert TestnetPool.OperationNotSupported();
    }

    function approve(address, uint256) public pure override returns (bool) {
        revert TestnetPool.OperationNotSupported();
    }
}

/// @notice TESTNET ONLY. Admin-set prices, 8 decimals.
contract TestnetOracle is IAaveOracle, TestnetAccess {
    uint256 public constant BASE_CURRENCY_UNIT = 1e8;
    mapping(address => uint256) public prices;
    mapping(address => address) public sources;

    constructor(ITestnetACL acl) TestnetAccess(acl) {}

    function setAssetPrice(address asset, uint256 price) external onlyAdmin {
        prices[asset] = price;
    }

    function setSourceOfAsset(address asset, address source) external onlyAdmin {
        sources[asset] = source;
    }

    function getAssetPrice(address asset) external view returns (uint256) {
        return prices[asset];
    }

    function getSourceOfAsset(address asset) external view returns (address) {
        return sources[asset];
    }
}

/// @notice TESTNET ONLY. The Aave V3-compatible pool.
contract TestnetPool is IPool, TestnetAccess {
    using SafeERC20 for IERC20;

    struct Reserve {
        TestnetAToken aToken;
        TestnetVariableDebtToken debtToken;
        uint16 id;
        uint16 ltvBps;
        uint16 ltBps;
        uint16 bonusBps; // e.g. 10500 = 5% bonus
        uint8 decimals;
    }

    uint256 internal constant CLOSE_FACTOR_BPS = 5000;

    IPoolAddressesProvider public immutable ADDRESSES_PROVIDER;
    uint128 public FLASHLOAN_PREMIUM_TOTAL = 5;
    bool public legacyMode;

    address[] public reservesList;
    mapping(address => Reserve) internal _reserves;

    error OperationNotSupported();
    error ReserveNotListed();
    error InvalidAmount();
    error InvalidInterestRateMode();
    error CollateralCannotCoverBorrow();
    error HealthFactorLowerThanLiquidationThreshold();
    error HealthFactorNotBelowThreshold();
    error FlashLoanCallbackFailed();
    error LegacyPool();

    constructor(TestnetAddressesProvider provider) TestnetAccess(provider) {
        ADDRESSES_PROVIDER = provider;
    }

    // ---------------------------------------------------------------- admin

    function listReserve(address asset, uint16 ltvBps, uint16 ltBps, uint16 bonusBps) external onlyAdmin {
        uint8 dec = ERC20(asset).decimals();
        string memory sym = ERC20(asset).symbol();
        _reserves[asset] = Reserve({
            aToken: new TestnetAToken(this, asset, string.concat("a", sym), dec),
            debtToken: new TestnetVariableDebtToken(this, asset, string.concat("v", sym), dec),
            id: uint16(reservesList.length),
            ltvBps: ltvBps,
            ltBps: ltBps,
            bonusBps: bonusBps,
            decimals: dec
        });
        reservesList.push(asset);
    }

    function setFlashLoanPremiumTotal(uint128 bps) external onlyAdmin {
        FLASHLOAN_PREMIUM_TOTAL = bps;
    }

    /// @dev Models Aave < 3.3: `getReserveAToken` / `getReserveVariableDebtToken` revert.
    function setLegacyMode(bool on) external onlyAdmin {
        legacyMode = on;
    }

    // ---------------------------------------------------------------- core

    function supply(address asset, uint256 amount, address onBehalfOf, uint16) external {
        Reserve storage r = _listed(asset);
        if (amount == 0) revert InvalidAmount();
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        r.aToken.mint(onBehalfOf, amount);
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        Reserve storage r = _listed(asset);
        uint256 bal = r.aToken.balanceOf(msg.sender);
        if (amount == type(uint256).max) amount = bal;
        if (amount == 0 || amount > bal) revert InvalidAmount();
        r.aToken.burn(msg.sender, amount);
        _requireHealthy(msg.sender);
        IERC20(asset).safeTransfer(to, amount);
        return amount;
    }

    function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16, address onBehalfOf) external {
        Reserve storage r = _listed(asset);
        if (interestRateMode != 2) revert InvalidInterestRateMode();
        if (onBehalfOf != msg.sender) revert OperationNotSupported();
        if (amount == 0) revert InvalidAmount();
        r.debtToken.mint(onBehalfOf, amount);
        (uint256 c, uint256 d,,, uint256 ltv,) = getUserAccountData(onBehalfOf);
        if (d * 1e4 > c * ltv) revert CollateralCannotCoverBorrow();
        IERC20(asset).safeTransfer(msg.sender, amount);
    }

    function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf)
        external
        returns (uint256)
    {
        Reserve storage r = _listed(asset);
        if (interestRateMode != 2) revert InvalidInterestRateMode();
        uint256 debt = r.debtToken.balanceOf(onBehalfOf);
        uint256 paid = amount < debt ? amount : debt;
        if (paid == 0) revert InvalidAmount();
        IERC20(asset).safeTransferFrom(msg.sender, address(this), paid);
        r.debtToken.burn(onBehalfOf, paid);
        return paid;
    }

    function flashLoanSimple(address receiverAddress, address asset, uint256 amount, bytes calldata params, uint16)
        external
    {
        _listed(asset);
        // Aave's percentMul: half-up rounding.
        uint256 premium = (amount * FLASHLOAN_PREMIUM_TOTAL + 5000) / 1e4;
        IERC20(asset).safeTransfer(receiverAddress, amount);
        if (!IFlashLoanSimpleReceiver(receiverAddress).executeOperation(asset, amount, premium, msg.sender, params)) {
            revert FlashLoanCallbackFailed();
        }
        IERC20(asset).safeTransferFrom(receiverAddress, address(this), amount + premium);
    }

    function liquidationCall(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        bool receiveAToken
    ) external {
        Reserve storage rc = _listed(collateralAsset);
        Reserve storage rd = _listed(debtAsset);
        (,,,,, uint256 hf) = getUserAccountData(user);
        if (hf >= 1e18) revert HealthFactorNotBelowThreshold();

        (uint256 actualDebt, uint256 seized) = _liquidationAmounts(collateralAsset, debtAsset, user, debtToCover);
        if (actualDebt == 0) revert InvalidAmount();

        IERC20(debtAsset).safeTransferFrom(msg.sender, address(this), actualDebt);
        rd.debtToken.burn(user, actualDebt);
        if (receiveAToken) {
            rc.aToken.poolTransfer(user, msg.sender, seized);
        } else {
            rc.aToken.burn(user, seized);
            IERC20(collateralAsset).safeTransfer(msg.sender, seized);
        }
    }

    /// @dev Called by aTokens after a user transfer.
    function finalizeTransfer(address from) external view {
        _requireHealthy(from);
    }

    // ---------------------------------------------------------------- views

    function getUserAccountData(address user)
        public
        view
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        )
    {
        uint256 ltWeighted;
        uint256 ltvWeighted;
        for (uint256 i; i < reservesList.length; ++i) {
            (uint256 coll, uint256 debt, uint256 lt, uint256 ltv_) = _valueOf(reservesList[i], user);
            totalCollateralBase += coll;
            totalDebtBase += debt;
            ltWeighted += coll * lt;
            ltvWeighted += coll * ltv_;
        }
        if (totalCollateralBase != 0) {
            currentLiquidationThreshold = ltWeighted / totalCollateralBase;
            ltv = ltvWeighted / totalCollateralBase;
        }
        uint256 maxBorrow = ltvWeighted / 1e4;
        availableBorrowsBase = maxBorrow > totalDebtBase ? maxBorrow - totalDebtBase : 0;
        healthFactor = totalDebtBase == 0 ? type(uint256).max : ltWeighted * 1e18 / (totalDebtBase * 1e4);
    }

    function getReserveData(address asset) external view returns (ReserveDataLegacy memory data) {
        Reserve storage r = _reserves[asset];
        data.id = r.id;
        data.aTokenAddress = address(r.aToken);
        data.variableDebtTokenAddress = address(r.debtToken);
        data.liquidityIndex = 1e27;
        data.variableBorrowIndex = 1e27;
    }

    function getReserveAToken(address asset) external view returns (address) {
        if (legacyMode) revert LegacyPool();
        return address(_reserves[asset].aToken);
    }

    function getReserveVariableDebtToken(address asset) external view returns (address) {
        if (legacyMode) revert LegacyPool();
        return address(_reserves[asset].debtToken);
    }

    function getReservesList() external view returns (address[] memory) {
        return reservesList;
    }

    // ---------------------------------------------------------------- internal

    /// @dev A user's collateral and debt in one reserve, in base currency, plus its LT/LTV.
    function _valueOf(address asset, address user)
        internal
        view
        returns (uint256 coll, uint256 debt, uint256 lt, uint256 ltv_)
    {
        Reserve storage r = _reserves[asset];
        uint256 unit = 10 ** r.decimals;
        uint256 price = _price(asset);
        coll = r.aToken.balanceOf(user) * price / unit;
        debt = r.debtToken.balanceOf(user) * price / unit;
        lt = r.ltBps;
        ltv_ = r.ltvBps;
    }

    /// @dev 50% close factor; seize debt value × bonus in collateral, capped at the user's aTokens.
    function _liquidationAmounts(address collateralAsset, address debtAsset, address user, uint256 debtToCover)
        internal
        view
        returns (uint256 actualDebt, uint256 seized)
    {
        Reserve storage rc = _reserves[collateralAsset];
        Reserve storage rd = _reserves[debtAsset];
        uint256 maxDebt = rd.debtToken.balanceOf(user) * CLOSE_FACTOR_BPS / 1e4;
        actualDebt = debtToCover < maxDebt ? debtToCover : maxDebt;

        uint256 num = _price(debtAsset) * 10 ** rc.decimals * rc.bonusBps; // per unit of debt
        uint256 den = _price(collateralAsset) * 10 ** rd.decimals * 1e4;
        seized = actualDebt * num / den;
        uint256 collBal = rc.aToken.balanceOf(user);
        if (seized > collBal) {
            seized = collBal;
            actualDebt = seized * den / num;
        }
    }

    function _listed(address asset) internal view returns (Reserve storage r) {
        r = _reserves[asset];
        if (address(r.aToken) == address(0)) revert ReserveNotListed();
    }

    function _price(address asset) internal view returns (uint256) {
        return IAaveOracle(ADDRESSES_PROVIDER.getPriceOracle()).getAssetPrice(asset);
    }

    function _requireHealthy(address user) internal view {
        (,,,,, uint256 hf) = getUserAccountData(user);
        if (hf < 1e18) revert HealthFactorLowerThanLiquidationThreshold();
    }
}

/// @dev Builds and wires the full set with the spec's parameters, then hands admin to `owner_` alone.
///      The `_new*` hooks let the unit-test variant swap in open-admin subclasses.
abstract contract TestnetAaveDeployer {
    TestnetAddressesProvider public immutable addressesProvider;
    TestnetERC20 internal immutable _weth;
    TestnetERC20 internal immutable _usdc;
    TestnetOracle internal immutable _oracle;
    TestnetPool internal immutable _pool;

    constructor(address owner_) {
        TestnetAddressesProvider provider = new TestnetAddressesProvider(owner_);
        (TestnetERC20 weth_, TestnetERC20 usdc_) = _newTokens(provider);
        TestnetOracle oracle_ = _newOracle(provider);
        TestnetPool pool_ = _newPool(provider);

        provider.setPool(address(pool_));
        provider.setPriceOracle(address(oracle_));
        oracle_.setAssetPrice(address(weth_), 3000e8);
        oracle_.setAssetPrice(address(usdc_), 1e8);
        pool_.listReserve(address(weth_), 8000, 8250, 10500); // LTV 80%, LT 82.5%, 5% bonus
        pool_.listReserve(address(usdc_), 7500, 7800, 10450);
        weth_.mint(address(pool_), 1_000_000 ether);
        usdc_.mint(address(pool_), 1_000_000_000e6);
        provider.endBootstrap();

        addressesProvider = provider;
        _weth = weth_;
        _usdc = usdc_;
        _oracle = oracle_;
        _pool = pool_;
    }

    function _newTokens(TestnetAddressesProvider acl) internal virtual returns (TestnetERC20, TestnetERC20);
    function _newOracle(TestnetAddressesProvider acl) internal virtual returns (TestnetOracle);
    function _newPool(TestnetAddressesProvider provider) internal virtual returns (TestnetPool);
}

/// @notice **TESTNET ONLY.** One deploy builds the whole test pool: tWETH $3000 (LTV 80%, LT 82.5%,
///         5% bonus), tUSDC $1, a 5 bps flash premium and deep pool liquidity. `owner_` is the only admin
///         (two-step transfer on `addressesProvider`).
contract TestnetAave is TestnetAaveDeployer {
    constructor(address owner_) TestnetAaveDeployer(owner_) {}

    function weth() external view returns (TestnetERC20) {
        return _weth;
    }

    function usdc() external view returns (TestnetERC20) {
        return _usdc;
    }

    function oracle() external view returns (TestnetOracle) {
        return _oracle;
    }

    function pool() external view returns (TestnetPool) {
        return _pool;
    }

    function _newTokens(TestnetAddressesProvider acl) internal override returns (TestnetERC20, TestnetERC20) {
        return (new TestnetERC20("Test Wrapped Ether", "tWETH", 18, acl), new TestnetERC20("Test USD Coin", "tUSDC", 6, acl));
    }

    function _newOracle(TestnetAddressesProvider acl) internal override returns (TestnetOracle) {
        return new TestnetOracle(acl);
    }

    function _newPool(TestnetAddressesProvider provider) internal override returns (TestnetPool) {
        return new TestnetPool(provider);
    }
}
