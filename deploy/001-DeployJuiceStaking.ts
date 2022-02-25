import { HardhatRuntimeEnvironment, Network } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/dist/types"
import { JuiceStaking, JuiceStaking__factory } from "../typechain/juicenet"
import { ethers, upgrades } from "hardhat"

const MUMBAI_CHAINID = 80001
const POLYGON_CHAINID = 137

// TODO figure out the real static type of the Network
const checkNetwork = (network: Network) => {
  let localFork = (network.name === "localhost" || network.name === "hardhat")
  switch (network.config.chainId) {
    case MUMBAI_CHAINID:
      return ({ publicTestnet: true, localFork })
    case POLYGON_CHAINID:
      return ({ publicTestnet: false, localFork })
  }
  throw new Error(`Unexpected network ${network.name} (${network.config.chainId})`)
}

const func: DeployFunction = async function ({
  deployments,
  getNamedAccounts,
  network,
  ethers,
}: HardhatRuntimeEnvironment) {
  const {
    save,
    getOrNull,
    getArtifact,
  } = deployments

  const { deployer } = await getNamedAccounts()

  const existingDeployment = await getOrNull("JuiceStaking")

  if (!existingDeployment) {
    let { publicTestnet, localFork } = checkNetwork(network)

    let contract
    if (publicTestnet || localFork) {
      /// Mumbai and local fork of Mainnet is deployed without multisig
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
      contract = stakingContract
      console.log("Deployed contracts", { proxy: address, implementation: await upgrades.erc1967.getImplementationAddress(address) })
      console.log(`Gas usage: ${receipt.gasUsed}`)
    } else {
      throw new Error("Mainnet deployment still unsupported")
    }

    if (publicTestnet) {
      let btc = {
        priceFeed: "0x007A22900a3B98143368Bd5906f8E17e9867581b",
        token: "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6",
      }
      let eth = {
        priceFeed: "0x0715A7794a1dc8e42615F059dD6e406A6594651A",
        token: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
      }
      let wmatic = {
        priceFeed: "0xd0D5e3DB44DE05E9F294BB0a3bEEaF030DE24Ada",
        token: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
      }
      let sand = {
        priceFeed: "0x9dd18534b8f456557d11B9DDB14dA89b2e52e308",
        token: "0xBbba073C31bF03b8ACf7c28EF0738DeCF3695683",
      }
      let supportedTokens = [btc, eth, wmatic, sand]
      await contract.updatePriceOracles(supportedTokens.map(t => t.token), supportedTokens.map(t => t.priceFeed))
    } else {
      let btc = {
        priceFeed: "0xc907E116054Ad103354f2D350FD2514433D57F6f",
        token: "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6",
      }
      let eth = {
        priceFeed: "0xF9680D99D6C9589e2a93a78A04A279e509205945",
        token: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
      }
      let supportedTokens = [btc, eth]
      await contract.updatePriceOracles(supportedTokens.map(t => t.token), supportedTokens.map(t => t.priceFeed))
    }
  }
}
func.tags = ["JuiceStaking"]
export default func
