import { HardhatRuntimeEnvironment } from "hardhat/types"
import { BigNumber, Contract, utils, Event, constants, Signer } from "ethers"
import UniswapV3Pool from "@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json"
import NFTJson from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json"

import { FeeAmount, Pool, Position, SwapQuoter } from "@uniswap/v3-sdk"
import { Token } from "@uniswap/sdk-core"
import Decimal from "decimal.js"
import { IERC20Upgradeable__factory } from "../typechain/juicenet"
import { Provider } from "@ethersproject/providers"
import QuoterJSON from "@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json"
import { Quoter } from "@uniswap/v3-periphery/typechain/Quoter"

const SafeListedTokens = [
  {
    chainId: 1,
    address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
    name: "Wrapped BTC",
    symbol: "BTC",
    decimals: 8,
    pool: "0xcbcdf9626bc03e24f779434178a73a0b4bad62ed",
    fee: 3000,
  },
  {
    chainId: 1,
    address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
    name: "Uniswap",
    symbol: "UNI",
    decimals: 18,
    pool: "0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801",
    fee: 3000,
  },
  {
    chainId: 1,
    address: "0x514910771af9ca656af840dff83e8264ecf986ca",
    name: "ChainLink Token",
    symbol: "LINK",
    decimals: 18,
    pool: "0xa6cc3c2531fdaa6ae1a3ca84c2855806728693e8",
    fee: 3000,
  },
  {
    chainId: 1,
    address: "0xaaaebe6fe48e54f431b0c390cfaf0b017d09d42d",
    name: "Celsius",
    symbol: "CEL",
    decimals: 4,
    pool: "0x06729eb2424da47898f935267bd4a62940de5105",
    fee: 3000,
  },
  {
    chainId: 1,
    address: "0xbC396689893D065F41bc2C6EcbeE5e0085233447",
    name: "Perpetual",
    symbol: "PERP",
    decimals: 18,
    pool: "0xcd83055557536eff25fd0eafbc56e74a1b4260b3",
    fee: 3000,
  },
  {
    chainId: 1,
    address: "0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2",
    name: "Maker",
    symbol: "MKR",
    decimals: 18,
    pool: "0xe8c6c9227491c0a8156a0106a0204d881bb7e531",
    fee: 3000,
  },
  {
    chainId: 1,
    address: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE",
    name: "Shiba Inu",
    symbol: "SHIB",
    decimals: 18,
    pool: "0x5764a6f2212d502bc5970f9f129ffcd61e5d7563",
    fee: 10000,
  },
  {
    chainId: 1,
    address: "0xc7283b66eb1eb5fb86327f08e1b5816b0720212b",
    name: "Tribe",
    symbol: "TRIBE",
    decimals: 18,
    pool: "0xf87bb87fd9ea1c260ddf77b9c707ad9437ff8364",
    fee: 3000,
  },
  {
    chainId: 1,
    address: "0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0",
    name: "Matic Token",
    symbol: "MATIC",
    decimals: 18,
    pool: "0x290a6a7460b308ee3f19023d2d00de604bcf5b42",
    fee: 3000,
  },
  {
    chainId: 1,
    address: "0xd0660cd418a64a1d44e9214ad8e459324d8157f1",
    name: "Woofy",
    symbol: "WOOFY",
    decimals: 12,
    pool: "0x11a38dbd302a30e52c54bb348d8fe662307ff24c",
    fee: 10000,
  },
  {
    chainId: 1,
    address: "0xde30da39c46104798bb5aa3fe8b9e0e1f348163f",
    name: "Gitcoin",
    symbol: "GTC",
    decimals: 18,
    pool: "0x06b1655b9d560de112759b4f0bf57d6f005e72fe",
    fee: 10000,
  },
  {
    chainId: 1,
    address: "0x18aAA7115705e8be94bfFEBDE57Af9BFc265B998",
    name: "Audius",
    symbol: "AUDIO",
    decimals: 18,
    pool: "0x8ecc2244e67d0bb6a1850b1db825e25354cf881a",
    fee: 3000,
  },
  {
    chainId: 1,
    address: "0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e",
    name: "yearn.finance",
    symbol: "YFI",
    decimals: 18,
    pool: "0x04916039b1f59d9745bf6e0a21f191d1e0a84287",
    fee: 3000,
  },
  {
    chainId: 1,
    address: "0xb4efd85c19999d84251304bda99e90b92300bd93",
    name: "Rocket Pool",
    symbol: "RPL",
    decimals: 18,

    pool: "0x632e675672f2657f227da8d9bb3fe9177838e726",
    fee: 3000,
  },
  {
    chainId: 1,
    address: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9",
    name: "Aave Token",
    symbol: "AAVE",
    decimals: 18,
    pool: "0x5ab53ee1d50eef2c1dd3d5402789cd27bb52c1bb",
    fee: 3000,
  },
  {
    chainId: 1,
    address: "0x1494ca1f11d487c2bbe4543e90080aeba4ba3c2b",
    name: "DefiPulse Index",
    symbol: "DPI",
    decimals: 18,
    pool: "0x9359c87b38dd25192c5f2b07b351ac91c90e6ca7",
    fee: 3000,
  },
  {
    chainId: 1,
    address: "0x6c28AeF8977c9B773996d0e8376d2EE379446F2f",
    name: "QuickSwap",
    symbol: "QUICK",
    decimals: 18,
    pool: "0xaf1291730f716e13791d3bd837c7c31111a01778",
    fee: 10000,
  },
  {
    chainId: 1,
    address: "0x6b3595068778dd592e39a122f4f5a5cf09c90fe2",
    name: "Sushi Token",
    symbol: "SUSHI",
    decimals: 18,
    pool: "0x73a6a761fe483ba19debb8f56ac5bbf14c0cdad1",
    fee: 3000,
  },
  {
    chainId: 1,
    address: "0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f",
    name: "Synthetix Network Token",
    symbol: "SNX",
    decimals: 18,
    pool: "0xede8dd046586d22625ae7ff2708f879ef7bdb8cf",
    fee: 3000,
  },
  {
    chainId: 1,
    address: "0x6c6ee5e31d828de241282b9606c8e98ea48526e2",
    name: "HoloToken",
    symbol: "HOT",
    decimals: 18,
    pool: "0xf7849d0852fc588210b9c0d8b26f43c0c9bc1470",
    fee: 10000,
  },
  {
    chainId: 1,
    address: "0x0d438f3b5175bebc262bf23753c1e53d03432bde",
    name: "Wrapped NXM",
    symbol: "wNXM",
    decimals: 18,
    pool: "0x058d79a4c6eb5b11d0248993ffa1faa168ddd3c0",
    fee: 10000,
  },
  {
    chainId: 1,
    address: "0x7DD9c5Cba05E151C895FDe1CF355C9A1D5DA6429",
    name: "Golem Network Token",
    symbol: "GLM",
    decimals: 18,
    pool: "0xfe4ec8f377be9e1e95a49d4e0d20f52d07b1ff0d",
    fee: 3000,
  },
  {
    chainId: 1,
    address: "0x967da4048cD07aB37855c090aAF366e4ce1b9F48",
    name: "Ocean Token",
    symbol: "OCEAN",
    decimals: 18,
    pool: "0x283e2e83b7f3e297c4b7c02114ab0196b001a109",
    fee: 3000,
  },
  {
    chainId: 1,
    address: "0x1f573d6fb3f13d689ff844b4ce37794d79a7ff1c",
    name: "Bancor",
    symbol: "BNT",
    decimals: 18,
    pool: "0x35815d67f717e7bce9cc8519bdc80323ecf7d260",
    fee: 3000,
  },
  {
    chainId: 1,
    address: "0xc00e94cb662c3520282e6f5717214004a7f26888",
    name: "Compound",
    symbol: "COMP",
    decimals: 18,
    pool: "0xea4ba4ce14fdd287f380b55419b1c5b6c3f22ab6",
    fee: 3000,
  },
  {
    chainId: 1,
    address: "0x111111111117dc0aa78b770fa6a738034120c302",
    name: "1INCH Token",
    symbol: "1INCH",
    decimals: 18,
    pool: "0xd35efae4097d005720608eaf37e42a5936c94b44",
    fee: 3000,
  },
]

