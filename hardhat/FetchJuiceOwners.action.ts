import { HardhatRuntimeEnvironment } from "hardhat/types"
import { BigNumber, constants, Event } from "ethers"

import { FeeAmount, Pool, Position } from "@uniswap/v3-sdk"
import Decimal from "decimal.js"
import { IERC20Upgradeable__factory } from "../typechain/juicenet"
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

// resolve all addresses who are directly holding VNL
const step1 = async (provider: Provider) => {
  // technically, VanillaV1Token02 contract is not IERC20Upgradeable, but it doesn't matter here since all we need are the Transfer events
  let vnlToken02 = IERC20Upgradeable__factory.connect(VNL_ADDRESS, provider)

  // let usdcVNLBalance = new Decimal((await vnlToken02.balanceOf(usdcVNL.poolContract.address, OVERRIDES)).toString()).div(10 ** 12)
  // console.log("VNL balance of USDC-pool", usdcVNLBalance.toString(), `(diff to aggregate LP sum: ${usdcVNLBalance.sub(sumUSDCVNL).toFixed(12)} VNL)`)
  // let wethVNLBalance = new Decimal((await vnlToken02.balanceOf(wethVNL.poolContract.address, OVERRIDES)).toString()).div(10 ** 12)
  // console.log("VNL balance of WETH-pool", wethVNLBalance.toString(), `(diff to aggregate LP sum: ${wethVNLBalance.sub(sumWETHVNL).toFixed(12)} VNL)`)

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
  // type HolderData = {amount: bigint, contract: boolean}
  // type Holder = [string, HolderData]
  // let holders: Holder[] = await Promise.all(Object.entries(data.accounts)
  //   .map(([address, amount]) => provider.getCode(address).then((code): Holder => ([address, { amount, contract: code !== "0x" }]))))
  //
  // let newHolders: {receiver: string, amount: bigint}[] = holders
  //   .map(([address, data]) => ({ receiver: address, amount: data.amount }))
}

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

  // let sumUSDCVNL = usdcLPs.reduce((sum, pos) => { return sum.add(pos.vnlTotal) }, new Decimal(0))
  // let sumWETHVNL = wethLPs.reduce((sum, pos) => { return sum.add(pos.vnlTotal) }, new Decimal(0))
}

const step3 = async (provider: Provider) => {
  let { VNLRouter, Quoter } = ProviderAPI(provider)

  let [openings, closings] = await Promise.all([
    VNLRouter.queryFilter(VNLRouter.filters.TokensPurchased(), 0, SNAPSHOT_BLOCK),
    VNLRouter.queryFilter(VNLRouter.filters.TokensSold(), 0, SNAPSHOT_BLOCK)])

  // "event TokensSold( address indexed seller, address indexed token, uint256 amount, uint256 eth, uint256 profit, uint256 reward )",
  //   "event TokensPurchased( address indexed buyer, address indexed token, uint256 eth, uint256 amount )",
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

export default async (_: never, { ethers, network }: HardhatRuntimeEnvironment): Promise<void> => {
  let { fetchUniswapPool, VNLRouter, NonfungiblePositionManager, Quoter, findNFTMintEvents } = ProviderAPI(ethers.provider)

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
  console.log("Total VNL supply", await IERC20Upgradeable__factory.connect(VNL_ADDRESS, ethers.provider).totalSupply(OVERRIDES).then(bn => new Decimal(bn.toString()).div(10 ** 12).toDecimalPlaces(4)))
  console.log("Total amount of airdropped JUICE", new Decimal(totalJUICE.toString()).div(10 ** 12).toDecimalPlaces(8))

  type EthereumAddress = string
  let mapping: Record<EthereumAddress, string> = JSON.parse(await readFile("contracts.json", "utf8"))

  let finalRecipients = allUsers.filter(x => x.eligible).map((x) => {
    if (!x.eoa && mapping[x.user] === undefined) {
      throw new Error(`Contract address ${x.user} not mapped in contracts.json`)
    }
    let user = x.eoa ? x.user : mapping[x.user]
    return { user, total: x.total / (10n ** 4n) }
  }).filter(x => ethers.utils.isAddress(x.user))

  await writeFile("premine.json", JSON.stringify(finalRecipients,
    (key, value) => typeof value === "bigint" ? value.toString() : value,
    4), "utf8")
}
