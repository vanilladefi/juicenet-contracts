// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity ^0.8.10;

import "./IPriceOracle.sol";
import "./IJuiceSignalAggregator.sol";

/// @notice Function implementations must ensure that only the contract owner is authorized to execute them.
interface IJuiceOwnerActions {
    /// @notice Authorizes the tokens and their respective price oracles for staking.
    /// @param tokens The token addresses.
    /// @param oracles The price oracle addresses for the token (i.e. value of `tokens[x]` in a matching array index `x`).
    function updatePriceOracles(
        address[] calldata tokens,
        IPriceOracle[] calldata oracles
    ) external;

    /// @notice Mints new JUICE for specified recipients.
    /// @param recipients The JUICE recipients.
    /// @param amounts The minted amounts for the respective recipient (i.e. value of `recipients[x]` in a matching array index `x`).
    function mintJuice(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external;

    /// @notice Pauses all staking and JUICE ERC-20 activity.
    /// @param pauseStaking True if pausing, false if unpausing.
    function emergencyPause(bool pauseStaking) external;

    /// @notice Sets the new JUICE signal aggregator.
    /// @dev Will call the aggregator with the latest signal
    /// @param aggregator if non-zero, registers the new aggregator address - otherwise unregisters the existing one
    function authorizeSignalAggregator(IJuiceSignalAggregator aggregator)
        external;

    /// @notice Thrown if the owner calls `setPriceOracles` with different sized arrays
    error TokenOracleMismatch(uint256 tokensLength, uint256 oraclesLength);

    /// @notice Thrown if the price oracle has unexpected decimal count
    error OracleDecimalMismatch(uint8 expected, uint8 actual);

    /// @notice Thrown if the owner calls `mintJuice` with different sized arrays
    error MintTargetMismatch(uint256 targetLength, uint256 amountLength);
}
