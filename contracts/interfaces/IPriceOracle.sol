// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;

interface IPriceOracle {
    /// @notice Gets the decimals used in `latestAnswer()`.
    function decimals() external view returns (uint8);

    /// @notice Gets the latest price quote.
    /// @dev Intentionally named the same as the Chainlink aggregator interface (https://github.com/smartcontractkit/chainlink/blob/develop/contracts/src/v0.4/interfaces/AggregatorInterface.sol#L4).
    function latestAnswer() external view returns (int256);
}
