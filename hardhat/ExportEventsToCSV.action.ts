import { HardhatRuntimeEnvironment } from "hardhat/types"
import { JuiceStaking__factory } from "../typechain/juicenet"
import Decimal from "decimal.js"
import { appendFile, writeFile } from "fs/promises"

export default async (_: never, { ethers, deployments, network, getNamedAccounts }: HardhatRuntimeEnvironment): Promise<void> => {
  const { get } = deployments

  let { address } = await get("JuiceStaking")

  console.log(`Fetching Juicenet data (${network.name}, ${address})`)
  let stakingContract = JuiceStaking__factory.connect(address, ethers.provider)

  const deposits = await stakingContract.queryFilter(stakingContract.filters.JUICEDeposited(null, null)).then(
    evts => evts.map(e => ({
      blockNumber: e.blockNumber,
      logIndex: e.logIndex,
      type: "deposit",
      user: e.args.user,
      unstakedDiff: new Decimal(e.args.amount.toString()).div(10 ** 8).toFixed(8),
    })))

  const withdraws = await stakingContract.queryFilter(stakingContract.filters.JUICEWithdrawn(null, null)).then(
    evts => evts.map(e => ({
      blockNumber: e.blockNumber,
      logIndex: e.logIndex,
      type: "withdraw",
      user: e.args.user,
      unstakedDiff: new Decimal(e.args.amount.toString()).div(10 ** 8).neg().toFixed(8),
    })))
  const stakesAdded = await stakingContract.queryFilter(stakingContract.filters.StakeAdded(null, null, null, null, null)).then(
    evts => evts.map(e => ({
      blockNumber: e.blockNumber,
      logIndex: e.logIndex,
      type: "add stake",
      user: e.args.user,
      token: e.args.token,
      sentiment: e.args.sentiment,
      price: new Decimal(e.args.price.toString()).div(10 ** 8).toFixed(8),
      unstakedDiff: new Decimal(e.args.unstakedDiff.toString()).div(10 ** 8).toFixed(8),
    })))
  const stakesRemoved = await stakingContract.queryFilter(stakingContract.filters.StakeRemoved(null, null, null, null, null)).then(
    evts => evts.map(e => ({
      blockNumber: e.blockNumber,
      logIndex: e.logIndex,
      type: "remove stake",
      user: e.args.user,
      token: e.args.token,
      sentiment: e.args.sentiment,
      price: new Decimal(e.args.price.toString()).div(10 ** 8).toFixed(8),
      unstakedDiff: new Decimal(e.args.unstakedDiff.toString()).div(10 ** 8).toFixed(8),
    })))

  type SortableEvent = {blockNumber: number, logIndex: number}
  let byBlockIndexOrder = (a: SortableEvent, b: SortableEvent) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex
  let events = [...deposits, ...withdraws, ...stakesAdded, ...stakesRemoved]
    .sort(byBlockIndexOrder)

  let toHeaders = (state: Set<string>, ob: any) => {
    Object.keys(ob).forEach((key) => state.add(key))
    return state
  }
  let headers = [...events.reduce(toHeaders, new Set())]
  console.log(`Writing ${events.length} rows to 'events.csv'`)
  await writeFile("events.csv", headers.join(",") + "\n")
  for (const evt of events) {
    let data = []
    for (const header of headers) {
      const typedHeader = header as keyof typeof evt
      const value = evt[typedHeader]
      data.push(value || "")
    }
    await appendFile("events.csv", data.join(",") + "\n")
  }
}
