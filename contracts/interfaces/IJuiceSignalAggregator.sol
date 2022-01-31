// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;

import { AggregateTokenSignal } from "./IJuiceStaking.sol";

/// @notice The implementation must only accept calls from authorized token sources.
interface IJuiceSignalAggregator {
    /// @notice Let's the aggregator know that aggregate signal has been updated.
    /// @param tokenSignal the latest signal
    function signalUpdated(AggregateTokenSignal memory tokenSignal) external;
}
