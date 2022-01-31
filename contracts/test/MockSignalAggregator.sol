pragma solidity ^0.8.0;

import "../interfaces/IJuiceSignalAggregator.sol";
import { AggregateTokenSignal } from "../interfaces/IJuiceStaking.sol";

contract MockSignalAggregator is IJuiceSignalAggregator {

    event SignalWasUpdated();
    function signalUpdated(AggregateTokenSignal calldata signal) external {

        emit SignalWasUpdated();
    }
}
