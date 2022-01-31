// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;

import { StakingParam } from "./IJuiceStakerActions.sol";


struct Permission {
    address sender;
    uint deadline;
    uint nonce;
}

struct SignedPermission {
    Permission data;
    bytes signature;
}

interface IJuiceStakerDelegateActions {
    /// @notice Thrown when SignedPermission.data.sender == address(0)
    error InvalidSender();

    /// @notice Thrown when SignedPermission.data.nonce doesn't match the latest nonce value for the SignedPermission.data.sender
    error InvalidNonce();

    /// @notice Thrown if block.timestamp > SignedPermission.data.deadline
    error PermissionExpired();

    /// @notice Thrown if the address recovered from the SignedPermission.signature doesn't match the SignedPermission.data.sender
    error InvalidSignature();


    /// @notice Deposits JUICE tokens to be used in staking on behalf of permitter
    /// @param amount The deposited amount. If it exceeds permitter's balance, tx reverts with `InsufficientJUICE` error.
    /// @param permission The EIP-712 v4 signed permission object for the deposit operation.
    function delegateDeposit(uint amount, SignedPermission calldata permission) external;

    /// @notice Modifies the permitter's token stakes.
    /// @param stakes The array of StakingParams which are processed in order.
    /// @param permission The EIP-712 v4 signed permission object for the modifyStakes operation.
    function delegateModifyStakes(StakingParam[] calldata stakes, SignedPermission calldata permission) external;

    /// @notice Withdraws JUICE tokens from the staking contract. Moves `amount` of JUICE from the contract's balance to
    /// permitter's balance.
    /// @param amount The withdrawn amount. If it exceeds permitter's unstaked balance, tx reverts with `InsufficientJUICE` error.
    /// @param permission The EIP-712 v4 signed permission object for the withdraw operation.
    function delegateWithdraw(uint amount, SignedPermission calldata permission) external;
}
