import { HardhatRuntimeEnvironment } from "hardhat/types"
import { BigNumber, constants, Event } from "ethers"

import { FeeAmount, Pool, Position } from "@uniswap/v3-sdk"
import Decimal from "decimal.js"
import { IERC20__factory } from "../typechain/openzeppelin"
import { SafelistedToken, VanillaTradingSafelist } from "./airdrop-utils/VanillaTradingSafelist"
import { OVERRIDES, ProviderAPI, SNAPSHOT_BLOCK, USDC, VNL, WETH } from "./airdrop-utils"
import { Provider } from "@ethersproject/providers"
import { readFile, writeFile } from "fs/promises"

type IndexableEvent = Event | {blockNumber: number, logIndex: number}
let byBlockIndexOrder = (a: IndexableEvent, b: IndexableEvent) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex

const VNL_ADDRESS = "0xbf900809f4C73e5a3476eb183d8b06a27e61F8E5"
type SnapshotState = {
  blockNumber: number,
  accounts: Record<string, bigint>
}

// following the steps described in https://community.vanilladefi.com/t/proposal-vanilla-mainnet-juice-airdrop-addresses/62

// resolve all addresses who are directly holding VNL
const step1 = async (provider: Provider) => {
  let vnlToken02 = IERC20__factory.connect(VNL_ADDRESS, provider)

  const tokenTransfers = await vnlToken02.queryFilter(vnlToken02.filters.Transfer(null, null, null), 0, SNAPSHOT_BLOCK)

  let transfers = tokenTransfers
    .sort(byBlockIndexOrder)
    .map(({ blockNumber, args }) => ({ blockNumber, ...args }))

  const toSnapshotState = (state: SnapshotState, event: { blockNumber: number, from: string, to:string, value:BigNumber }) => {
    let valueBn = BigInt(event.value.toString())
    let prev = state.accounts[event.to] || 0n
    state.accounts[event.to] = prev + valueBn

    if (event.from !== constants.AddressZero) {
      if (!state.accounts[event.from]) {
        if (event.value.gt(0)) { throw new Error(`something went wrong in ${event.blockNumber} from=${event.from} value=${event.value}`) }
        state.accounts[event.from] = 0n
      }
      prev = state.accounts[event.from]
      state.accounts[event.from] = prev - valueBn
      if (state.accounts[event.from] === 0n) {
        delete state.accounts[event.from]
      }
    }
    state.blockNumber = Math.max(event.blockNumber, state.blockNumber || 0)
    return state
  }

  let data: SnapshotState = transfers.reduce(toSnapshotState, { blockNumber: 0, accounts: {} })
  return data
}

// Resolve all addresses providing liquidity for VNL and resolve their pro rata VNL ownership in each liquidity pool.
const step2 = async (provider: Provider) => {
  let { fetchUniswapPool, NonfungiblePositionManager, findNFTMintEvents } = ProviderAPI(provider)

  let usdcVNL = await fetchUniswapPool(USDC, VNL, FeeAmount.HIGH)
  let wethVNL = await fetchUniswapPool(WETH, VNL, FeeAmount.MEDIUM)

  let [usdcEvents, wethEvents] = await Promise.all([
    usdcVNL.poolContract.queryFilter(usdcVNL.poolContract.filters.Mint(), 0, SNAPSHOT_BLOCK),
    wethVNL.poolContract.queryFilter(wethVNL.poolContract.filters.Mint(), 0, SNAPSHOT_BLOCK)])

  const fetchVNLLiquidityProviders = async (events: Event[], pool: Pool) => {
    let poolName = `${pool.token0.symbol} / ${pool.token1.symbol} (${new Decimal(pool.fee).div(10000).toString()}%)`
    let vnlFirst = pool.token0.symbol === "VNL"
    let positionData = []
    for (const event of events) {
      let { getTransactionReceipt } = event
      let tx = await getTransactionReceipt()

      for (const { args } of findNFTMintEvents(tx)) {
        let { tokenId, from, to: owner } = args
        const { amount0: fee0, amount1: fee1 } = await NonfungiblePositionManager.callStatic.collect({
          tokenId: tokenId,
          recipient: owner,
          amount0Max: BigNumber.from(2).pow(128).sub(1),
          amount1Max: BigNumber.from(2).pow(128).sub(1),
        }, { from: owner, blockTag: SNAPSHOT_BLOCK })
        const position = await NonfungiblePositionManager.positions(tokenId, OVERRIDES)
        let { liquidity, tickLower, tickUpper } = position
        let poolPosition = new Position({
          pool,
          liquidity: liquidity.toString(),
          tickLower,
          tickUpper,
        })
        let { amount0, amount1 } = poolPosition.mintAmounts
        let vnlTotal = vnlFirst
          ? BigInt(fee0.toString()) + BigInt(amount0.toString())
          : BigInt(fee1.toString()) + BigInt(amount1.toString())

        positionData.push({
          owner,
          poolName,
          vnlTotal: vnlTotal,
        })
      }
    }
    return positionData
  }

  let [usdcLPs, wethLPs] = await Promise.all([fetchVNLLiquidityProviders(usdcEvents, usdcVNL.pool), fetchVNLLiquidityProviders(wethEvents, wethVNL.pool)])

  const toSnapshotState = (state: SnapshotState, event: { owner: string, vnlTotal: bigint }) => {
    let prev = state.accounts[event.owner] || 0n
    state.accounts[event.owner] = prev + event.vnlTotal
    return state
  }
  return [...usdcLPs, ...wethLPs].reduce(toSnapshotState, { blockNumber: SNAPSHOT_BLOCK, accounts: {} })
}

