import { HardhatRuntimeEnvironment } from "hardhat/types"
import { JuiceStaking__factory } from "../typechain/juicenet"
type Arguments = { proxy: string, tx: string }
export default async ({ proxy, tx }: Arguments, hre: HardhatRuntimeEnvironment): Promise<void> => {
  const { ethers } = hre
  const { get, save } = hre.deployments

  if (!proxy || !ethers.utils.isAddress(proxy)) throw new Error(`Invalid proxy address '${proxy}'`)
  if (!tx || !ethers.utils.isHexString(tx, 32)) throw new Error(`Invalid transaction hash '${tx}'`)

  let address = proxy
  let receipt = await ethers.provider.getTransactionReceipt(tx)
  let abi = JuiceStaking__factory.abi

  await save("JuiceStaking", { abi, address, receipt })
  console.log("Saved deployment", await get("JuiceStaking"))
}
