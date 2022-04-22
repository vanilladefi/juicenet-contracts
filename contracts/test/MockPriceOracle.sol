// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;

import "../interfaces/IPriceOracle.sol";

contract MockPriceOracle is IPriceOracle {
    struct MockRound {
        int256 price;
        uint256 timestamp;
    }

    MockRound[] private rounds;
    uint256 private constant PHASE_OFFSET = 64;
    uint256 private constant PHASE_SIZE = 16;
    uint16 private phaseId;

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestPrice() external view returns (int256) {
        MockRound memory round = rounds[rounds.length - 1];
        return round.price;
    }

    function setPrice(int256 newPrice) external {
        rounds.push(MockRound({ price: newPrice, timestamp: block.timestamp }));
    }

    function setPhaseId(uint16 pid) external {
        phaseId = pid;
    }

    function decodeId(uint256 roundId)
        internal
        pure
        returns (uint16 phaseId, uint64 realRoundId)
    {
        phaseId = uint16(roundId >> PHASE_OFFSET);
        realRoundId = uint64(roundId);
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
        (uint16 phaseId, uint64 rid) = decodeId(roundId);
        MockRound memory round = rounds[rid - 1];
        return (
            roundId,
            round.price,
            round.timestamp,
            round.timestamp,
            roundId
        );
    }

    function addPhase(uint16 phase, uint64 originalId)
        internal
        pure
        returns (uint80)
    {
        return uint80((uint256(phase) << PHASE_OFFSET) | originalId);
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
        uint80 roundId = addPhase(phaseId, uint64(rounds.length));
        MockRound memory round = rounds[rounds.length - 1];
        return (
            roundId,
            round.price,
            round.timestamp,
            round.timestamp,
            roundId
        );
    }
}
