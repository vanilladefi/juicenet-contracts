// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;

import "./JuiceStaking.sol";
import "./interfaces/IMultisig.sol";
import { EnumerableSetUpgradeable as EnumerableSet } from "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

contract JuiceStaking02 is JuiceStaking {
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @inheritdoc ERC20Upgradeable
    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    /// @inheritdoc IJuiceOwnerActions
    function updatePriceOracles(
        address[] calldata tokens,
        IPriceOracle[] calldata oracles
    ) external override onlyOwner {
        if (tokens.length != oracles.length) {
            revert TokenOracleMismatch(tokens.length, oracles.length);
        }
        for (uint256 i = 0; i < oracles.length; i++) {
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
    function mintJuice(address[] calldata targets, uint256[] calldata amounts)
        external
        onlyOwner
    {
        if (targets.length != amounts.length) {
            revert MintTargetMismatch(targets.length, amounts.length);
        }

        for (uint256 i = 0; i < targets.length; i++) {
            address target = targets[i];
            _mint(target, amounts[i]);
        }
    }

    /// @inheritdoc IJuiceOwnerActions
    function authorizeSignalAggregator(IJuiceSignalAggregator aggregator)
        external
        onlyOwner
    {
        signalAggregator = aggregator;
        if (address(aggregator) != address(0)) {
            aggregator.signalUpdated(aggregateTokenSignal);
        }
    }

    /// @inheritdoc IJuiceStaking
    function unstakedBalanceOf(address user) external view returns (uint256) {
        return stakes02[user].unstakedBalance;
    }

    function latestPrice(address token)
        internal
        view
        returns (uint256 price, bool priceFound)
    {
        IPriceOracle priceOracle = priceOracles[token];
        if (address(priceOracle) == address(0)) {
            return (0, false);
        }
        return (latestAnswer(priceOracle), true);
    }

    /// @inheritdoc IJuiceStaking
    function currentStake(address user, address token)
        external
        view
        returns (
            uint256 juiceStake,
            uint256 juiceValue,
            uint256 currentPrice,
            bool sentiment
        )
    {
        StakePosition memory stake = stakes02[user].tokenStake[token];
        bool oracleFound;
        // if stake position was opened before price oracle was removed, their value will equal the original stake
        // oracleFound is therefore checked before calculating the juiceValue for both long and short positions
        (currentPrice, oracleFound) = latestPrice(token);

        if (stake.amount == 0) {
            // no stake for the token, return early
            return (0, 0, currentPrice, false);
        }
        sentiment = stake.juiceBalance < 0;
        if (sentiment) {
            juiceStake = uint256(int256(-stake.juiceBalance));
            juiceValue = oracleFound
                ? computeJuiceValue(stake.amount, currentPrice)
                : juiceStake;
        } else {
            juiceStake = uint256(int256(stake.juiceBalance));
            if (oracleFound) {
                int256 shortPositionValue = (2 * stake.juiceBalance) -
                    int256(computeJuiceValue(stake.amount, currentPrice));
                if (shortPositionValue > 0) {
                    juiceValue = uint256(shortPositionValue);
                } else {
                    juiceValue = 0;
                }
            } else {
                juiceValue = juiceStake;
            }
        }
    }

    /// @inheritdoc IJuiceStakerActions
    function deposit(uint256 amount) external override whenNotPaused {
        doDeposit(amount, msg.sender);
    }

    function doDeposit(uint256 amount, address depositor) internal {
        uint256 currentBalance = balanceOf(depositor);
        if (currentBalance < amount) {
            revert InsufficientJUICE(amount, currentBalance);
        }

        stakes02[depositor].unstakedBalance += uint128(amount);

        _transfer(depositor, address(this), amount);
        emit JUICEDeposited(depositor, amount);
    }

    /// @inheritdoc IJuiceStakerActions
    function withdraw(uint256 amount) external override whenNotPaused {
        doWithdraw(amount, msg.sender);
    }

    function doWithdraw(uint256 amount, address staker) internal {
        Stake storage stake = stakes02[staker];
        if (stake.unstakedBalance < amount) {
            revert InsufficientJUICE(amount, stake.unstakedBalance);
        }
        stake.unstakedBalance -= uint128(amount);
        _transfer(address(this), staker, amount);
        emit JUICEWithdrawn(staker, amount);
    }

    /// @inheritdoc IJuiceStakerActions
    function modifyStakes(StakingParam[] calldata stakingParams)
        external
        override
        whenNotPaused
    {
        doModifyStakes(stakingParams, msg.sender);
    }

    function normalizedAggregateSignal()
        external
        view
        returns (AggregateTokenSignal memory)
    {
        return aggregateTokenSignal;
    }

    function normalizeTokenSignals(
        address[] memory tokens,
        uint256[] memory weights,
        uint256 length,
        AggregateSignal memory totals
    ) internal {
        LongTokenSignal[] memory longTokens = new LongTokenSignal[](length);
        LongTokenSignal[] storage storedLongTokens = aggregateTokenSignal
            .longTokens;
        for (uint256 i = 0; i < longTokens.length; i++) {
            uint96 weight = uint96(
                (totals.totalLongSentiment * weights[i]) /
                    totals.sumWeightedNetSentiment
            );

            // do rounding
            if (weight % 100 > 50) {
                weight += (100 - (weight % 100));
            } else {
                weight -= (weight % 100);
            }
            if (storedLongTokens.length == i) {
                storedLongTokens.push(
                    LongTokenSignal({ token: tokens[i], weight: weight / 100 })
                );
            } else {
                storedLongTokens[i] = LongTokenSignal({
                    token: tokens[i],
                    weight: weight / 100
                });
            }
        }
        uint256 arrayItemsToRemove = storedLongTokens.length - length;
        while (arrayItemsToRemove > 0) {
            storedLongTokens.pop();
            arrayItemsToRemove--;
        }
    }

    function doModifyStakes(
        StakingParam[] calldata stakingParams,
        address staker
    ) internal {
        Stake storage stake = stakes02[staker];
        int256 juiceSupplyDiff = 0;
        int256 volumeDiff = 0;
        int256 sentimentDiff = 0;
        for (uint256 i = 0; i < stakingParams.length; i++) {
            StakingParam calldata param = stakingParams[i];
            TokenSignal storage tokenSignal = tokenSignals[param.token];
            (uint128 longsBefore, uint128 shortsBefore) = (
                tokenSignal.totalLongs,
                tokenSignal.totalShorts
            );
            juiceSupplyDiff += removeStake(
                param.token,
                stake,
                tokenSignal,
                staker
            );
            addStake(param, tokenSignal, staker);
            volumeDiff += (int256(
                uint256(tokenSignal.totalLongs + tokenSignal.totalShorts)
            ) - int256(uint256(longsBefore + shortsBefore)));
            sentimentDiff += ((int256(uint256(tokenSignal.totalLongs)) -
                int256(uint256(longsBefore))) -
                (int256(uint256(tokenSignal.totalShorts)) -
                    int256(uint256(shortsBefore))));
        }
        if (juiceSupplyDiff > 0) {
            _mint(address(this), uint256(juiceSupplyDiff));
        } else if (juiceSupplyDiff < 0) {
            _burn(address(this), uint256(-juiceSupplyDiff));
        }

        doUpdateAggregateSignal(volumeDiff, sentimentDiff);
    }

    function doUpdateAggregateSignal(int256 volumeDiff, int256 sentimentDiff)
        internal
    {
        AggregateSignal storage totals = aggregatedSignal;

        if (volumeDiff < 0) {
            totals.totalVolume -= uint128(uint256(-volumeDiff));
        } else {
            totals.totalVolume += uint128(uint256(volumeDiff));
        }

        totals.netSentiment += int128(sentimentDiff);

        uint256 longWeight = totals.netSentiment > 0
            ? (10000 * uint256(int256(totals.netSentiment))) /
                uint256(totals.totalVolume)
            : 0;
        totals.totalLongSentiment = uint128(longWeight);

        uint256 initialLength = registeredTokens.length();
        address[] memory longTokens = new address[](initialLength);
        uint256[] memory longWeights = new uint256[](initialLength);
        uint256 longTokenCount = 0;
        uint256 totalWeightedLongs = 0;
        if (totals.totalVolume > 0) {
            for (uint256 i = 0; i < longTokens.length; i++) {
                address token = registeredTokens.at(i);
                TokenSignal memory tokenSignal = tokenSignals[token];
                if (tokenSignal.totalLongs <= tokenSignal.totalShorts) {
                    continue;
                }
                (uint256 totalLongs, uint256 totalShorts) = (
                    tokenSignal.totalLongs,
                    tokenSignal.totalShorts
                );

                uint256 V_x = totalLongs + totalShorts;
                uint256 N_x = totalLongs - totalShorts;

                uint256 weighted_x = (N_x * V_x) / uint256(totals.totalVolume);

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

    function latestAnswer(IPriceOracle priceOracle)
        internal
        view
        returns (uint256)
    {
        (, int256 answer, , , ) = priceOracle.latestRoundData();
        return uint256(answer);
    }

    function addStake(
        StakingParam memory param,
        TokenSignal storage tokenSignal,
        address staker
    ) internal {
        if (param.amount == 0) {
            // amount 0 means that stake has been removed
            return;
        }

        IPriceOracle priceOracle = priceOracles[param.token];
        if (address(priceOracle) == address(0)) {
            revert InvalidToken(param.token);
        }

        Stake storage stake = stakes02[staker];
        if (stake.unstakedBalance < param.amount) {
            // limit the amount to the unstaked balance
            param.amount = stake.unstakedBalance;
        }

        stake.unstakedBalance -= param.amount;
        uint256 tokenPrice = latestAnswer(priceOracle);

        uint128 positionSize = uint128(
            (uint256(param.amount) * INTERNAL_TOKEN_AMOUNT_MULTIPLIER) /
                tokenPrice
        );
        if (param.sentiment) {
            stake.tokenStake[param.token] = StakePosition({
                amount: positionSize,
                juiceBalance: -int128(int256(uint256(param.amount)))
            });
            tokenSignal.totalLongs += param.amount;
        } else {
            stake.tokenStake[param.token] = StakePosition({
                amount: positionSize,
                juiceBalance: int128(int256(uint256(param.amount)))
            });
            tokenSignal.totalShorts += param.amount;
        }
        emit StakeAdded(
            staker,
            param.token,
            param.sentiment,
            tokenPrice,
            -int128(int256(uint256(param.amount)))
        );
    }

    function computeJuiceValue(uint128 tokenAmount, uint256 tokenPrice)
        internal
        pure
        returns (uint256)
    {
        // because Solidity rounds numbers towards zero, we add one to the tokenAmount to make sure that
        // removing the stake with the same tokenPrice refunds the exact same amount of JUICE back
        return
            ((tokenAmount + 1) * tokenPrice) / INTERNAL_TOKEN_AMOUNT_MULTIPLIER;
    }

    function removeStake(
        address token,
        Stake storage storedStakes,
        TokenSignal storage tokenSignal,
        address staker
    ) internal returns (int256 juiceSupplyDiff) {
        int128 currentJuiceBalance = storedStakes
            .tokenStake[token]
            .juiceBalance;
        if (currentJuiceBalance == 0) {
            // nothing to remove, but not reverting to make parent function implementation simpler
            return 0;
        }

        IPriceOracle priceOracle = priceOracles[token];
        if (address(priceOracle) == address(0)) {
            storedStakes.tokenStake[token] = StakePosition({
                amount: 0,
                juiceBalance: 0
            });
            uint256 refund;
            bool sentiment = currentJuiceBalance < 0;
            if (sentiment) {
                refund = uint256(int256(-currentJuiceBalance));
                storedStakes.unstakedBalance += uint128(refund);
                tokenSignal.totalLongs -= uint128(refund);
            } else {
                refund = uint256(int256(currentJuiceBalance));
                storedStakes.unstakedBalance += uint128(refund);
                tokenSignal.totalShorts -= uint128(refund);
            }
            // emit the event so that off-chain subscribers can simplify their event-based accounting
            emit StakeRemoved(staker, token, sentiment, 0, int256(refund));
            return 0;
        }

        uint256 tokenPrice = latestAnswer(priceOracle);
        uint256 positionValue = computeJuiceValue(
            storedStakes.tokenStake[token].amount,
            tokenPrice
        );
        uint256 juiceRefund = positionValue;
        bool sentiment = currentJuiceBalance < 0;
        if (sentiment) {
            juiceSupplyDiff = int256(positionValue) + currentJuiceBalance;
            tokenSignal.totalLongs -= uint128(
                uint256(int256(-currentJuiceBalance))
            );
        } else {
            int256 shortPositionValue = (2 * currentJuiceBalance) -
                int256(positionValue);
            if (shortPositionValue > 0) {
                juiceRefund = uint256(shortPositionValue);
                juiceSupplyDiff =
                    int256(shortPositionValue) -
                    currentJuiceBalance;
            } else {
                juiceRefund = 0;
                juiceSupplyDiff = -currentJuiceBalance;
            }
            tokenSignal.totalShorts -= uint128(
                uint256(int256(currentJuiceBalance))
            );
        }
        storedStakes.tokenStake[token] = StakePosition({
            amount: 0,
            juiceBalance: 0
        });
        storedStakes.unstakedBalance += uint128(juiceRefund);

        emit StakeRemoved(
            staker,
            token,
            sentiment,
            tokenPrice,
            int256(juiceRefund)
        );
    }

    modifier onlyValidPermission(
        SignedPermission calldata permission,
        bytes32 hash
    ) {
        if (block.timestamp > permission.data.deadline) {
            revert PermissionExpired();
        }
        if (permission.data.sender == address(0)) {
            revert InvalidSender();
        }

        uint256 currentNonce = permissionNonces[permission.data.sender];
        if (currentNonce != permission.data.nonce) {
            revert InvalidNonce();
        }
        permissionNonces[permission.data.sender] = currentNonce + 1;

        bytes32 EIP712TypedHash = ECDSA.toTypedDataHash(
            domainSeparatorV4,
            hash
        );
        bool isSignatureValid = SignatureChecker.isValidSignatureNow(
            permission.data.sender,
            EIP712TypedHash,
            permission.signature
        );
        if (!isSignatureValid) {
            revert InvalidSignature();
        }
        _;
    }

    /// @inheritdoc IJuiceStakerDelegateActions
    function delegateDeposit(
        uint256 amount,
        SignedPermission calldata permission
    )
        external
        whenNotPaused
        onlyValidPermission(permission, hashDeposit(amount, permission.data))
    {
        doDeposit(amount, permission.data.sender);
    }

    /// @inheritdoc IJuiceStakerDelegateActions
    function delegateModifyStakes(
        StakingParam[] calldata stakingParams,
        SignedPermission calldata permission
    )
        external
        whenNotPaused
        onlyValidPermission(
            permission,
            hashModifyStakes(stakingParams, permission.data)
        )
    {
        doModifyStakes(stakingParams, permission.data.sender);
    }

    /// @inheritdoc IJuiceStakerDelegateActions
    function delegateWithdraw(
        uint256 amount,
        SignedPermission calldata permission
    )
        external
        whenNotPaused
        onlyValidPermission(permission, hashWithdraw(amount, permission.data))
    {
        doWithdraw(amount, permission.data.sender);
    }

    /// @inheritdoc IJuiceOwnerActions
    function emergencyPause(bool pauseStaking) external {
        address owner = owner();
        if (pauseStaking) {
            if (owner == _msgSender() || isMultisigOwner(owner, _msgSender())) {
                _pause();
                return;
            }
        } else {
            if (owner == _msgSender()) {
                _unpause();
                return;
            }
        }
        revert UnauthorizedPause();
    }

    // this function returns true if owner is a contract, implements IMultisig and sender is one of the owners
    function isMultisigOwner(address owner, address sender)
        internal
        view
        returns (bool)
    {
        if (!AddressUpgradeable.isContract(owner)) {
            return false;
        }
        try IMultisig(owner).isOwner(sender) returns (bool isMultisigOwner) {
            return isMultisigOwner;
        } catch {
            return false;
        }
    }

    /// @inheritdoc ERC20Upgradeable
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        super._beforeTokenTransfer(from, to, amount);

        require(!paused(), "JUICE is temporarily disabled");
    }

    /// @inheritdoc UUPSUpgradeable
    function _authorizeUpgrade(address implementation)
        internal
        override
        onlyOwner
    {
        /// verify that only owner is allowed to upgrade
    }

    struct TokenPositionOwnerList {
        address owner;
        address[] tokens;
    }

    function migrateFrom01(TokenPositionOwnerList[] calldata list)
        external
        onlyOwner
    {
        for (uint256 i = 0; i < list.length; i++) {
            address owner = list[i].owner;
            Stake01 storage source = stakes[owner];
            Stake storage target = stakes02[owner];

            target.unstakedBalance += source.unstakedBalance;
            source.unstakedBalance = 0;

            for (uint256 j = 0; j < list[i].tokens.length; j++) {
                address token = list[i].tokens[j];
                int128 balance = source.tokenStake[token].juiceBalance;
                if (balance < 0) {
                    uint128 refund = uint128(uint256(-int256(balance)));
                    target.unstakedBalance += refund;
                    tokenSignals[token].totalLongs -= refund;
                    emit StakeRemoved(owner, token, true, 0, -balance);
                } else {
                    uint128 refund = uint128(uint256(int256(balance)));
                    target.unstakedBalance += refund;
                    tokenSignals[token].totalShorts -= refund;
                    emit StakeRemoved(owner, token, false, 0, balance);
                }
                delete source.tokenStake[token];
            }
        }
        for (uint256 i = 0; i < registeredTokens.length(); i++) {
            address token = registeredTokens.at(i);
            TokenSignal memory tokenSignal = tokenSignals[token];
            if (tokenSignal.totalLongs > 0 || tokenSignal.totalShorts > 0) {
                revert InvalidPost02MigrationState(
                    token,
                    tokenSignal.totalLongs,
                    tokenSignal.totalShorts
                );
            }
        }

        AggregateSignal memory currentTotals = aggregatedSignal;
        int256 volumeDiff = -int256(uint256(currentTotals.totalVolume));
        int256 sentimentDiff = -int256(currentTotals.netSentiment);
        doUpdateAggregateSignal(volumeDiff, sentimentDiff);
    }
}
