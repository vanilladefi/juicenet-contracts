// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;

import "../interfaces/IPriceOracle.sol";

contract MockPriceOracle is IPriceOracle {
    struct MockRound {
        int256 price;
        uint256 timestamp;
    }

    MockRound[] private rounds;

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function setPrice(int256 newPrice) external {
        rounds.push(MockRound({ price: newPrice, timestamp: block.timestamp }));
    }

    function getRoundData(uint80 roundId)
        external
        view
        returns (
            uint80,
            int256,
            uint256,
            uint256,
            uint80
        )
    {
        MockRound memory round = rounds[roundId - 1];
        return (
            roundId,
            round.price,
            round.timestamp,
            round.timestamp,
            roundId
        );
    }

    function latestRoundData()
        external
        view
        returns (
            uint80,
            int256,
            uint256,
            uint256,
            uint80
        )
    {
        uint80 roundId = uint80(rounds.length);
        MockRound memory round = rounds[roundId - 1];
        return (
            roundId,
            round.price,
            round.timestamp,
            round.timestamp,
            roundId
        );
    }
}
