/// helper method for more readable assertions
import { JuiceStaking01, JuiceStaking02 } from "../typechain/juicenet"
import { createHash } from "crypto"
import { ethers } from "hardhat"

export type CurrentStakeHelper = (user: string, token: string) => Promise<{juiceValue: number, juiceStake: number, sentiment: boolean, currentPrice: number}>
export const CurrentStake = (stakingContract: JuiceStaking01 | JuiceStaking02): CurrentStakeHelper => async (user: string, token: string) => {
  let { juiceValue, juiceStake, sentiment, currentPrice } = await stakingContract.currentStake(user, token)
  return {
    juiceValue: juiceValue.toNumber(),
    juiceStake: juiceStake.toNumber(),
    sentiment,
    currentPrice: currentPrice.toNumber(),
  }
}

const hash = createHash("sha256")

export const createRandomEthereumAddress = (defaultSeed = 42) => {
  let seed = defaultSeed
  return () => {
    hash.update(Number(seed++).toString())
    return ethers.utils.getAddress(ethers.utils.hexZeroPad("0x" + hash.copy().digest("hex").substring(0, 40), 20))
  }
}
