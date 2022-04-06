import { HardhatRuntimeEnvironment } from "hardhat/types"
import { JuiceStaking__factory } from "../typechain/juicenet"
import { SafeLedgerSigner } from "./SignerUtil"
import { ERC1967Proxy__factory } from "../typechain/openzeppelin"

type Arguments = { logic: string }
export default async ({ logic: logicAddress }: Arguments, hre: HardhatRuntimeEnvironment): Promise<void> => {
  let { ethers, network } = hre

  if (logicAddress && !ethers.utils.isAddress(logicAddress)) {
    throw new Error(`--logic parameter needs valid address (not ${logicAddress})`)
  }
  let signer = await SafeLedgerSigner(ethers, network)
  if (!logicAddress) {
    console.log("Deploying the logic contract")
    let juiceStakingFactory = new JuiceStaking__factory(signer)
    console.log("Deploying logic contract")
    let stakingLogic = await juiceStakingFactory.deploy()

    console.log("Logic contract enqueued", stakingLogic.deployTransaction)
    console.log("Go check block scanner for real address, and re-execute this task with the address as '--logic' param")
  } else {
    let stakingLogic = JuiceStaking__factory.connect(logicAddress, ethers.provider)
    console.log(`Deploying the proxy for logic contract '${logicAddress}' (bytecode equals: ${JuiceStaking__factory.bytecode === await ethers.provider.getCode(logicAddress)})`)
    let initializerData = stakingLogic.interface.encodeFunctionData("initialize")
    console.log("Deploying proxy")
    let proxy = await new ERC1967Proxy__factory(signer).deploy(logicAddress, initializerData)
    console.log("Proxy contract enqueued at", proxy.address, "(TODO figure out why this isn't correct)")
    console.log("Deploy TX data from Safe", proxy.deployTransaction)

    console.log("Gas cost", (await proxy.deployTransaction.wait()).gasUsed.toString())
  }
}
