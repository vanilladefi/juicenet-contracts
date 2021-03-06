// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;

import "../interfaces/IPriceOracle.sol";
import "../JuiceStaking02.sol";

contract MockJuiceStaking is JuiceStaking02 {
    using EnumerableSet for EnumerableSet.AddressSet;

    function getPriceOracle(address addr) public view returns (IPriceOracle) {
        return priceOracles[addr];
    }

    function hasRegisteredToken(address addr) public view returns (bool) {
        return registeredTokens.contains(addr);
    }

    function getTokenSignal(address token)
        public
        view
        returns (TokenSignal memory)
    {
        return tokenSignals[token];
    }

    function getInternalAggregate()
        public
        view
        returns (AggregateSignal memory)
    {
        return aggregatedSignal;
    }

    struct TokenOracleTuple {
        address token;
        address oracle;
    }

    function getRegisteredTokensAndOracles()
        public
        view
        returns (TokenOracleTuple[] memory)
    {
        TokenOracleTuple[] memory tokensAndOracles = new TokenOracleTuple[](
            registeredTokens.length()
        );
        for (uint256 i = 0; i < registeredTokens.length(); i++) {
            address token = registeredTokens.at(i);
            tokensAndOracles[i] = TokenOracleTuple({
                token: token,
                oracle: address(priceOracles[token])
            });
        }
        return tokensAndOracles;
    }
}
