import { Log, Provider, TransactionReceipt } from "@ethersproject/providers"
import { Token } from "@uniswap/sdk-core"
import { FeeAmount, Pool } from "@uniswap/v3-sdk"
import { constants, Contract } from "ethers"
import UniswapV3Pool from "@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json"
import NFTJson
  from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json"
import QuoterJSON from "@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json"
import { LogDescription } from "@ethersproject/abi"

const ROUTER_ADDRESS = "0x72C8B3aA6eD2fF68022691ecD21AEb1517CfAEa6"
const QUOTER_ADDRESS = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6"
export const NFT_ADDRESS = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88"

export const SNAPSHOT_BLOCK = 14442575
export const OVERRIDES = { blockTag: SNAPSHOT_BLOCK }
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
export const ProviderAPI = (provider: Provider) => {
  const VNLRouter = new Contract(ROUTER_ADDRESS, VNLRouterABI, provider)
  const NonfungiblePositionManager = new Contract(NFT_ADDRESS, NFTJson.abi, provider)
  const Quoter = new Contract(QUOTER_ADDRESS, QuoterJSON.abi, provider)

  return {
    fetchUniswapPool: async (tokenA: Token, tokenB: Token, fee: FeeAmount) => {
      let poolContract = new Contract(Pool.getAddress(tokenA, tokenB, fee), UniswapV3Pool.abi, provider)
      let [liquidity, {
        tick,
        sqrtPriceX96,
      }] = await Promise.all([poolContract.liquidity(OVERRIDES), poolContract.slot0(OVERRIDES)])
      let pool = new Pool(tokenA, tokenB, fee, sqrtPriceX96, liquidity.toString(), tick)
      return {
        pool,
        poolContract,
      }
    },
    VNLRouter,
    NonfungiblePositionManager,
    Quoter,
    findNFTMintEvents: (tx: TransactionReceipt) => {
      let nftInterface = NonfungiblePositionManager.interface
      let eventsFromNFT = (x: Log) => x.address === NFT_ADDRESS
      let transfersFromZeroAddress = (x: LogDescription) => x.name === "Transfer" && x.args.from === constants.AddressZero
      return tx.logs.filter(eventsFromNFT).map(x => nftInterface.parseLog(x)).filter(transfersFromZeroAddress)
    },
  }
}
export const WETH = new Token(1, "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 18, "WETH", "Wrapped Ether")
export const USDC = new Token(1, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6, "USDC", "USD Coin")
export const VNL = new Token(1, "0xbf900809f4C73e5a3476eb183d8b06a27e61F8E5", 12, "VNL", "Vanilla")
