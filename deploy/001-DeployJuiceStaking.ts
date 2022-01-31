import { HardhatRuntimeEnvironment } from "hardhat/types"
import { DeployFunction } from "hardhat-deploy/dist/types"
import { JuiceStaking__factory } from "../typechain/juicenet"
import { Decimal } from "decimal.js"
import { BigNumber, BigNumberish } from "ethers"
import { SignerWithAddress } from "hardhat-deploy-ethers/dist/src/signers"

const func: DeployFunction = async function ({ deployments, getNamedAccounts, network, ethers }: HardhatRuntimeEnvironment) {
  const { save, getOrNull, getArtifact } = deployments

  const { deployer } = await getNamedAccounts()

  const existingDeployment = await getOrNull("JuiceStaking")
  if (!existingDeployment) {
    let signer = await ethers.getNamedSigner("deployer")
    let contractDeployment = new JuiceStaking__factory(signer).getDeployTransaction()
    let pendingTransaction = await signer.sendTransaction(contractDeployment)
    let receipt = await pendingTransaction.wait()
    let address = receipt.contractAddress
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
    //
    // // TODO make sure to remove these smoke tests
    // await contract.deposit(10 * (10 ** 8))
    // console.log("Balances:", await balanceOf("Owner", signer.address), await balanceOf("Juicenet", contract.address))
    //
    // await contract.withdraw(10 * (10 ** 8))
    // console.log("Balances:", await balanceOf("Owner", signer.address), await balanceOf("Juicenet", contract.address))
    //
    // let somebodyElse = await ethers.getNamedSigner("dev")
    // let hostile = await ethers.getNamedSigner("team")
    //
    // const domain = {
    //   name: "Vanilla Juice",
    //   version: "1",
    //   chainId: network.config.chainId,
    //   verifyingContract: contract.address,
    // }
    //
    // // The named list of all type definitions
    // const stakingTypes = {
    //   Permission: [
    //     { name: "sender", type: "address" },
    //     { name: "deadline", type: "uint" },
    //     { name: "nonce", type: "uint" },
    //   ],
    //   Deposit: [
    //     { name: "amount", type: "uint" },
    //     { name: "permission", type: "Permission" },
    //   ],
    //   Withdraw: [
    //     { name: "amount", type: "uint" },
    //     { name: "permission", type: "Permission" },
    //   ],
    //   Stake: [
    //     { name: "token", type: "address" },
    //     { name: "amount", type: "uint128" },
    //     { name: "sentiment", type: "bool" },
    //   ],
    //   ModifyStakes: [
    //     { name: "stakes", type: "Stake[]" },
    //     { name: "permission", type: "Permission" },
    //   ],
    // }
    // const DepositTypes = { Permission: stakingTypes.Permission, Deposit: stakingTypes.Deposit }
    //
    // const WithdrawTypes = { Permission: stakingTypes.Permission, Withdraw: stakingTypes.Withdraw }
    //
    // const ModifyStakesTypes = { Permission: stakingTypes.Permission, Stake: stakingTypes.Stake, ModifyStakes: stakingTypes.ModifyStakes }
    //
    // let permission = {
    //   sender: signer.address,
    //   deadline: await ethers.provider.getBlock("latest").then(b => b.timestamp + 10000),
    //   nonce: 0,
    // }
    // const delegateDeposit = async (types: Record<string, any>, message: Record<string, any>, messageSigner: SignerWithAddress) => {
    //   let signature = await messageSigner._signTypedData(domain, types, message)
    //   console.log("Signature", signature, "by", messageSigner.address)
    //   console.log("permission", message.permission)
    //   console.log("Hash message (ethers)", ethers.utils._TypedDataEncoder.from(types).hash(message))
    //   console.log("Domain hash (ethers)", ethers.utils._TypedDataEncoder.hashDomain(domain))
    //   console.log("EIP-712 hash (ethers)", ethers.utils._TypedDataEncoder.hash(domain, types, message))
    //   await contract.connect(somebodyElse).delegateDeposit(message.amount, { data: message.permission, signature })
    //   let { amount, sentiment } = await contract.connect(signer).currentStake(signer.address, btc.token)
    //   let unstakedAmount = await contract.unstakedBalanceOf(signer.address)
    //   console.log("Current stake on BTC", juice(amount), sentiment, juice(unstakedAmount))
    //   console.log("Balances after deposit:", await balanceOf("Owner", signer.address), await balanceOf("Juicenet", contract.address), await balanceOf("delegate", somebodyElse.address))
    // }
    //
    // const delegateWithdraw = async (types: Record<string, any>, message: Record<string, any>, messageSigner: SignerWithAddress) => {
    //   let signature = await messageSigner._signTypedData(domain, types, message)
    //   console.log("Signature", signature, "by", messageSigner.address)
    //   console.log("permission", message.permission)
    //   console.log("Hash message (ethers)", ethers.utils._TypedDataEncoder.from(types).hash(message))
    //   console.log("Domain hash (ethers)", ethers.utils._TypedDataEncoder.hashDomain(domain))
    //   console.log("EIP-712 hash (ethers)", ethers.utils._TypedDataEncoder.hash(domain, types, message))
    //   await contract.connect(somebodyElse).delegateWithdraw(message.amount, { data: message.permission, signature })
    //   let { amount, sentiment } = await contract.connect(signer).currentStake(signer.address, btc.token)
    //   let unstakedAmount = await contract.unstakedBalanceOf(signer.address)
    //   console.log("Current stake on BTC", juice(amount), sentiment, juice(unstakedAmount))
    //   console.log("Balances after withdraw:", await balanceOf("Owner", signer.address), await balanceOf("Juicenet", contract.address), await balanceOf("delegate", somebodyElse.address))
    // }
    //
    // const delegateModifyStakes = async (types: Record<string, any>, message: Record<string, any>, messageSigner: SignerWithAddress) => {
    //   let signature = await messageSigner._signTypedData(domain, types, message)
    //   console.log("Signature", signature, "by", messageSigner.address)
    //   console.log("permission", message.permission)
    //   console.log("Encode (ethers)", ethers.utils._TypedDataEncoder.encode(domain, types, message))
    //   let typedDataEncoder = ethers.utils._TypedDataEncoder.from(types)
    //   console.log("Hash message (ethers)", typedDataEncoder.hash(message))
    //   console.log(typedDataEncoder)
    //   console.log("Hash stake (ethers)", ethers.utils._TypedDataEncoder.from({ Stake: types.Stake }).hash(message.stakes[0]))
    //   console.log("Domain hash (ethers)", ethers.utils._TypedDataEncoder.hashDomain(domain))
    //   console.log("EIP-712 hash (ethers)", ethers.utils._TypedDataEncoder.hash(domain, types, message))
    //   await contract.connect(somebodyElse).delegateModifyStakes(message.stakes, { data: message.permission, signature })
    //   let { amount, sentiment } = await contract.connect(signer).currentStake(signer.address, btc.token)
    //   let unstakedAmount = await contract.unstakedBalanceOf(signer.address)
    //   console.log("Current stake on BTC", juice(amount), sentiment, juice(unstakedAmount))
    //   console.log("Balances after modifyStakes:", await balanceOf("Owner", signer.address), await balanceOf("Juicenet", contract.address), await balanceOf("delegate", somebodyElse.address))
    // }
    //
    // await delegateDeposit(DepositTypes, { permission, amount: 10 * (10 ** 8) }, signer)
    // await delegateModifyStakes(ModifyStakesTypes, { permission: { ...permission, nonce: 1 }, stakes: [{ token: btc.token, amount: 5 * (10 ** 8), sentiment: true }] }, signer)
    // await delegateModifyStakes(ModifyStakesTypes, { permission: { ...permission, nonce: 2 }, stakes: [{ token: btc.token, amount: 0, sentiment: true }] }, signer)
    // await delegateWithdraw(WithdrawTypes, { permission: { ...permission, nonce: 3 }, amount: 10 * (10 ** 8) }, signer)
  }
}
func.tags = ["JuiceStaking"]
export default func
