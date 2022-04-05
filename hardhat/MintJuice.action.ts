import { HardhatRuntimeEnvironment } from "hardhat/types"
import { JuiceStaking__factory } from "../typechain/juicenet"
import { readFile } from "fs/promises"

export default async (_: never, hre: HardhatRuntimeEnvironment): Promise<void> => {
  let { ethers, deployments, network, getNamedAccounts } = hre
  const { get } = deployments

  type Mint = {user: string, total: bigint}
  let preMine: Mint[] = JSON.parse(await readFile("premine.json", "utf8")).map(({ user, total }: {user: string, total: string}) => ({ user, total: BigInt(total) }))
  let { address } = await get("JuiceStaking")

  const { deployer } = await getNamedAccounts()
  let signer = await ethers.getSigner(deployer)

  let stakingContract = JuiceStaking__factory.connect(address, signer)

  console.log("Premining JUICE to following receivers")
  console.table(preMine)

  // let pendingTx = await stakingContract.mintJuice(preMine.map(x => x.user), preMine.map(x => x.total))
  // let receipt = await pendingTx.wait()
  // console.log(`Juices minted in #${receipt.blockNumber}`)
  // console.log(`Gas usage: ${receipt.gasUsed}`)
}
