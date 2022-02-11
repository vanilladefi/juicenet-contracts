// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;

import "../interfaces/IPriceOracle.sol";
import "../JuiceStaking.sol";

contract MockJuiceStaking is JuiceStaking {
    using EnumerableSet for EnumerableSet.AddressSet;

    function getPriceOracle(address addr) public view returns (IPriceOracle) {
        return priceOracles[addr];
    }

    function hasRegisteredToken(address addr) public view returns (bool) {
        return registeredTokens.contains(addr);
    }
}
