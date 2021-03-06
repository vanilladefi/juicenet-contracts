/* eslint-disable camelcase */
import "@nomiclabs/hardhat-ethers"
import "@nomiclabs/hardhat-etherscan"
import "@nomiclabs/hardhat-waffle"
import "@typechain/hardhat"
import "hardhat-deploy"
import "hardhat-deploy-ethers"
import { HardhatUserConfig } from "hardhat/config"
import {
  HardhatNetworkAccountsUserConfig,
  NetworksUserConfig,
} from "hardhat/types"
import "solidity-coverage"
import { Networks, SupportedNetwork } from "./network.config"

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
let forkAccounts: HardhatNetworkAccountsUserConfig = []
if (forkId) {
  isFork = true
  forkingURL = Networks[forkId].providerURL
  localChainId = networks[forkId]?.chainId || HARDHAT_NETWORK_ID
  forkAccounts = (Networks[forkId].privateKeys || []).map((pk) => ({
    privateKey: pk,
    balance: BigInt(10_000_000_000_000_000_000_000n).toString(),
  }))
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
  chains: {
    [localChainId]: {
      hardforkHistory: {
        arrowGlacier: 24925931,
      },
    },
  },

  chainId: localChainId,
  live: false,
  saveDeployments: true,
  tags: ["test", "local"],
  accounts: forkAccounts.length > 0 ? forkAccounts : undefined,
}
const hardhatConfig: HardhatUserConfig = {
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_APIKEY,
      rinkeby: process.env.ETHERSCAN_APIKEY,
      polygon: process.env.POLYGONSCAN_APIKEY,
      polygonMumbai: process.env.POLYGONSCAN_APIKEY,
    },
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
