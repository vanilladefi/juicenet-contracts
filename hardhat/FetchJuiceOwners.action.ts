import { HardhatRuntimeEnvironment } from "hardhat/types"
import { BigNumber, constants, Event } from "ethers"
import { IERC20Upgradeable__factory } from "../typechain/juicenet"
import { writeFile } from "fs/promises"

export default async (_: never, { ethers }: HardhatRuntimeEnvironment): Promise<void> => {
  const VNL_ADDRESS = "0xbf900809f4C73e5a3476eb183d8b06a27e61F8E5"
  // technically, VanillaV1Token02 contract is not IERC20Upgradeable, but it doesn't matter here since all we need are the Transfer events
  let vnlToken02 = IERC20Upgradeable__factory.connect(VNL_ADDRESS, ethers.provider)

  const tokenTransfers = await vnlToken02.queryFilter(vnlToken02.filters.Transfer(null, null, null))
  let byBlockIndexOrder = (a: Event, b: Event) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex
  let transfers = tokenTransfers
    .sort(byBlockIndexOrder)
    .map(({ blockNumber, args }) => ({ blockNumber, ...args }))

  type SnapshotState = {
    blockNumber: number,
    accounts: Record<string, bigint>
  }

  const toSnapshotState = (state: SnapshotState, event: { blockNumber: number, from: string, to:string, value:BigNumber }) => {
    let valueBn = BigInt(event.value.toString())
    let prev = state.accounts[event.to] || 0n
    state.accounts[event.to] = prev + valueBn

    if (event.from !== constants.AddressZero) {
      if (!state.accounts[event.from]) {
        if (event.value.gt(0)) { throw new Error(`something went wrong in ${event.blockNumber} from=${event.from} value=${event.value}`) }
        state.accounts[event.from] = 0n
      }
      prev = state.accounts[event.from]
      state.accounts[event.from] = prev - valueBn
      if (state.accounts[event.from] === 0n) {
        delete state.accounts[event.from]
      }
    }
    state.blockNumber = Math.max(event.blockNumber, state.blockNumber || 0)
    return state
  }

  let data: SnapshotState = transfers.reduce(toSnapshotState, { blockNumber: 0, accounts: {} })
  type HolderData = {amount: bigint, contract: boolean}
  type Holder = [string, HolderData]
  let holders: Holder[] = await Promise.all(Object.entries(data.accounts)
    .map(([address, amount]) => ethers.provider.getCode(address).then((code): Holder => ([address, { amount, contract: code !== "0x" }]))))

  let newHolders: {receiver: string, amount: bigint}[] = holders
    .sort(([a1, b1], [a2, b2]) => Number(b1.amount - b2.amount))
    .filter(([address, data]) => !data.contract)
    .map(([address, data]) => ({ receiver: address, amount: data.amount }))
  await writeFile("premine.json", JSON.stringify(newHolders,
    (key, value) => typeof value === "bigint" ? value.toString() : value,
    4), "utf8")
  console.table(newHolders)
  console.log(`Block ${data.blockNumber}, holder count ${Object.keys(data.accounts).length}, wrote to premine.json`)
}
