import { HardhatRuntimeEnvironment } from "hardhat/types"
import { JuiceStaking01__factory } from "../typechain/juicenet"
import { readFile } from "fs/promises"
import { SafeLedgerSigner } from "./SignerUtil"
import { IERC20Metadata__factory } from "../typechain/openzeppelin"
import { BigNumber, Contract } from "ethers"

export default async (_: never, hre: HardhatRuntimeEnvironment): Promise<void> => {
  const { ethers, network } = hre
  const { get } = hre.deployments

  type TokenFeed = {token: string, feed: string}
  let tokenFeeds: TokenFeed[] = JSON.parse(await readFile(`deployments/${network.name}/token-feeds.json`, "utf8"))

  const pricefeedABI = [
    "function decimals() view returns (uint8)",
    "function description() view returns (string)",
  ]

  let errors = []
  for (const tokenFeed of tokenFeeds) {
    if (tokenFeed.feed === "0x0") {
      tokenFeed.feed = ethers.constants.AddressZero
      continue
    }
    if (!ethers.utils.isAddress(tokenFeed.feed)) {
      errors.push(`Invalid feed in tokenFeed '${tokenFeed.feed}'`)
      continue
    }
    if (!ethers.utils.isAddress(tokenFeed.token)) {
      errors.push(`Invalid token in tokenFeed '${tokenFeed.token}'`)
      continue
    }
    let metadata = IERC20Metadata__factory.connect(tokenFeed.token, ethers.provider)
    let priceFeed = new Contract(tokenFeed.feed, pricefeedABI, ethers.provider)

    let [decimals, desc, symbol]: [number, string, string] = await Promise.all([priceFeed.decimals(), priceFeed.description(), metadata.symbol()])
    if (decimals !== 8) {
      errors.push(`Wrong decimal (${decimals}) (feed ${tokenFeed.feed})`)
    }
    if (!desc.endsWith("USD")) {
      errors.push(`Not an USD feed (${desc} - ${tokenFeed.feed})`)
    } else {
      let symbolFromDesc = desc.substring(0, desc.indexOf(" / USD"))
      if (!symbol.includes(symbolFromDesc)) {
        errors.push(`Symbol ${symbol} and feed description ${desc} don't match (${tokenFeed.feed})`)
      } else if (symbol !== symbolFromDesc) {
        console.log(`! Token ${symbol} and feed ${desc} match but not exactly equal, verify the wrapper token`)
      }
    }
  }
  if (errors.length > 0) {
    console.log("Fix the following errors", errors)
    return
  }

  console.table(tokenFeeds)
  let { address } = await get("JuiceStaking")
  let signer = await SafeLedgerSigner(ethers, network)
  let contract = JuiceStaking01__factory.connect(address, signer)
  await contract.updatePriceOracles(tokenFeeds.map(t => t.token), tokenFeeds.map(t => t.feed))
}
