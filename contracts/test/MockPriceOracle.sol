pragma solidity ^0.8.0;

import "../interfaces/IPriceOracle.sol";

contract MockPriceOracle is IPriceOracle {
    int256 private price;

    function decimals() external view returns (uint8) {
        return 8;
    }

    function setPrice(int256 newPrice) external {
        price = newPrice;
    }

    function latestAnswer() external view returns (int256) {
        return price;
    }
}
