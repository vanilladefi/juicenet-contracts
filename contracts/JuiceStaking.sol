// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;

import "./interfaces/IJuiceStaking.sol";
import "./JuiceStakerDelegateEIP712Util.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./interfaces/IPriceOracle.sol";
import { StakingParam } from "./interfaces/IJuiceStakerActions.sol";

contract JuiceStaking is IJuiceStaking, ERC20, Ownable, Pausable, JuiceStakerDelegateEIP712Util {
    // decimals synced with Chainlink pricefeed decimals
    uint8 constant private DECIMALS = 8;

    struct StakePosition {
        /// The amount of tokens at stake.
        uint128 amount;
        /// The balance of Juice staked into this position. Long positions are negative, shorts are positive.
        int128 juiceBalance;
    }

    struct Stake {
        uint128 unstakedBalance;
        mapping (address => StakePosition) tokenStake;
    }

    struct TokenSignal {
        uint128 totalLongs;
        uint128 totalShorts;
    }

    mapping(address => Stake) private stakes;
    mapping(address => TokenSignal) private tokenSignals;



    struct AggregateSignal {
        uint128 totalVolume;
        int128 netSentiment;
        /// the percentage of long positions in signal (`W_{longs}` in whitepaper)
        uint128 totalLongSentiment;
        /// the sum of weighted net sentiments (i.e. the total sum of longTokenSignals.longTokenWeight)
        uint128 sumWeightedNetSentiment;
    }
    AggregateSignal private aggregatedSignal;

    AggregateTokenSignal private aggregateTokenSignal;

    mapping(address => IPriceOracle) private priceOracles;
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet private registeredTokens;

    IJuiceSignalAggregator public signalAggregator;

    bytes32 public domainSeparatorV4;

    constructor() ERC20("Vanilla Juice", "JUICE") {
        domainSeparatorV4 = hashDomainSeparator("Vanilla Juice", "1", block.chainid, address(this));
    }

    /// @inheritdoc ERC20
    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    /// @inheritdoc IJuiceOwnerActions
    function updatePriceOracles(address[] calldata tokens, IPriceOracle[] calldata oracles) external override onlyOwner {
        if (tokens.length != oracles.length) {
            revert TokenOracleMismatch(tokens.length, oracles.length);
        }
        for (uint i = 0; i < oracles.length; i++) {
            if (address(oracles[i]) == address(0)) {
                delete priceOracles[tokens[i]];
                registeredTokens.remove(tokens[i]);
                continue;
            }
            uint8 actualDecimals = oracles[i].decimals();
            if (actualDecimals != DECIMALS) {
                revert OracleDecimalMismatch(DECIMALS, actualDecimals);
            }
            priceOracles[tokens[i]] = oracles[i];
            registeredTokens.add(tokens[i]);
        }
    }

    /// @inheritdoc IJuiceOwnerActions
    function mintJuice(address[] calldata targets, uint[] calldata amounts) external onlyOwner {
        if(targets.length != amounts.length) {
            revert MintTargetMismatch(targets.length, amounts.length);
        }

        for (uint i = 0; i < targets.length; i++) {
            address target = targets[i];
            _mint(target, amounts[i]);
        }

    }

    /// @inheritdoc IJuiceOwnerActions
    function authorizeSignalAggregator(IJuiceSignalAggregator aggregator) external onlyOwner {
        signalAggregator = aggregator;
        if (address(aggregator) != address(0)) {
            aggregator.signalUpdated(aggregateTokenSignal);
        }
    }

    /// @inheritdoc IJuiceStaking
    function unstakedBalanceOf(address user) external view returns (uint) {
        return stakes[user].unstakedBalance;
    }

    /// @inheritdoc IJuiceStaking
    function currentStake(address user, address token) external view returns (uint128 amount, bool sentiment) {
        StakePosition memory stake = stakes[user].tokenStake[token];
        return (stake.amount, stake.juiceBalance < 0);
    }

    /// @inheritdoc IJuiceStakerActions
    function deposit(uint amount) external override whenNotPaused {
        doDeposit(amount, msg.sender);
    }

    function doDeposit(uint amount, address depositor) internal {
        uint currentBalance = balanceOf(depositor);
        if (currentBalance < amount) {
            revert InsufficientJUICE(amount, currentBalance);
        }

        stakes[depositor].unstakedBalance += uint128(amount);

        _transfer(depositor, address(this), amount);
        emit JUICEDeposited(depositor, amount);
    }

    /// @inheritdoc IJuiceStakerActions
    function withdraw(uint amount) external override whenNotPaused {
        doWithdraw(amount, msg.sender);
    }

    function doWithdraw(uint amount, address staker) internal {
        Stake storage stake = stakes[staker];
        if (stake.unstakedBalance < amount) {
            revert InsufficientJUICE(amount, stake.unstakedBalance);
        }
        stake.unstakedBalance -= uint128(amount);
        _transfer(address(this), staker, amount);
        emit JUICEWithdrawn(staker, amount);
    }

    /// @inheritdoc IJuiceStakerActions
    function modifyStakes(StakingParam[] calldata stakingParams) external override whenNotPaused {
        doModifyStakes(stakingParams, msg.sender);
    }

    function normalizedAggregateSignal() external view returns (AggregateTokenSignal memory) {
        return aggregateTokenSignal;
    }

    function normalizeTokenSignals(address[] memory tokens, uint[] memory weights, uint length, AggregateSignal memory totals) internal {
        LongTokenSignal[] memory longTokens = new LongTokenSignal[](length);
        LongTokenSignal[] storage storedLongTokens = aggregateTokenSignal.longTokens;
        for (uint i = 0; i < longTokens.length; i++ ) {

            uint96 weight = uint96(totals.totalLongSentiment * weights[i] / totals.sumWeightedNetSentiment);

            // do rounding
            if (weight % 100 > 50) {
                weight += (100 - weight % 100);
            }
            else {
                weight -= (weight % 100);
            }
            if (storedLongTokens.length == i) {
                storedLongTokens.push(LongTokenSignal({token: tokens[i], weight: weight/100}));
            }
            else {
                storedLongTokens[i] = LongTokenSignal({token: tokens[i], weight: weight/100});
            }
        }
        uint arrayItemsToRemove = storedLongTokens.length - length;
        while (arrayItemsToRemove > 0) {
            storedLongTokens.pop();
            arrayItemsToRemove--;
        }
    }

    function doModifyStakes(StakingParam[] calldata stakingParams, address staker) internal {
        Stake storage stake = stakes[staker];
        int juiceSupplyDiff = 0;
        int volumeDiff = 0;
        int sentimentDiff = 0;
        for (uint i = 0; i < stakingParams.length; i++) {
            StakingParam calldata param = stakingParams[i];
            TokenSignal storage tokenSignal = tokenSignals[param.token];
            (uint128 longsBefore, uint128 shortsBefore) = (tokenSignal.totalLongs, tokenSignal.totalShorts);
            juiceSupplyDiff += removeStake(param.token, stake, tokenSignal, staker);
            addStake(param, tokenSignal, staker);
            volumeDiff += (int(uint(tokenSignal.totalLongs + tokenSignal.totalShorts)) - int(uint(longsBefore + shortsBefore)));
            sentimentDiff += ((int(uint(tokenSignal.totalLongs)) - int(uint(longsBefore))) - (int(uint(tokenSignal.totalShorts)) - int(uint(shortsBefore))));
        }
        if (juiceSupplyDiff > 0) {
            _mint(address(this), uint(juiceSupplyDiff));
        }
        else if (juiceSupplyDiff < 0) {
            _burn(address(this), uint(-juiceSupplyDiff));
        }

        doUpdateAggregateSignal(volumeDiff, sentimentDiff);

    }

    function doUpdateAggregateSignal(int volumeDiff, int sentimentDiff) internal {
        AggregateSignal storage totals = aggregatedSignal;
        AggregateTokenSignal storage newTokenSignal = aggregateTokenSignal;

        if (volumeDiff < 0) {
            totals.totalVolume -= uint128(uint(-volumeDiff));
        }
        else {
            totals.totalVolume += uint128(uint(volumeDiff));
        }

        totals.netSentiment += int128(sentimentDiff);

        uint longWeight = totals.netSentiment > 0 ? 10000 * uint(int(totals.netSentiment)) / uint(totals.totalVolume) : 0;
        totals.totalLongSentiment = uint128(longWeight);

        uint initialLength = registeredTokens.length();
        address[] memory longTokens = new address[](initialLength);
        uint[] memory longWeights = new uint[](initialLength);
        uint longTokenCount = 0;
        uint totalWeightedLongs = 0;
        if (totals.totalVolume > 0) {
            for (uint i = 0; i < longTokens.length; i++) {
                address token = registeredTokens.at(i);
                TokenSignal memory tokenSignal = tokenSignals[token];
                if (tokenSignal.totalLongs <= tokenSignal.totalShorts) {
                    continue;
                }
                (uint totalLongs, uint totalShorts) = (tokenSignal.totalLongs, tokenSignal.totalShorts);

                uint V_x = totalLongs + totalShorts;
                uint N_x = totalLongs - totalShorts;

                uint weighted_x = N_x * V_x / uint(totals.totalVolume);

                longTokens[longTokenCount] = token;
                longWeights[longTokenCount] = weighted_x;

                longTokenCount++;
                totalWeightedLongs += weighted_x;
            }
        }
        totals.sumWeightedNetSentiment = uint128(totalWeightedLongs);
        // normalize and set token signal
        normalizeTokenSignals(longTokens, longWeights, longTokenCount, totals);

        if (address(signalAggregator) != address(0)) {
            signalAggregator.signalUpdated(aggregateTokenSignal);
        }
    }

    function addStake(StakingParam memory param, TokenSignal storage tokenSignal, address staker) internal {
        if (param.amount == 0) {
            // amount 0 means that stake has been removed
            return;
        }

        IPriceOracle priceOracle = priceOracles[param.token];
        if (address(priceOracle) == address(0)) {
            revert InvalidToken(param.token);
        }

        Stake storage stake = stakes[staker];
        if (stake.unstakedBalance < param.amount) {
            // limit the amount to the unstaked balance
            param.amount = stake.unstakedBalance;
        }

        stake.unstakedBalance -= param.amount;
        uint tokenPrice = uint(priceOracle.latestAnswer());
        uint multiplier = 1e16;
        uint128 positionSize = uint128(uint(param.amount) * multiplier / tokenPrice);
        if (param.sentiment) {
            stake.tokenStake[param.token] = StakePosition({amount: positionSize, juiceBalance: -int128(int(uint(param.amount)))});
            tokenSignal.totalLongs += param.amount;
        }
        else {
            stake.tokenStake[param.token] = StakePosition({amount: positionSize, juiceBalance: int128(int(uint(param.amount)))});
            tokenSignal.totalShorts += param.amount;
        }
        emit StakeAdded(staker, param.token, param.sentiment, tokenPrice, -int128(int(uint(param.amount))));
    }

    error UnsupportedToken(address token);

    function removeStake(address token, Stake storage currentStake, TokenSignal storage tokenSignal, address staker) internal returns (int juiceSupplyDiff) {
        int128 currentJuiceBalance = currentStake.tokenStake[token].juiceBalance;
        if (currentJuiceBalance == 0) {
            // nothing to remove, but not reverting to make parent function implementation simpler
            return 0;
        }

        IPriceOracle priceOracle = priceOracles[token];
        if (address(priceOracle) == address(0)) {
            // TODO handle this properly, we want enable users to close their positions if price oracles change.
            revert UnsupportedToken(token);
        }

        uint tokenPrice = uint(priceOracle.latestAnswer());
        uint multiplier = 1e16;

        // because Solidity rounds numbers towards zero, we add one to the positionSize to make sure that
        // removing the stake with the same tokenPrice refunds the exact same amount of JUICE back
        uint positionValue = (currentStake.tokenStake[token].amount + 1) * tokenPrice / multiplier;
        uint juiceRefund = positionValue;
        bool sentiment = currentJuiceBalance < 0;
        if (sentiment) {
            juiceSupplyDiff = int(positionValue) + currentJuiceBalance;
            tokenSignal.totalLongs -= uint128(uint(int(-currentJuiceBalance)));
        }
        else {
            int shortPositionValue = (2 * currentJuiceBalance) - int(positionValue);
            if (shortPositionValue > 0) {
                juiceRefund = uint(shortPositionValue);
                juiceSupplyDiff = int(shortPositionValue) - currentJuiceBalance;
            }
            else {
                juiceRefund = 0;
                juiceSupplyDiff = -currentJuiceBalance;
            }
            tokenSignal.totalShorts -= uint128(uint(int(currentJuiceBalance)));
        }
        currentStake.tokenStake[token] = StakePosition({amount: 0, juiceBalance: 0});
        currentStake.unstakedBalance += uint128(juiceRefund);

        emit StakeRemoved(staker, token, sentiment, tokenPrice, int(juiceRefund));

    }

    modifier onlyValidPermission(SignedPermission calldata permission, bytes32 hash) {
        if (block.timestamp > permission.data.deadline) {
            revert PermissionExpired();
        }
        if (permission.data.sender == address(0)) {
            revert InvalidSender();
        }

        uint currentNonce = permissionNonces[permission.data.sender];
        if (currentNonce != permission.data.nonce) {
            revert InvalidNonce();
        }
        permissionNonces[permission.data.sender] = currentNonce + 1;

        bytes32 EIP712TypedHash = ECDSA.toTypedDataHash(domainSeparatorV4, hash);
        bool isSignatureValid = SignatureChecker.isValidSignatureNow(permission.data.sender, EIP712TypedHash, permission.signature);
        if (!isSignatureValid) {
            revert InvalidSignature();
        }
        _;
    }

    /// @inheritdoc IJuiceStakerDelegateActions
    function delegateDeposit(uint amount, SignedPermission calldata permission) external
        whenNotPaused
        onlyValidPermission(permission, hashDeposit(amount, permission.data)) {
        doDeposit(amount, permission.data.sender);
    }

    /// @inheritdoc IJuiceStakerDelegateActions
    function delegateModifyStakes(StakingParam[] calldata stakes, SignedPermission calldata permission) external
        whenNotPaused
        onlyValidPermission(permission, hashModifyStakes(stakes, permission.data))  {
        doModifyStakes(stakes, permission.data.sender);
    }

    /// @inheritdoc IJuiceStakerDelegateActions
    function delegateWithdraw(uint amount, SignedPermission calldata permission) external
        whenNotPaused
        onlyValidPermission(permission, hashWithdraw(amount, permission.data)) {
        doWithdraw(amount, permission.data.sender);
    }

    /// @inheritdoc IJuiceOwnerActions
    function emergencyPause(bool pauseStaking) external onlyOwner {
        if (pauseStaking) {
            _pause();
        }
        else {
            _unpause();
        }
    }

    /// @inheritdoc ERC20
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        super._beforeTokenTransfer(from, to, amount);

        require (!paused(), "JUICE is temporarily disabled");

    }

}