// Resolve all addresses that profit-mine, and calculate how much VNL they would get if they closed their positions at the snapshot block.
const step3 = async (provider: Provider) => {
  let { VNLRouter, Quoter } = ProviderAPI(provider)

  let [openings, closings] = await Promise.all([
    VNLRouter.queryFilter(VNLRouter.filters.TokensPurchased(), 0, SNAPSHOT_BLOCK),
    VNLRouter.queryFilter(VNLRouter.filters.TokensSold(), 0, SNAPSHOT_BLOCK)])

  type Trade = {blockNumber: number, logIndex: number, owner: string, token: string, amount: BigNumber}
  let trades: Trade[] = [
    ...openings.map(({ blockNumber, logIndex, args }) => ({ blockNumber, logIndex, owner: args?.buyer, token: args?.token, amount: args?.amount })),
    ...closings.map(({ blockNumber, logIndex, args }) => ({ blockNumber, logIndex, owner: args?.seller, token: args?.token, amount: BigNumber.from(0).sub(BigNumber.from(args?.amount)) })),
  ].sort(byBlockIndexOrder)

  type Token = string
  type PositionState = {
    blockNumber: number,
    positions: Record<Token, Record<string, bigint>>
  }
  const toPositionState = (state: PositionState, event: Trade) => {
    let valueBn = BigInt(event.amount.toString())
    let positions = state.positions[event.token] || {}
    let prev = positions[event.owner] || 0n
    if (prev + valueBn > 0n) {
      positions[event.owner] = prev + valueBn
      state.positions[event.token] = positions
    } else {
      delete state.positions[event.token][event.owner]
    }
    state.blockNumber = Math.max(event.blockNumber, state.blockNumber || 0)
    return state
  }

  let currentPositions: PositionState = trades.reduce(toPositionState, { blockNumber: 0, positions: {} })

  let positionData = []
  const selectReward = (token: SafelistedToken) => (estimate: any) => {
    switch (token.fee) {
      case FeeAmount.LOWEST: throw new Error("Unsupported fee amount")
      case FeeAmount.LOW: return BigNumber.from(estimate.low.reward)
      case FeeAmount.MEDIUM: return BigNumber.from(estimate.medium.reward)
      case FeeAmount.HIGH: return BigNumber.from(estimate.high.reward)
    }
  }
  const snapshot: SnapshotState = { blockNumber: SNAPSHOT_BLOCK, accounts: {} }
  for (const [token, pos] of Object.entries(currentPositions.positions)) {
    let safeListedToken = VanillaTradingSafelist.find((a) => a.address.toLowerCase() === token.toLowerCase())
    if (!safeListedToken) {
      console.log("Position in unsafe token!")
      continue
    }

    let rewardFrom = selectReward(safeListedToken)
    for (const [user, amount] of Object.entries(pos)) {
      let amountOut = await Quoter.callStatic.quoteExactInputSingle(token, WETH.address, safeListedToken.fee, amount, 0, OVERRIDES)

      let { estimate } = await VNLRouter.estimateReward(user, token, amountOut, amount, OVERRIDES)

      let reward = rewardFrom(estimate)
      let prev = snapshot.accounts[user] || 0n
      snapshot.accounts[user] = prev + BigInt(reward.toString())
    }
  }
  return snapshot
}

