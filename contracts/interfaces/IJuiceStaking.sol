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

interface IJuiceStaking is IJuiceStakerActions, IJuiceOwnerActions, IJuiceStakerDelegateActions {

    /// @notice Gets the current unstaked balance for `user`.
    /// @param user The staker.
    /// @return unstakedJUICE The current unstaked balance.
    function unstakedBalanceOf(address user) external view returns (uint unstakedJUICE);

    /// @notice Gets the current token stake position for user and token.
    /// @param user The staker.
    /// @param token The token.
    /// @return amount The size of stake position.
    /// @return sentiment True if the stake is long.
    function currentStake(address user, address token) external view returns (uint128 amount, bool sentiment);

    /// @notice Gets the current aggregate signal
    function normalizedAggregateSignal() external view returns (AggregateTokenSignal memory);
}
