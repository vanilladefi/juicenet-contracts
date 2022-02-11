// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;

import "../interfaces/IJuiceSignalAggregator.sol";
import { AggregateTokenSignal } from "../interfaces/IJuiceStaking.sol";

contract MockSignalAggregator is IJuiceSignalAggregator {
    event SignalWasUpdated();

    function signalUpdated(AggregateTokenSignal calldata) external {
        emit SignalWasUpdated();
    }
}