export default async (_: never, { ethers }: HardhatRuntimeEnvironment): Promise<void> => {
  console.log("Step 1: direct VNL balance")
  let directHodlers: SnapshotState = await step1(ethers.provider)
  console.table(directHodlers.accounts)

  console.log("Step 2: LP's share in the Uniswap")
  let liquidityProviders: SnapshotState = await step2(ethers.provider)
  console.table(liquidityProviders.accounts)

  console.log("Step 3: Unrealized VNL in open Vanilla positions")
  let profitMiners: SnapshotState = await step3(ethers.provider)
  console.table(profitMiners.accounts)

  type Sums = {s1: bigint, s2: bigint, s3: bigint, total: bigint}
  let allUserAddresses = [...new Set([...Object.keys(directHodlers.accounts), ...Object.keys(liquidityProviders.accounts), ...Object.keys(profitMiners.accounts)])]
  let eoas = Object.fromEntries(await Promise.all(allUserAddresses.map(address => ethers.provider.getCode(address).then(code => [address, code === "0x"]))))
  let pools = [Pool.getAddress(WETH, VNL, FeeAmount.MEDIUM), Pool.getAddress(USDC, VNL, FeeAmount.HIGH)]
  let allUsers = allUserAddresses.map((user) => {
    let s1 = directHodlers.accounts[user] || 0n
    let s2 = liquidityProviders.accounts[user] || 0n
    let s3 = profitMiners.accounts[user] || 0n
    let total = s1 + s2 + s3
    let eoa = eoas[user]

    let isUniswapPool = pools.includes(user)
    let eligible = !isUniswapPool
    return { user, eoa, eligible, s1, s2, s3, total }
  }).filter(({ total }) => total > 0n)
  const prettierOutput = ({ user, eoa, eligible, s1, s2, s3, total }: {user: string, eoa: boolean, eligible: boolean, s1: bigint, s2: bigint, s3: bigint, total: bigint}) => {
    return {
      user: user.substring(0, 6) + "..." + user.substring(38),
      eoa,
      eligible,
      s1: new Decimal(s1.toString()).div(10 ** 12).toFixed(4),
      s2: new Decimal(s2.toString()).div(10 ** 12).toFixed(4),
      s3: new Decimal(s3.toString()).div(10 ** 12).toFixed(4),
      total: new Decimal(total.toString()).div(10 ** 12).toFixed(8),
    }
  }

  console.table(allUsers.sort((a, b) => Number(b.total - a.total)).map(prettierOutput))
  let totalJUICE = allUsers.filter(({ eligible }) => eligible).reduce((sum, val) => { sum += val.total; return sum }, 0n)
  console.log("Total VNL supply", await IERC20__factory.connect(VNL_ADDRESS, ethers.provider).totalSupply(OVERRIDES).then(bn => new Decimal(bn.toString()).div(10 ** 12).toDecimalPlaces(4)))
  console.log("Total amount of airdropped JUICE", new Decimal(totalJUICE.toString()).div(10 ** 12).toDecimalPlaces(8))

  type EthereumAddress = string
  let mapping: Record<EthereumAddress, string> = JSON.parse(await readFile("contracts.json", "utf8"))

  console.log("Step 4: resolve all contract addresses that either hold VNL directly or provide liquidity or profit-mine and map them to Polygon addresses")
  console.table(mapping)

  let allRecipients = allUsers
    .filter(x => x.eligible)
    .map((x) => {
      // make sure that all non-EOAs are included in the contracts.json (even if we don't know the mapped address)
      if (!x.eoa && mapping[x.user] === undefined) {
        throw new Error(`Contract address ${x.user} not mapped in contracts.json`)
      }
      let user = x.eoa ? x.user : mapping[x.user]
      return { user, total: x.total }
    })
    .filter(x => ethers.utils.isAddress(x.user)) // we exclude the contract address mappings that are not known (empty strings in contracts.json)

  // finally, make sure that recipient get right JUICE amounts (as JUICE has 8 decimals but VNL has 12)
  let finalRecipients = allRecipients
    .map(({ user, total }) => ({
      user,
      total: total / (10n ** 4n),
    }))

  await writeFile("premine.json", JSON.stringify(finalRecipients,
    (key, value) => typeof value === "bigint" ? value.toString() : value,
    4), "utf8")
}
