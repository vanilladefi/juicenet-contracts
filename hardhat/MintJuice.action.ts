import { HardhatRuntimeEnvironment } from "hardhat/types"
import { JuiceStaking__factory } from "../typechain/juicenet"
import { readFile } from "fs/promises"

export default async (_: never, { ethers, deployments, network, getNamedAccounts }: HardhatRuntimeEnvironment): Promise<void> => {
  const { get } = deployments

  type Mint = {receiver: string, amount: bigint}
  let preMine: Mint[] = JSON.parse(await readFile("premine.json", "utf8")).map(({ receiver, amount }: {receiver: string, amount: string}) => ({ receiver, amount: BigInt(amount) }))
  let { address } = await get("JuiceStaking")

  const { deployer } = await getNamedAccounts()
  let signer = await ethers.getSigner(deployer)

  let stakingContract = JuiceStaking__factory.connect(address, signer)

  console.log("Premining JUICE to following receivers")
  console.table(preMine)

  let pendingTx = await stakingContract.mintJuice(preMine.map(x => x.receiver), preMine.map(x => x.amount))
  let receipt = await pendingTx.wait()
  console.log(`Juices minted in #${receipt.blockNumber}`)
  console.log(`Gas usage: ${receipt.gasUsed}`)
}
