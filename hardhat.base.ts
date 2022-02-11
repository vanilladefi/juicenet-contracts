/* eslint-disable camelcase */
import { Networks, SupportedNetwork } from "./network.config"
import { HardhatUserConfig } from "hardhat/config"

import "@nomiclabs/hardhat-ethers"
import "@nomiclabs/hardhat-waffle"
import "hardhat-deploy"
import "hardhat-deploy-ethers"
import "@typechain/hardhat"
import "solidity-coverage"
import "@nomiclabs/hardhat-etherscan"
import "@openzeppelin/hardhat-upgrades"
import { NetworksUserConfig, NetworkUserConfig } from "hardhat/types"

let networks: NetworksUserConfig = {
  mainnet: {
    url: Networks.mainnet.providerURL,
    accounts: Networks.mainnet.privateKeys,
    live: true,
    gasPrice: 200 * 1_000_000_000,
    chainId: 1,
  },
  polygon: {
    url: Networks.polygon.providerURL,
    accounts: Networks.polygon.privateKeys,
    live: true,
    gasPrice: 200 * 1_000_000_000,
    chainId: 137,
  },
  mumbai: {
    url: Networks.mumbai.providerURL,
    accounts: Networks.mumbai.privateKeys,
    live: true,
    gasPrice: 200 * 1_000_000_000,
    chainId: 80001,
  },
  ropsten: {
    url: Networks.ropsten.providerURL,
    accounts: Networks.ropsten.privateKeys,
    live: true,
    saveDeployments: true,
    chainId: 3,
  },
  goerli: {
    url: Networks.goerli.providerURL,
    accounts: Networks.goerli.privateKeys,
    live: true,
    saveDeployments: true,
    chainId: 5,
  },
  rinkeby: {
    url: Networks.rinkeby.providerURL,
    accounts: Networks.rinkeby.privateKeys,
    live: true,
    saveDeployments: true,
    chainId: 4,
  },
}
const HARDHAT_NETWORK_ID = 31337
let isFork = false
let localChainId = HARDHAT_NETWORK_ID
let forkingURL
let forkId = process.env.FORK as SupportedNetwork
if (forkId) {
  isFork = true
  forkingURL = Networks[forkId].providerURL
  localChainId = networks[forkId]?.chainId || HARDHAT_NETWORK_ID
}
networks.localhost = {
  chainId: localChainId,
  live: false,
  saveDeployments: true,
  tags: ["local"],
}
networks.hardhat = {
  gasPrice: "auto",
  // set this to 0 to work-around https://github.com/sc-forks/solidity-coverage/issues/652
  initialBaseFeePerGas: 0,
  forking: {
    enabled: isFork,
    url: forkingURL || "",
  },
  chainId: localChainId,
  live: false,
  saveDeployments: true,
  tags: ["test", "local"],
}
const hardhatConfig: HardhatUserConfig = {
  etherscan: {
    apiKey: process.env.ETHERSCAN_APIKEY,
  },
  typechain: {
    outDir: "typechain/juicenet",
    target: "ethers-v5",
  },
  solidity: {
    version: "0.8.10",
    settings: {
      optimizer: {
        enabled: true,
      },
    },
  },
  defaultNetwork: "hardhat",
  networks,
  namedAccounts: {
    deployer: {
      default: 0, // the first account for mnemonic/specific private key
    },
    team: {
      default: 1, // the second account for mnemonic
    },
    dev: {
      default: 2,
    },
  },
  mocha: {
    timeout: 0,
  },
}

export default hardhatConfig
