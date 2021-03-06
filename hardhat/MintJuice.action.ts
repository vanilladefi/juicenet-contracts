import { HardhatRuntimeEnvironment } from "hardhat/types"
import { JuiceStaking01__factory } from "../typechain/juicenet"
import { readFile } from "fs/promises"
import { SafeLedgerSigner } from "./SignerUtil"

export default async (_: never, hre: HardhatRuntimeEnvironment): Promise<void> => {
  let { ethers, deployments, network, getNamedAccounts } = hre
  const { get } = deployments

  type Mint = {user: string, total: bigint}
  let preMine: Mint[] = JSON.parse(await readFile(`deployments/${network.name}/JUICE-airdrop.json`, "utf8")).map(({ user, total }: {user: string, total: string}) => ({ user, total: BigInt(total) }))
  let { address } = await get("JuiceStaking")

  let signer = await SafeLedgerSigner(ethers, network)
  // let signer = await ethers.getSigner(deployer)

  let stakingContract = JuiceStaking01__factory.connect(address, signer)

  console.log("Premining JUICE to following receivers")
  console.table(preMine)

  let pendingTx = await stakingContract.mintJuice(preMine.map(x => x.user), preMine.map(x => x.total))
  let receipt = await pendingTx.wait()
  console.log(`Juices minted in #${receipt.blockNumber}`)
  console.log(`Gas usage: ${receipt.gasUsed}`)
}
