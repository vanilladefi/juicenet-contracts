// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;

interface IPriceOracle {
    /// @notice Gets the decimals used in `latestAnswer()`.
    function decimals() external view returns (uint8);

    /// @notice Gets the price change data for exact roundId (i.e. an identifier for single historical price change in the Oracle)
    function getRoundData(uint80 _roundId)
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );

    /// @notice Gets the latest price change data.
    /// @dev Intentionally the same name and return values as the Chainlink aggregator interface (https://github.com/smartcontractkit/chainlink/blob/develop/contracts/src/v0.4/interfaces/AggregatorV3Interface.sol).
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}
