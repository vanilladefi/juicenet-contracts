// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;

/// The parameter object for setting stakes.
struct StakingParam {
    /// The address of the target asset i.e. the ERC-20 token.
    address token;
    /// The new amount of JUICE at stake. Zeroing removes the stake.
    uint128 amount;
    /// True if this is a long position, false if it's a short position.
    bool sentiment;
}

interface IJuiceStakerActions {
    /// @notice Deposits JUICE tokens to be used in staking. Moves `amount` of JUICE from user's balance to
    /// staking contract's balance.
    /// @param amount The deposited amount. If it exceeds user's balance, tx reverts with `InsufficientJUICE` error.
    function deposit(uint256 amount) external;

    /// @notice Modifies the user's token stakes.
    /// @param stakes The array of StakingParams which are processed in order.
    function modifyStakes(StakingParam[] calldata stakes) external;

    /// @notice Withdraws JUICE tokens from the staking contract. Moves `amount` of JUICE from the contract's balance to
    /// user's balance.
    /// @param amount The withdrawn amount. If it exceeds user's unstaked balance, tx reverts with `InsufficientJUICE` error.
    function withdraw(uint256 amount) external;

    /// @notice Emitted on successful deposit()
    /// @param user The user who made the deposit
    /// @param amount The deposited JUICE amount
    event JUICEDeposited(address indexed user, uint256 amount);

    /// @notice Emitted on successful withdraw()
    /// @param user The user who made the withdraw
    /// @param amount The withdrawn JUICE amount
    event JUICEWithdrawn(address indexed user, uint256 amount);

    /// @notice Emitted when adding to a staked token amount.
    /// @param user The staker
    /// @param token The staked token
    /// @param sentiment True if this is a long stake.
    /// @param price The token price.
    /// @param unstakedDiff The unstaked JUICE difference (negative when staking)
    event StakeAdded(
        address indexed user,
        address indexed token,
        bool sentiment,
        uint256 price,
        int256 unstakedDiff
    );

    /// @notice Emitted when unstaking from a token stake.
    /// @param user The staker
    /// @param token The staked token
    /// @param sentiment True if this is a long stake.
    /// @param price The token price.
    /// @param unstakedDiff The unstaked JUICE difference (positive when unstaking)
    event StakeRemoved(
        address indexed user,
        address indexed token,
        bool sentiment,
        uint256 price,
        int256 unstakedDiff
    );

    /// @notice Thrown if the StakeData.token is not supported (i.e. couldn't resolve a price feed for it, or it's on the unsafelist).
    error InvalidToken(address token);

    /// @notice Thrown when
    /// 1) deposited amount exceeds the balance, or
    /// 2) withdrawn amount exceeds the unstaked JUICE balance.
    error InsufficientJUICE(uint256 expected, uint256 actual);
}
