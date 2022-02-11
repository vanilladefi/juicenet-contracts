import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/dist/types"
import { JuiceStaking, JuiceStaking__factory } from "../typechain/juicenet"
import { Decimal } from "decimal.js"
import { BigNumber, BigNumberish } from "ethers"
import { ethers, upgrades } from "hardhat"

const func: DeployFunction = async function ({ deployments, getNamedAccounts, network, ethers }: HardhatRuntimeEnvironment) {
  const { save, getOrNull, getArtifact } = deployments

  const { deployer } = await getNamedAccounts()

  const existingDeployment = await getOrNull("JuiceStaking")
  if (!existingDeployment) {
    let signer = await ethers.getSigner(deployer)
    let stakingContractImpl = await ethers.getContractFactory("JuiceStaking", signer)
    let stakingContract = await upgrades.deployProxy(stakingContractImpl, { kind: "uups" }) as JuiceStaking
    await stakingContract.deployed()
    let address = stakingContract.address
    let receipt = await stakingContract.deployTransaction.wait()
    console.log("Receipt", receipt)
    await save("JuiceStaking", {
      abi: JuiceStaking__factory.abi,
      address,
      receipt,
    })

    console.log(`JuiceStaking deployed at ${address} (cost ${receipt.gasUsed.toString()})`)
    let contract = JuiceStaking__factory.connect(address, signer)

    await contract.mintJuice([signer.address], [100 * (10 ** 8)])
    console.log(`Minted 100 JUICE for ${signer.address}`)
    const juice = (bn: BigNumberish) => new Decimal(bn.toString()).div(10 ** 8).toDecimalPlaces(8)
    const balanceOf = async (name: string, address: string) => {
      let rawBalance = await contract.balanceOf(address)
      return `${name}: ${juice(rawBalance)}`
    }
    console.log("Balances:", await balanceOf("Owner", signer.address), await balanceOf("Juicenet", contract.address))

    let btc = {
      priceFeed: "0xc907E116054Ad103354f2D350FD2514433D57F6f",
      token: "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6",
    }
    let eth = {
      priceFeed: "0xF9680D99D6C9589e2a93a78A04A279e509205945",
      token: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
    }
    await contract.updatePriceOracles([eth.token, btc.token], [eth.priceFeed, btc.priceFeed])
    console.log("Authorized Oracles:", { btc, eth })
  }
}
func.tags = ["JuiceStaking"]
export default func
