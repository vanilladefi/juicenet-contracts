// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;

import "../interfaces/IPriceOracle.sol";

contract MockPriceOracle is IPriceOracle {
    int256 private price;

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function setPrice(int256 newPrice) external {
        price = newPrice;
    }

    function latestAnswer() external view returns (int256) {
        return price;
    }
}
