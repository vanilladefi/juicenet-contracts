// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;

/// @notice Only used to make owner queries if the Juicenet contracts are owned by a multisig contract (e.g. Gnosis Safe)
interface IMultisig {
    /// @dev Similar interface as https://github.com/gnosis/safe-contracts/blob/main/contracts/base/OwnerManager.sol#L130
    function isOwner(address owner) external view returns (bool);
}
