// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;

import "./IJuiceStakerActions.sol";
import "./IJuiceOwnerActions.sol";
import "./IJuiceStakerDelegateActions.sol";

struct LongTokenSignal {
    /// the long token address
    address token;
    /// the long token weight percentage rounded to nearest integer (0-100)
    uint96 weight;
}
struct AggregateTokenSignal {
    /// all long tokens in aggregate signal
    LongTokenSignal[] longTokens;
}

interface IJuiceStaking is
    IJuiceStakerActions,
    IJuiceOwnerActions,
    IJuiceStakerDelegateActions
{
    /// @notice Gets the current unstaked balance for `user`.
    /// @param user The staker.
    /// @return unstakedJUICE The current unstaked balance.
    function unstakedBalanceOf(address user)
        external
        view
        returns (uint256 unstakedJUICE);

    /// @notice Gets the current token stake position for user and token.
    /// @param user The staker.
    /// @param token The token.
    /// @return juiceStake The amount of Juice originally staked.
    /// @return juiceValue The current Juice value of this stake position.
    /// @return currentPrice The current price oracle value for the token. If price = 0, there is no price oracle for the token.
    /// @return sentiment True if the stake is long, false if short.
    function currentStake(address user, address token)
        external
        view
        returns (
            uint256 juiceStake,
            uint256 juiceValue,
            uint256 currentPrice,
            bool sentiment
        );

    /// @notice Gets the current aggregate signal
    function normalizedAggregateSignal()
        external
        view
        returns (AggregateTokenSignal memory);
}
