import { JsonRpcProvider } from "@ethersproject/providers"
import { ethers } from "hardhat"
import { BigNumberish, Contract, Wallet } from "ethers"

const Permission = [
  { name: "sender", type: "address" },
  { name: "deadline", type: "uint" },
  { name: "nonce", type: "uint" },
]
const Deposit = [
  { name: "amount", type: "uint" },
  { name: "permission", type: "Permission" },
]
const Withdraw = [
  { name: "amount", type: "uint" },
  { name: "permission", type: "Permission" },
]
const Stake = [
  { name: "token", type: "address" },
  { name: "amount", type: "uint128" },
  { name: "sentiment", type: "bool" },
]
const ModifyStakes = [
  { name: "stakes", type: "Stake[]" },
  { name: "permission", type: "Permission" },
]

export const SigningHelper = (provider: JsonRpcProvider, stakingContract: Contract) => ({
  async domain () {
    return {
      name: "Vanilla Juice",
      version: "1",
      chainId: await ethers.provider.getNetwork().then(n => n.chainId),
      verifyingContract: stakingContract.address,
    }
  },
  async signDeposit (amount: BigNumberish, user: Wallet, nonce: number, deadline = 10000) {
    let permission = {
      sender: user.address,
      deadline: await ethers.provider.getBlock("latest").then(b => b.timestamp + deadline),
      nonce,
    }
    let message = { permission, amount }
    let signature = await user._signTypedData(await this.domain(), { Permission, Deposit }, message)
    let signedPermission = { data: permission, signature }
    return signedPermission
  },

  async signWithdraw (amount: BigNumberish, user: Wallet, nonce: number, deadline = 10000) {
    let permission = {
      sender: user.address,
      deadline: await ethers.provider.getBlock("latest").then(b => b.timestamp + deadline),
      nonce,
    }
    let message = { permission, amount }
    let signature = await user._signTypedData(await this.domain(), { Permission, Withdraw }, message)
    let signedPermission = { data: permission, signature }
    return signedPermission
  },

  async signModifyStakes (stakes: { sentiment: boolean, token: string, amount: BigNumberish }[], user: Wallet, nonce: number, deadline = 10000) {
    let permission = {
      sender: user.address,
      deadline: await ethers.provider.getBlock("latest").then(b => b.timestamp + deadline),
      nonce,
    }
    let message = { permission, stakes }
    let signature = await user._signTypedData(await this.domain(), { Permission, Stake, ModifyStakes }, message)
    let signedPermission = { data: permission, signature }
    return signedPermission
  },
})
