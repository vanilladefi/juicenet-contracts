import { LedgerSigner } from "@ethersproject/hardware-wallets"
import { SafeEthersSigner, SafeService } from "@gnosis.pm/safe-ethers-adapters"
import { getNetworkConfig } from "../network.config"
import Safe from "@gnosis.pm/safe-core-sdk"
import EthersAdapter from "@gnosis.pm/safe-ethers-lib"
import { Network } from "hardhat/types"

const wait = (milliSec: number) => new Promise(resolve => setTimeout(resolve, milliSec))

const waitForLedger = async (signer: LedgerSigner, firstRun = true): Promise<string> => {
  try {
    return await signer.getAddress()
  } catch (err: any) {
    if (firstRun) {
      console.log("Connect the Ethereum app on ledger", `(${err.statusCode})`)
    }
    return await wait(2500).then(() => waitForLedger(signer, false))
  }
}

export const SafeLedgerSigner = async (ethers: any, network: Network, type = "default"): Promise<SafeEthersSigner> => {
  let config = getNetworkConfig(network)
  if (!config || !config.gnosisTxService) {
    throw new Error(`Unsupported network ${network.name} for SafeLedgerSigner`)
  }
  if (!config.hdPath) {
    throw new Error(`Define ${network.name}.deployer.hdpath in .secrets.env`)
  }
  if (!config.multisigAddress) {
    throw new Error(`Define ${network.name}.deployer.address in .secrets.env`)
  }
  console.log("Config", { ...config, privateKeys: undefined })
  const signer = new LedgerSigner(ethers.provider, type, config.hdPath)
  console.log("Initialize signer")
  let signerAddress = await waitForLedger(signer, true)
  console.log(`Using signer ${signerAddress}`)
  let safeService = new SafeService(config.gnosisTxService)
  const ethAdapter = new EthersAdapter({ ethers, signer })

  const safe = await Safe.create({ ethAdapter, safeAddress: config.multisigAddress })

  return new SafeEthersSigner(safe, safeService)
}
