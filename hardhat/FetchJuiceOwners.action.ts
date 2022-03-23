import { HardhatRuntimeEnvironment } from "hardhat/types"
import { BigNumber, Contract, utils, Event, constants } from "ethers"
import UniswapV3Pool from "@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json"
import NonfungiblePositionManager
  from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json"
import { FeeAmount, Pool, Position } from "@uniswap/v3-sdk"
import { Token } from "@uniswap/sdk-core"
import Decimal from "decimal.js"
import { IERC20Upgradeable__factory } from "../typechain/juicenet"

function getPositionKey (address: string, lowerTick: number, upperTick: number): string {
  return utils.keccak256(utils.solidityPack(["address", "int24", "int24"], [address, lowerTick, upperTick]))
}

export default async (_: never, { ethers, network }: HardhatRuntimeEnvironment): Promise<void> => {
  const NPM_ADDRESS = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"
  let positionManager = new Contract(NPM_ADDRESS, NonfungiblePositionManager.abi, ethers.provider)

  const WETH = new Token(1, "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 18, "WETH", "Wrapped Ether")
  const USDC = new Token(
    1,
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    6,
    "USDC",
    "USD Coin",
  )
  const VNL = new Token(
    1,
    "0xbf900809f4C73e5a3476eb183d8b06a27e61F8E5",
    12,
    "VNL",
    "Vanilla",
  )

  const fetchUniswapPool = async (tokenA: Token, tokenB: Token, fee: FeeAmount) => {
    let poolContract = new Contract(Pool.getAddress(tokenA, tokenB, fee), UniswapV3Pool.abi, ethers.provider)
    let [liquidity, { tick, sqrtPriceX96 }] = await Promise.all([poolContract.liquidity(), poolContract.slot0()])
    let pool = new Pool(tokenA, tokenB, fee, sqrtPriceX96, liquidity.toString(), tick)
    return { pool, poolContract }
  }

  let usdcVNL = await fetchUniswapPool(USDC, VNL, FeeAmount.HIGH)
  let wethVNL = await fetchUniswapPool(WETH, VNL, FeeAmount.MEDIUM)

  let [usdcEvents, wethEvents] = await Promise.all([
    usdcVNL.poolContract.queryFilter(usdcVNL.poolContract.filters.Mint()),
    wethVNL.poolContract.queryFilter(wethVNL.poolContract.filters.Mint())])

  const fetchVNLLiquidityProviders = async (events: Event[], pool: Pool) => {
    let poolName = `${pool.token0.symbol} / ${pool.token1.symbol} (${new Decimal(pool.fee).div(10000).toString()}%)`
    let vnlFirst = pool.token0.symbol === "VNL"
    let positionData = []
    for (const event of events) {
      let { getTransactionReceipt } = event
      let tx = await getTransactionReceipt()
      // console.log("Tx", tx)

      for (const log of tx.logs.filter(x => x.address === NPM_ADDRESS)) {
        let parsedLog = positionManager.interface.parseLog(log)
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
        } = await positionManager.callStatic.collect({
          tokenId: tokenId,
          recipient: owner,
          amount0Max: BigNumber.from(2).pow(128).sub(1),
          amount1Max: BigNumber.from(2).pow(128).sub(1),
        }, {
          from: owner,
        })
        const position = await positionManager.positions(tokenId)
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
          c: await ethers.provider.getCode(owner).then((code) => code !== "0x"),
        })
      }
    }
    return positionData
  }

  let liquidityPositions = [...await fetchVNLLiquidityProviders(usdcEvents, usdcVNL.pool), ...await fetchVNLLiquidityProviders(wethEvents, wethVNL.pool)]
  console.log("Step 2")
  console.table(liquidityPositions)
  let sumUSDCVNL = liquidityPositions.filter(p => p.poolName.includes("USDC")).reduce((sum, pos) => { return sum.add(pos.vnlTotal) }, new Decimal(0))
  let sumWETHVNL = liquidityPositions.filter(p => p.poolName.includes("WETH")).reduce((sum, pos) => { return sum.add(pos.vnlTotal) }, new Decimal(0))

  const VNL_ADDRESS = "0xbf900809f4C73e5a3476eb183d8b06a27e61F8E5"
  // technically, VanillaV1Token02 contract is not IERC20Upgradeable, but it doesn't matter here since all we need are the Transfer events
  let vnlToken02 = IERC20Upgradeable__factory.connect(VNL_ADDRESS, ethers.provider)

  let usdcVNLBalance = new Decimal((await vnlToken02.balanceOf(usdcVNL.poolContract.address)).toString()).div(10 ** 12)
  console.log("VNL balance of USDC-pool", usdcVNLBalance.toString(), `(diff to aggregate LP sum: ${usdcVNLBalance.sub(sumUSDCVNL).toFixed(12)} VNL)`)
  let wethVNLBalance = new Decimal((await vnlToken02.balanceOf(wethVNL.poolContract.address)).toString()).div(10 ** 12)
  console.log("VNL balance of WETH-pool", wethVNLBalance.toString(), `(diff to aggregate LP sum: ${wethVNLBalance.sub(sumWETHVNL).toFixed(12)} VNL)`)

  const tokenTransfers = await vnlToken02.queryFilter(vnlToken02.filters.Transfer(null, null, null))
  let byBlockIndexOrder = (a: Event, b: Event) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex
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
