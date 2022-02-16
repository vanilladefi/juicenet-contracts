import { HardhatRuntimeEnvironment } from "hardhat/types"
import { JuiceStaking__factory } from "../typechain/juicenet"
import { readFile } from "fs/promises"

export default async (_: never, { ethers, deployments, network, getNamedAccounts }: HardhatRuntimeEnvironment): Promise<void> => {
  const { get } = deployments

  type Mint = {receiver: string, amount: number}
  let preMine: Mint[] = JSON.parse(await readFile("premine.json", "utf8"))
  let { address } = await get("JuiceStaking") // throws if safelist not deployed

  const { deployer } = await getNamedAccounts()
  let signer = await ethers.getSigner(deployer)

  let stakingContract = JuiceStaking__factory.connect(address, signer)

  console.log("Premining JUICE to following receivers")
  console.table(preMine)

  let pendingTx = await stakingContract.mintJuice(preMine.map(x => x.receiver), preMine.map(x => (x.amount * (10 ** 8))))
  let receipt = await pendingTx.wait()
  console.log(`Juices minted in #${receipt.blockNumber}`)
  console.log(`Gas usage: ${receipt.gasUsed}`)
}