function getPositionKey (address: string, lowerTick: number, upperTick: number): string {
  return utils.keccak256(utils.solidityPack(["address", "int24", "int24"], [address, lowerTick, upperTick]))
}

const NFT_ADDRESS = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"
const WETH = new Token(1, "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 18, "WETH", "Wrapped Ether")
const USDC = new Token(1, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6, "USDC", "USD Coin")
const VNL = new Token(1, "0xbf900809f4C73e5a3476eb183d8b06a27e61F8E5", 12, "VNL", "Vanilla")
const SNAPSHOT_BLOCK = 14442575
const OVERRIDES = { blockTag: SNAPSHOT_BLOCK }
const VNLRouterABI = [
  "event TokensSold( address indexed seller, address indexed token, uint256 amount, uint256 eth, uint256 profit, uint256 reward )",
  "event TokensPurchased( address indexed buyer, address indexed token, uint256 eth, uint256 amount )",
  `function estimateReward(address owner, address token, uint256 numEth, uint256 numTokensSold) view returns (tuple(
    uint256 avgBlock,
    uint256 htrs,
    tuple(
      tuple(uint256 price, uint256 twapPeriodInSeconds, uint256 profitablePrice, uint256 maxProfitablePrice, uint256 rewardableProfit, uint256 reward) low,
      tuple(uint256 price, uint256 twapPeriodInSeconds, uint256 profitablePrice, uint256 maxProfitablePrice, uint256 rewardableProfit, uint256 reward) medium,
      tuple(uint256 price, uint256 twapPeriodInSeconds, uint256 profitablePrice, uint256 maxProfitablePrice, uint256 rewardableProfit, uint256 reward) high,
    ) estimate)
  )
  `,
]
type IndexableEvent = Event | {blockNumber: number, logIndex: number}
let byBlockIndexOrder = (a: IndexableEvent, b: IndexableEvent) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex

const ROUTER_ADDRESS = "0x72C8B3aA6eD2fF68022691ecD21AEb1517CfAEa6"
const QUOTER_ADDRESS = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6"
const ProviderAPI = (provider: Provider) => ({
  fetchUniswapPool: async (tokenA: Token, tokenB: Token, fee: FeeAmount) => {
    let poolContract = new Contract(Pool.getAddress(tokenA, tokenB, fee), UniswapV3Pool.abi, provider)
    let [liquidity, { tick, sqrtPriceX96 }] = await Promise.all([poolContract.liquidity(OVERRIDES), poolContract.slot0(OVERRIDES)])
    let pool = new Pool(tokenA, tokenB, fee, sqrtPriceX96, liquidity.toString(), tick)
    return { pool, poolContract }
  },
  VNLRouter: new Contract(ROUTER_ADDRESS, VNLRouterABI, provider),
  NonfungiblePositionManager: new Contract(NFT_ADDRESS, NFTJson.abi, provider),
  Quoter: new Contract(QUOTER_ADDRESS, QuoterJSON.abi, provider),
})

export default async (_: never, { ethers, network }: HardhatRuntimeEnvironment): Promise<void> => {
  let { fetchUniswapPool, VNLRouter, NonfungiblePositionManager, Quoter } = ProviderAPI(ethers.provider)

  let usdcVNL = await fetchUniswapPool(USDC, VNL, FeeAmount.HIGH)
  let wethVNL = await fetchUniswapPool(WETH, VNL, FeeAmount.MEDIUM)

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

  type UserState = {
    blockNumber: number,
    users: Record<string, Record<string, bigint>>
  }
  const toUserState = (state: UserState, event: Trade) => {
    let valueBn = BigInt(event.amount.toString())
    let positions = state.users[event.token] || {}
    let prev = positions[event.owner] || 0n
    if (prev + valueBn > 0n) {
      positions[event.owner] = prev + valueBn
      state.users[event.token] = positions
    } else {
      delete state.users[event.token][event.owner]
    }
    state.blockNumber = Math.max(event.blockNumber, state.blockNumber || 0)
    return state
  }

  let currentPositions: UserState = trades.reduce(toUserState, { blockNumber: 0, users: {} })

  let positionData = []
  for (const [token, pos] of Object.entries(currentPositions.users)) {
    let safeListedToken = SafeListedTokens.find((a) => a.address.toLowerCase() === token.toLowerCase())
    if (!safeListedToken) {
      console.log("Position in unsafe token!")
      continue
    }

    for (const [user, amount] of Object.entries(pos)) {
      let amountOut = await Quoter.callStatic.quoteExactInputSingle(token, WETH.address, safeListedToken.fee, amount, 0, OVERRIDES)
      console.log("Position for", user, token, amountOut.toString())
      let { estimate } = await VNLRouter.estimateReward(user, token, amountOut, amount, OVERRIDES)

      let reward = safeListedToken.fee === FeeAmount.LOW ? estimate.low.reward : (safeListedToken.fee === FeeAmount.MEDIUM ? estimate.medium.reward : (safeListedToken.fee === FeeAmount.HIGH ? estimate.high.reward : undefined))
      if (reward === undefined) {
        console.log("Somethings wrong")
        continue
      }

      positionData.push({ user, token, pool: `${safeListedToken.symbol} / WETH (${new Decimal(safeListedToken.fee).div(10000).toString()}%)`, reward: new Decimal(reward.toString()).div(10 ** 12) })
    }
  }
  console.table(positionData.sort((a: {user: string, token: string}, b: typeof a) => a.user.localeCompare(b.user) || a.token.localeCompare(b.token)))

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
      // console.log("Tx", tx)

      for (const log of tx.logs.filter(x => x.address === NFT_ADDRESS)) {
        let parsedLog = NonfungiblePositionManager.interface.parseLog(log)
        if (parsedLog.name !== "Transfer" && parsedLog.args.from !== constants.AddressZero) {
          // console.log("Wrong event", parsedLog)
          continue
        }
        let { args } = parsedLog
        let {
          tokenId,
          from,
          to: owner,
        } = args
        // console.log("TokenId", from, owner, tokenId.toString())
        const {
          amount0: fee0,
          amount1: fee1,
        } = await NonfungiblePositionManager.callStatic.collect({
          tokenId: tokenId,
          recipient: owner,
          amount0Max: BigNumber.from(2).pow(128).sub(1),
          amount1Max: BigNumber.from(2).pow(128).sub(1),
        }, {
          from: owner,
          blockTag: SNAPSHOT_BLOCK,
        })
        const position = await NonfungiblePositionManager.positions(tokenId, OVERRIDES)
        let {
          liquidity,
          tickLower,
          tickUpper,
        } = position
        let poolPosition = new Position({
          pool,
          liquidity: liquidity.toString(),
          tickLower,
          tickUpper,
        })
        let {
          amount0,
          amount1,
        } = poolPosition.mintAmounts
        // console.log("Fees", fee0.toString(), fee1.toString())
        // console.log("Liquidity", amount0.toString(), amount1.toString())
        let vnlTotal = vnlFirst
          ? BigInt(fee0.toString()) + BigInt(amount0.toString())
          : BigInt(fee1.toString()) + BigInt(amount1.toString())

        // console.log("VNL", new Decimal(vnlTotal.toString()).div(10 ** 12).toFixed(12))
        positionData.push({
          owner,
          poolName,
          vnlTotal: new Decimal(vnlTotal.toString()).div(10 ** 12).toFixed(12),
          c: await ethers.provider.getCode(owner, SNAPSHOT_BLOCK).then((code) => code !== "0x"),
        })
      }
    }
    return positionData
  }

  let [usdcLPs, wethLPs] = await Promise.all([fetchVNLLiquidityProviders(usdcEvents, usdcVNL.pool), fetchVNLLiquidityProviders(wethEvents, wethVNL.pool)])
  console.log("Step 2")
  console.table([...usdcLPs, ...wethLPs])
  let sumUSDCVNL = usdcLPs.reduce((sum, pos) => { return sum.add(pos.vnlTotal) }, new Decimal(0))
  let sumWETHVNL = wethLPs.reduce((sum, pos) => { return sum.add(pos.vnlTotal) }, new Decimal(0))

  const VNL_ADDRESS = "0xbf900809f4C73e5a3476eb183d8b06a27e61F8E5"
  // technically, VanillaV1Token02 contract is not IERC20Upgradeable, but it doesn't matter here since all we need are the Transfer events
  let vnlToken02 = IERC20Upgradeable__factory.connect(VNL_ADDRESS, ethers.provider)

  let usdcVNLBalance = new Decimal((await vnlToken02.balanceOf(usdcVNL.poolContract.address, OVERRIDES)).toString()).div(10 ** 12)
  console.log("VNL balance of USDC-pool", usdcVNLBalance.toString(), `(diff to aggregate LP sum: ${usdcVNLBalance.sub(sumUSDCVNL).toFixed(12)} VNL)`)
  let wethVNLBalance = new Decimal((await vnlToken02.balanceOf(wethVNL.poolContract.address, OVERRIDES)).toString()).div(10 ** 12)
  console.log("VNL balance of WETH-pool", wethVNLBalance.toString(), `(diff to aggregate LP sum: ${wethVNLBalance.sub(sumWETHVNL).toFixed(12)} VNL)`)

  const tokenTransfers = await vnlToken02.queryFilter(vnlToken02.filters.Transfer(null, null, null), 0, SNAPSHOT_BLOCK)

  let transfers = tokenTransfers
    .sort(byBlockIndexOrder)
    .map(({ blockNumber, args }) => ({ blockNumber, ...args }))

  type SnapshotState = {
    blockNumber: number,
    accounts: Record<string, bigint>
  }

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
  type HolderData = {amount: bigint, contract: boolean}
  type Holder = [string, HolderData]
  let holders: Holder[] = await Promise.all(Object.entries(data.accounts)
    .map(([address, amount]) => ethers.provider.getCode(address).then((code): Holder => ([address, { amount, contract: code !== "0x" }]))))

  let newHolders: {receiver: string, amount: bigint}[] = holders
    .sort(([a1, b1], [a2, b2]) => Number(b1.amount - b2.amount))
    .map(([address, data]) => ({ receiver: address, amount: data.amount / (10n ** 4n), c: data.contract }))

  // await writeFile("premine.json", JSON.stringify(newHolders,
  //   (key, value) => typeof value === "bigint" ? value.toString() : value,
  //   4), "utf8")
  console.log("Step 1")
  console.table(newHolders)
  console.log(`Block ${data.blockNumber}, holder count ${Object.keys(data.accounts).length}, wrote to premine.json`)
}
