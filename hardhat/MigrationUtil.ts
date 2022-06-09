import { JuiceStaking01 } from "../typechain/juicenet"
import { SNAPSHOT_BLOCK } from "./airdrop-utils"
import { BigNumber, constants, Contract, Event } from "ethers"
import { TypedEventFilter } from "../typechain/juicenet/common"
import { TypedEvent } from "@typechain/ethers-v5/static/common"
import { Result } from "@ethersproject/abi"

type EventData = { blockNumber: number, logIndex: number }
type IndexableEvent = Event | EventData
const byBlockIndexOrder = (a: IndexableEvent, b: IndexableEvent) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex
type Position = {
  amount: bigint,
  sentiment: boolean
}
type UserAccount = {
  unstaked: bigint
  tokenPositions: Record<string, Position>
}
type SnapshotState = {
  blockNumber: number
  accounts: Record<string, UserAccount>
}

export const ReadStakePositions01 = async (staking01: JuiceStaking01) => {
  const stakingEvents = (await Promise.all([
    staking01.queryFilter(staking01.filters.StakeRemoved()),
    staking01.queryFilter(staking01.filters.StakeAdded())])).flat()
  const depositEvents = (await Promise.all([
    staking01.queryFilter(staking01.filters.JUICEDeposited()),
    staking01.queryFilter(staking01.filters.JUICEWithdrawn())])).flat()
  type StakeEvent = {
    user: string
    token: string
    sentiment: boolean
    unstakedDiff: BigNumber
  }
  type Balances = {
    user: string
    amount: BigNumber
  }
  type AccountChange = { blockNumber: number, logIndex: number, user: string, token?: string, amount: bigint, sentiment?: boolean }
  let stakings: AccountChange[] = stakingEvents
    .map(({ blockNumber, logIndex, args }: EventData & {args: StakeEvent}) => ({
      blockNumber, logIndex, user: args.user, token: args.token, amount: BigInt(args.unstakedDiff.toString()), sentiment: args.sentiment,
    }))
  let deposits: AccountChange[] = depositEvents
    .map(({ blockNumber, logIndex, args }: EventData & {args: Balances}) => ({
      blockNumber, logIndex, user: args.user, amount: BigInt(args.amount.toString()),
    }))

  const toSnapshotState = (state: SnapshotState, { user, token, sentiment, amount }: AccountChange) => {
    let account = state.accounts[user]
    if (!account) {
      account = (state.accounts[user] = {
        unstaked: 0n,
        tokenPositions: {},
      })
    }
    account.unstaked += amount
    if (token) {
      sentiment = sentiment || false
      let tokenPosition = account.tokenPositions[token]
      if (!tokenPosition) {
        tokenPosition = (account.tokenPositions[token] = { amount: 0n, sentiment: false })
      }
      tokenPosition.amount -= amount
      tokenPosition.sentiment = sentiment
      if (tokenPosition.amount === 0n) {
        delete account.tokenPositions[token]
      }
    }
    if (account.unstaked === 0n && Object.keys(account.tokenPositions).length === 0) {
      delete state.accounts[user]
    }
    return state
  }

  let data: SnapshotState = [...stakings, ...deposits].sort(byBlockIndexOrder).reduce(toSnapshotState, { blockNumber: 0, accounts: {} })
  return data
}
