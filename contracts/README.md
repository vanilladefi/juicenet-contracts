# Vanilla Juicenet contracts

This directory contains the Solidity source code for Vanilla Juicenet contracts.

This document is for smart contract and dapp developers who want to understand how the Juicenet contracts are structured, and what properties, post-conditions and invariants the different smart contract operations are expected to have.

1. [Juicenet Concept Overview](#juicenet-concept-overview)
   1. [Roles and Operations](#roles-and-operations)
2. [Juicenet State](#juicenet-state)
   1. [`stakes`- mapping](#stakes-mapping)
   2. [JUICE ERC20- state](#juice-erc20-state)
   3. [`priceOracles`- mapping](#priceoracles--mapping)
   4. [`signalAggregator`- address](#signalaggregator--address)
3. [Staker operations: `IJuiceStakerActions`](#staker-operations)
   1. [`deposit()`](#deposit)
   2. [`withdraw()`](#withdraw)
   3. [`modifyStakes()`](#modifystakes)
4. [Owner operations: `IJuiceOwnerActions`](#owner-operations)
   1. [`updatePriceOracles()`](#updatepriceoracles)
   2. [`mintJuice()`](#mintjuice)
   3. [`authorizeSignalAggregator()`](#authorizesignalaggregator)
   4. [`aggregateSignal()`](#aggregatesignal)
   4. [`emergencyPause()`](#emergencypause)
5. [Staker Delegate operations: `IJuiceStakerDelegateActions`](#staker-delegate-operations)
   1. [`delegateDeposit()`](#delegatedeposit)
   2. [`delegateWithdraw()`](#delegatewithdraw)
   3. [`delegateModifyStakes()`](#delegatemodifystakes)
6. [External Contract Dependencies](#external-contract-dependencies)
   1. [Price Oracle- interface](#price-oracles)
   2. [Signal Aggregator- interface](#signal-aggregators)

## Juicenet Concept Overview

Juicenet is a form of prediction market where the users stake JUICE tokens to take long and short positions, where profitable positions earn more JUICE, while unprofitable positions lose JUICE.

JUICE token is a standard ERC-20 fungible token.

Stake is composed of the following data:
- **target asset**: an ERC-20 token address (native assets can be targeted using their wrapped versions, like [WETH](https://etherscan.io/token/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2) for Ether.)
- **stake size**: the number of staked JUICE tokens
- **sentiment**: either _long_ or _short_

Profitability of the staking position depends on target asset's price performance relative to the stake size and sentiment. A long stake becomes more valuable when target asset's price goes up. A short stake becomes more valuable when target asset's price goes down.

Juicenet Signal refers to the aggregate stakes from all Stakers in each target asset.

Juicenet and JUICE token functionality are implemented as a single contract. This is a deliberate design decision - the Juicenet mints new and burns existing tokens in normal operation, and in OpenZeppelin ERC-20 standard implementation those functions are only available via inheritance.

### Roles and Operations

There are three user roles in the Juicenet, the Staker (aka the User), the Owner, and the Staker Delegate.

Stakers can:

- **deposit** their JUICE tokens to Juicenet
- **withdraw** their deposited JUICE tokens from Juicenet
- **add**, **remove** or **reverse** their own stakes

Owner can:

- **upgrade** the Juicenet contracts
- **safe-list** the price oracles and respective target assets
- **mint** new JUICE for specified recipients
- **authorize** a new Juicenet Signal aggregator
- **re-aggregate** the Juicenet Signal to the authorized aggregator
- **pause** and **unpause** all the Staker operations
- **transfer ownership** to a new Owner account
- **renounce ownership** which permanently disables all the Owner actions

The Owner role is initially assigned to the contract deployer.

Staker Delegate is a special role as they are not actual users of Juicenet per se - instead, their only purpose is to perform operations on behalf of another Staker (who has explicitly authorized them using signed permissions).

## Juicenet state
_TBD clarify the Juicenet state, the properties and invariants in more rigid detail_.

### `stakes`-mapping

This is the mapping, which holds the internal Juicenet state for all Staker operations.
```solidity
struct StakePosition {
    /// The amount of tokens at stake.
    uint128 amount;
    /// The balance of Juice staked into this position. Long positions are negative, shorts are positive.
    int128 juiceBalance;
}

struct Stake {
    uint unstakedBalance;
    // stakes per ERC-20 token address
    mapping (address => StakePosition) tokenStake;
}

// stakes per Staker address
mapping(address => Stake) private stakes;
```
Here's a high-level summary of the state-changing effects for each Staking action done by a staker `s`:
- Deposit: `stakes[s].unstakedBalance` increases
- Withdraw: `stakes[s].unstakedBalance` decreases
- Stake Addition for token `t`:
  - `stakes[s].tokenStake[t].amount` increases (based on price of `t`)
  - `stakes[s].tokenStake[t].juiceBalance` increases
  - `stakes[s].unstakedBalance` decreases
- Stake Removal for token `t`:
  - `stakes[s].tokenStake[t].amount` decreases
  - `stakes[s].tokenStake[t].juiceBalance` decreases
  - `stakes[s].unstakedBalance` increases

Withdrawal is an inverse operation to Deposit (i.e., assuming no other actions, withdrawing the deposited amount results in the state that was before the deposit).

However, the Stake Removal is *not* an inverse operation to the Stake addition, because the amount of Juice received on Stake Removal depends on the price and the number of the tokens at stake. See [`removeStake()`](#function-removestakeaddress-token-internal-returns-int-juicesupplydiff) for more detailed description of the state effects during the operation.

### JUICE ERC20 state

The Juicenet staking has also effects on the JUICE ERC-20 token state, in particular the token supply and individual token balance.

Here's a high-level summary of these effects for each Juicenet action by a staker `s` and Juicenet contract `this`:
- Deposit:
  - Total supply is unchanged
  - `balanceOf[s]` decreases, `balanceOf[this]` increases
- Withdraw:
  - Total supply is unchanged
  - `balanceOf[s]` increases, `balanceOf[this]` decreases
- Stake Addition:
  - Total supply is unchanged
  - Token balances are unchanged
- Stake Removal:
  - Token supply increases or decreases, depending on the stake's performance
  - `balanceOf[this]` increases or decreases the same amount as total supply changes
- Minting JUICE for a recipient `r` (Owner's [`mintJuice()`](#mintjuice)- operation):
  - Total supply increases
  - `balanceOf[r]` increases

The Owner action [`emergencyPause()`](#emergencypause) also pause all ERC-20 functionality.

### `priceOracles`- mapping
This is the mapping, which contains the permitted [price oracle addresses](#price-oracles) for each supported token that can be staked in Juicenet.
```solidity
mapping(address => IPriceOracle) private priceOracles;
```
If token's address is not in the `priceOracles` mapping, then it is not supported and Stakers will not be able to add Stakes for it.

### `signalAggregator`- address

This is the address of an authorized [signal aggregator](#signal-aggregators)
```solidity
address private signalAggregator;
```
TODO: define the data structure for aggregate signal too

## Staker operations

The Staker operations are defined in the interface `interfaces/IJuiceStakerActions.sol`.

### `deposit`

```solidity
/// @notice Deposits JUICE tokens to be used in staking. Moves `amount` of JUICE from user's balance to
/// staking contract's balance.
/// @param amount The deposited amount. If it exceeds user's balance, tx reverts with `InsufficientJUICE` error.
function deposit(uint amount) external;

/// @notice Emitted on successful deposit()
/// @param user The user who made the deposit
/// @param amount The deposited JUICE amount
event JUICEDeposited(address indexed user, uint amount);

/// @notice Thrown if
/// 1) when deposited amount exceeds the balance, or
/// 2) when withdrawn amount exceeds the unstaked JUICE balance.
error InsufficientJUICE(uint expected, uint actual);
```

**Checks**:
- `!paused()`; otherwise revert with message _"Pausable: paused"_ (OpenZeppelin Pauseable)
- `ERC20(this).balanceOf(msg.sender) >= amount`; otherwise revert with error `InsufficientJuice`.
- `ERC20(this).allowance(msg.sender, this) >= amount`; otherwise revert with message _"ERC20: transfer amount exceeds allowance"_.

**Effects**:
- `stakes[msg.sender].unstakedBalance += amount`

**Interactions**
- `ERC20(this).transferFrom(msg.sender, this, amount)`
- `emit Transfer(msg.sender, this, amount)` (ERC20)
- `emit JUICEDeposited(msg.sender, amount)`

### `withdraw`

```solidity
/// @notice Withdraws JUICE tokens from the staking contract. Moves `amount` of JUICE from the contract's balance to
/// user's balance.
/// @param amount The withdrawn amount. If it exceeds user's unstaked balance, tx reverts with `InsufficientJUICE` error.
function withdraw(uint amount) external;

/// @notice Emitted on successful withdraw()
/// @param user The user who made the withdraw
/// @param amount The withdrawn JUICE amount
event JUICEWithdrawn(address indexed user, uint amount);
```

**Checks**:
- `!paused()`; otherwise revert with message _"Pausable: paused"_ (OpenZeppelin Pauseable)
- `stakes[msg.sender].unstakedBalance >= amount`; otherwise revert with error `InsufficientJUICE`

**Effects**:
- `stakes[msg.sender].unstakedBalance -= amount`

**Interactions**
- `ERC20(this).transfer(msg.sender, amount)`
- `emit Transfer(this, msg.sender, amount)` (ERC20)
- `emit JUICEWithdrawn(msg.sender, amount)`

### `modifyStakes`


```solidity
/// The parameter object for setting stakes.
struct StakingParam {
    /// The address of the ERC-20 token.
    address token;
    /// The new amount of tokens at stake. Zeroing removes the stake.
    uint128 amount;
    /// True if this is a long position, false if it's a short position.
    bool sentiment;
}

/// @notice Modifies the user's token stakes.
/// @param stakes The array of StakingParams which are processed in order.
function modifyStakes(StakingParam[] calldata stakes) external;

/// @notice Emitted when adding to a staked token amount.
/// @param user The staker
/// @param token The staked token
/// @param sentiment True if this is a long stake.
/// @param price The token price.
/// @param unstakedDiff The unstaked JUICE difference (negative when staking)
event StakeAdded(address indexed user, address indexed token, bool sentiment, uint price, int unstakedDiff);

/// @notice Emitted when unstaking from a token stake.
/// @param user The staker
/// @param token The staked token
/// @param sentiment True if this is a long stake.
/// @param price The token price.
/// @param unstakedDiff The unstaked JUICE difference (positive when unstaking)
event StakeRemoved(address indexed user, address indexed token, bool sentiment, uint price, int unstakedDiff);
```

The `modifyStakes` function determines the individual actions by the following rules:

1. Check `!paused()`; otherwise revert with message _"Pausable: paused"_ (OpenZeppelin Pauseable)
2. For each `stake` in `stakingParams`: `supplyDiff += removeStake(stake.token)`
3. For each `stake` in `stakingParams` if `stakes[msg.sender].tokenStake[stake.token].amount >= 0`: `addStake(stake)`
4. `mintStakingRewards(supplyDiff)`
5. TODO: conditional signal aggregator update

TODO:
- clean up the pseudo-code

#### `function addStake(StakingParam calldata stake) internal`

**Checks**:
- `priceOracles[stake.token] != address(0)`; otherwise revert with error `InvalidToken`
- `stakes[msg.sender].unstakedBalance >= stake.amount`; otherwise limit the staked amount to currently unstaked Juice balance

**Effects**:
- `stakes[msg.sender].unstakedBalance -= stake.amount`
- if `stake.sentiment == true` (long position) then:
  - `stakes[msg.sender].tokenStake[stake.token].juiceBalance -= stake.amount`
  - `stakes[msg.sender].tokenStake[stake.token].amount += (tokenPrice / stake.amount)`
- if `stake.sentiment == false` (short position) then:
    - `stakes[msg.sender].tokenStake[stake.token].juiceBalance += stake.amount`
    - `stakes[msg.sender].tokenStake[stake.token].amount += (tokenPrice / stake.amount)`

**Interactions**
- `tokenPrice = priceOracles[stake.token].latestAnswer()`
- `emit StakeAdded(msg.sender, stake.token, stake.sentiment, tokenPrice, -stake.amount)`

#### `function removeStake(address token) internal returns (int juiceSupplyDiff)`

If `juiceSupplyDiff` is positive, it means that new JUICE will be minted. If it s negative, then JUICE will be burned.

**Checks**:
- `stakes[msg.sender].tokenStake[token].juiceBalance != 0`; otherwise just return 0 to caller
- `priceOracles[token] != address(0)`; otherwise just close the position without price calculations (TODO define this exceptional case better)

**Effects**:
- `uint marketValue = stakes[msg.sender].tokenStake[stake.token].amount * tokenPrice`
- `uint positionJuiceValue = marketValue` (applies on long positions, short position has a loss limit)
- `bool sentiment = stakes[msg.sender].juiceBalance < 0`
- if `sentiment == true` (long position) then:
  - `juiceSupplyDiff = marketValue + stakes[msg.sender].tokenStake[stake.token].juiceBalance`
- if `sentiment == false` (short position) then:
  - `juiceSupplyDiff = stakes[msg.sender].tokenStake[stake.token].juiceBalance - marketValue`
  - `positionJuiceValue = max(0, stakes[msg.sender].tokenStake[stake.token].juiceBalance + juiceSupplyDiff)`
- `stakes[msg.sender].tokenStake[stake.token] = (0, 0)`
- `stakes[msg.sender].unstakedBalance += positionJuiceValue`

**Interactions**
- `tokenPrice = priceOracles[stake.token].latestAnswer()`
- `emit StakeRemoved(msg.sender, token, sentiment, tokenPrice, positionJuiceValue)`

#### `function mintStakingRewards(int supplyDiff) internal`

**Checks**:
- `supplyDiff != 0`; otherwise just return to caller

**Effects**: No effects

**Interactions**
- if `supplyDiff > 0`:
  - `_mint(this, uint(supplyDiff))`
  - `emit Transfer(address(0), this, uint(supplyDiff))` (ERC20)
- if `supplyDiff < 0`:
  - `_burn(this, uint(-supplyDiff))`
  - `emit Transfer(this, address(0), uint(-supplyDiff))` (ERC20)


## Owner operations

The Owner operations are defined in `interfaces/IJuiceOwnerActions.sol`, with following exceptions:

- **upgrade** operations are implemented in OpenZeppelin library (TODO add links)
- **transfer ownership** and **renounce ownership**- operations are inherited from OpenZeppelin `Ownable.sol`

### `updatePriceOracles`

```solidity
/// @notice Authorizes the tokens and their respective price oracles for staking.
/// @param tokens The token addresses.
/// @param oracles The price oracle addresses for the token (i.e. value of `tokens[x]` in a matching array index `x`).
function updatePriceOracles(address[] calldata tokens, IPriceOracle[] calldata oracles) external;

/// @notice Thrown if the owner calls `setPriceOracles` with different sized arrays
error TokenOracleMismatch(uint tokensLength, uint oraclesLength);

/// @notice Thrown if the price oracle has unexpected decimal count
error OracleDecimalMismatch(uint8 expected, uint8 actual);
```

For each `n`th `oracle` in `oracles`:

**Checks**:
- `msg.sender == owner()`; otherwise revert with message _"Ownable: caller is not the owner"_
- `tokens.length == oracles.length`; otherwise revert with `TokenOracleMismatch`
- `oracle.decimals() == 8`; otherwise revert with `OracleDecimalMismatch`

**Effects**:
- `priceOracles[tokens[n]] = oracle`

**Interactions**
- `oracle.decimals()`

### `mintJuice`

```solidity
/// @notice Mints new JUICE for specified recipients.
/// @param recipients The JUICE recipients.
/// @param amounts The minted amounts for the respective recipient (i.e. value of `recipients[x]` in a matching array index `x`).
function mintJuice(address[] calldata recipients, uint[] calldata amounts) external;

/// @notice Thrown if the owner calls `mintJuice` with different sized arrays
error MintTargetMismatch(uint targetLength, uint amountLength);
```

For each `n`th address in `recipients`:

**Checks**:
- `msg.sender == owner()`; otherwise revert with message _"Ownable: caller is not the owner"_
- `recipients.length == amounts.length`; otherwise revert with `MintTargetMismatch`

**Effects**: No effects on Juicenet state.

**Interactions**
- `ERC20(this).mint(recipients[n], amounts[n])`


### `authorizeSignalAggregator`

```solidity
/// @notice Sets the new JUICE signal aggregator.
/// @param aggregator if non-zero, registers the new aggregator address - otherwise unregisters the existing one
function authorizeSignalAggregator(IJuiceSignalAggregator aggregator) external;
```

**Checks**:
- `msg.sender == owner()`; otherwise revert with message _"Ownable: caller is not the owner"_

**Effects**:
- `signalAggregator = aggregator`

**Interactions**: No interactions.

### `aggregateSignal`

```solidity
/// @notice Forces the signal aggregation for given tokens.
/// Intended to be used when a new signal aggregator has been registered with `authorizeSignalAggregator
/// @param tokens The tokens whose signal will be aggregated
function aggregateSignal(address[] calldata tokens) external;
```

**Checks**:
- `msg.sender == owner()`; otherwise revert with message _"Ownable: caller is not the owner"_
- `signalAggregator != address(0)`; otherwise revert

**Effects**: No side effects on Juicenet state

**Interactions**:
- `signalAggregator.updateSignal(aggregatePositions(tokens))` where `aggregatePositions` maps the internal staking data to the correct `TokenSignal` tuples (TODO figure out the optimal data structure for the purpose + document it)

### `emergencyPause`

```solidity
/// @notice Pauses all staking and JUICE ERC-20 activity.
/// @param pauseStaking True if pausing, false if unpausing.
function emergencyPause(bool pauseStaking) external;
```

**Checks**:
- `msg.sender == owner()`; otherwise revert with message _"Ownable: caller is not the owner"_
- `pauseStaking != paused()`; otherwise revert

**Effects**:
- `_paused = pauseStaking` (private bool inherited from OZ's Pausable.sol)

**Interactions**:
- `emit Paused(msg.sender);`


## Staker Delegate Operations

The Staker Delegate operations are defined in `interfaces/IJuiceStakerDelegateActions.sol`.

TODO describe and define:
- EIPs we use
- function signatures
- EIP-712 data structures
- additional pre-conditions vs normal Staker operations

### `delegateDeposit`

### `delegateWithdraw`

### `delegateModifyStakes`

## External contract dependencies

Juicenet needs only two kinds of external contracts to operate properly, Price Oracles and the Signal Aggregators. Both of them are authorized to use in Juicenet by the Owner, so Juicenet will not call any arbitrary external contracts without permission (not even ERC-20s).

### Price Oracles

Price Oracles provide a USD-denominated price quote for computing staking performance. Juicenet supports any on-chain oracle which implements the interface `interfaces/IPriceOracle.sol`:

```solidity
interface IPriceOracle {
  /// @notice Gets the decimals used in `latestAnswer()`.
  function decimals() external view returns (uint8);

  /// @notice Gets the latest price quote.
  /// @dev Intentionally named the same as the Chainlink aggregator interface (https://github.com/smartcontractkit/chainlink/blob/develop/contracts/src/v0.4/interfaces/AggregatorInterface.sol#L4).
  function latestAnswer() external view returns (int256);
}
```

Juicenet supports a single Price Oracle per target asset. The Owner can update `IPriceOracle` implementing contract address for any token by calling [`updatePriceOracles()`](#updatepriceoracles).

### Signal Aggregators
Signal Aggregators are designated to receive real-time information about the Juicenet Signal. Aggregator contract must implement the interface `interfaces/IJuiceSignalAggregator.sol`

```solidity
interface IJuiceSignalAggregator {
    struct TokenSignal {
        /// the long token address
        address longToken;

        /// the token weight percentage
        uint8 longTokenWeight;
    }
    struct AggregateTokenSignal {
        /// the percentage of long positions in signal (`W_{longs}` in whitepaper)
        uint128 totalLongSentiment;

        /// the sum of weighted net sentiments i.e. the total sum of longTokenSignals.longTokenWeight
        /// (for normalizing the token weights)
        uint128 sumWeightedNetSentiment;

        /// new long positions
        TokenSignal[] longTokenSignals;
    }
    /// @notice Updates the aggregated signal.
    /// @param signal The signal data struct.
    function updateSignal(AggregateTokenSignal calldata signal) external;
}
```

Juicenet supports only one Signal Aggregator. The Owner can update the `IJuiceSignalAggregator` implementing contract which Juicenet uses by calling [`authorizeSignalAggregator()`](#authorizesignalaggregator)
