// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;

import "./interfaces/IJuiceStaking.sol";
import "./JuiceStakerDelegateEIP712Util.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import { SignatureCheckerUpgradeable as SignatureChecker } from "@openzeppelin/contracts-upgradeable/utils/cryptography/SignatureCheckerUpgradeable.sol";
import { ECDSAUpgradeable as ECDSA } from "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import { EnumerableSetUpgradeable as EnumerableSet } from "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";
import "./interfaces/IPriceOracle.sol";
import { StakingParam } from "./interfaces/IJuiceStakerActions.sol";

// decimals synced with Chainlink pricefeed decimals
uint8 constant DECIMALS = 8;

// used in StakePosition.amount calculations to retain good enough precision in intermediate price math
uint256 constant INTERNAL_TOKEN_AMOUNT_MULTIPLIER = 1e16;

abstract contract JuiceStaking is
    IJuiceStaking,
    ERC20Upgradeable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    JuiceStakerDelegateEIP712Util
{
    // !!!
    // JuiceStaking01 state
    // !!!

    /// this struct is used in contract storage, so it's been optimized to fit in uint128
    struct OraclePosition {
        /// downcasted from the value range of block.timestamp, which overflows uint64 in distant enough future
        uint64 timestamp;
        /// downcasted from the value range of uint80, but original value increments sequentially on every price update
        /// in single oracle, so overflow is improbable
        uint64 roundId;
    }

    /// this struct is memory-only so no need to optimize the layout
    struct OracleAnswer {
        uint80 roundId;
        uint256 price;
        uint256 timestamp;
    }

    struct StakePosition01 {
        /// The price position from Oracle when position was opened.
        OraclePosition pricePosition;
        /// The balance of Juice staked into this position. Long positions are negative, shorts are positive.
        int128 juiceBalance;
    }

    struct Stake01 {
        uint128 unstakedBalance;
        mapping(address => StakePosition01) tokenStake;
    }

    struct TokenSignal {
        uint128 totalLongs;
        uint128 totalShorts;
    }

    mapping(address => Stake01) internal stakes;
    mapping(address => TokenSignal) internal tokenSignals;

    struct AggregateSignal {
        uint128 totalVolume;
        int128 netSentiment;
        /// the percentage of long positions in signal (`W_{longs}` in lite paper)
        uint128 totalLongSentiment;
        /// the sum of weighted net sentiments (i.e. the total sum of longTokenSignals.longTokenWeight)
        uint128 sumWeightedNetSentiment;
    }

    AggregateSignal internal aggregatedSignal;

    AggregateTokenSignal internal aggregateTokenSignal;

    mapping(address => IPriceOracle) internal priceOracles;

    EnumerableSet.AddressSet internal registeredTokens;

    IJuiceSignalAggregator public signalAggregator;

    bytes32 public domainSeparatorV4;

    // !!!
    // JuiceStaking02 state
    // !!!

    struct StakePosition {
        /// The amount of tokens at stake.
        uint128 amount;
        /// The balance of Juice staked into this position. Long positions are negative, shorts are positive.
        int128 juiceBalance;
    }

    struct Stake {
        uint128 unstakedBalance;
        mapping(address => StakePosition) tokenStake;
    }

    mapping(address => Stake) internal stakes02;
}
