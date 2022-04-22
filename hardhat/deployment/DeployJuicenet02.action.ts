import { HardhatRuntimeEnvironment } from "hardhat/types"
import { JuiceStaking01__factory, JuiceStaking02__factory } from "../../typechain/juicenet"
import { SafeLedgerSigner } from "../SignerUtil"
import { ReadStakePositions01 } from "../MigrationUtil"

type Arguments = { logic: string }
export default async ({ logic: logicAddress }: Arguments, hre: HardhatRuntimeEnvironment): Promise<void> => {
  let { ethers, network, deployments } = hre
  let { get } = deployments

  if (logicAddress && !ethers.utils.isAddress(logicAddress)) {
    throw new Error(`--logic parameter needs valid address (not ${logicAddress})`)
  }
  let signer = await SafeLedgerSigner(ethers, network)
  if (!logicAddress) {
    console.log("Deploying the logic contract")
    let juiceStakingFactory = new JuiceStaking02__factory(signer)
    console.log("Deploying logic contract")
    let stakingLogic = await juiceStakingFactory.deploy()

    console.log("Logic contract enqueued", stakingLogic.deployTransaction)
    console.log("Go check block scanner for real address, and re-execute this task with the address as '--logic' param")
  } else {
    let { address: proxyAddress } = await get("JuiceStaking")

    let proxy = JuiceStaking01__factory.connect(proxyAddress, ethers.provider)
    let stakingState = await ReadStakePositions01(proxy)
    let openPositions = Object.entries(stakingState.accounts).map(([owner, x]) => {
      return { owner, tokens: Object.keys(x.tokenPositions) }
    })
    console.log("Migrating open positions", openPositions)
    let staking02Logic = JuiceStaking02__factory.connect(logicAddress, ethers.provider)
    let migration = staking02Logic.interface.encodeFunctionData("migrateFrom01", [openPositions])
    let upgradedProxy = await proxy.upgradeToAndCall(logicAddress, migration)
  }
}
