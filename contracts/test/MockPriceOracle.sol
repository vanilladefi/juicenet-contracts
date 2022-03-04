// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;

import "../interfaces/IPriceOracle.sol";

contract MockPriceOracle is IPriceOracle {
    int256 private price;
    uint80 private roundId;
    uint256 private timestamp;

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function setPrice(int256 newPrice) external {
        price = newPrice;
        roundId++;
        timestamp = block.timestamp;
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
        return (roundId, price, timestamp, timestamp, roundId);
    }
}
