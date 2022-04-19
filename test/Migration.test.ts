import { expect, use } from "chai"
import {
  JuiceStaking01,
  JuiceStaking01__factory,
  MockJuiceStaking__factory,
  MockPriceOracle, MockPriceOracle__factory, MockSignalAggregator__factory,
} from "../typechain/juicenet"
import { ERC1967Proxy__factory } from "../typechain/openzeppelin"

import { createRandomEthereumAddress, CurrentStake } from "./Staking.test"
import { BigNumberish, Wallet } from "ethers"
import { solidity } from "ethereum-waffle"
import chaiAsPromised from "chai-as-promised"

import { ethers, waffle } from "hardhat"
import { ReadStakePositions01 } from "../hardhat/MigrationUtil"

use(solidity)
use(chaiAsPromised)

const { provider, deployContract, createFixtureLoader } = waffle
const { provider: networkProvider } = ethers
const loadFixture = createFixtureLoader(provider.getWallets(), provider)

const DECIMALS = 10 ** 8
const JUICE_SUPPLY = 3 * 20 * DECIMALS

const initializeExternalContracts = async ([deployer, a, b, c]: Wallet[]) => {
  let tokens = [...Array(3)].map(createRandomEthereumAddress)

  const initializeOracle = (price: BigNumberish) => async (oracle: MockPriceOracle) => {
    await oracle.setPrice(price)
    await oracle.setPhaseId(1)
    return oracle
  }

  let oracles = [await new MockPriceOracle__factory(deployer).deploy().then(initializeOracle(10 * DECIMALS)),
    await new MockPriceOracle__factory(deployer).deploy().then(initializeOracle(20 * DECIMALS)),
    await new MockPriceOracle__factory(deployer).deploy().then(initializeOracle(50 * DECIMALS))]

  let signalAggregator = await new MockSignalAggregator__factory(deployer).deploy()
  // deploy the first version and initialize it
  let staking01Factory = new JuiceStaking01__factory(deployer)
  let staking01Logic = await staking01Factory.deploy()
  let initializerData = staking01Logic.interface.encodeFunctionData("initialize")
  let proxy = await new ERC1967Proxy__factory(deployer).deploy(staking01Logic.address, initializerData)
  let staking01 = staking01Factory.attach(proxy.address)

  let balancePerUser = JUICE_SUPPLY / 3
  await staking01.connect(deployer).mintJuice([a, b, c].map(x => x.address), [...Array(3)].fill(balancePerUser))
  await staking01.connect(deployer).updatePriceOracles(tokens, oracles.map(x => x.address))

  return {
    balancePerUser, tokens, oracles, signalAggregator, staking01, accounts: { deployer, users: [a, b, c] },
  }
}

describe("When migrating from 01 to 02", () => {
  let tokens: string[]
  let oracles: MockPriceOracle[]
  let deployer: Wallet, a: Wallet, b: Wallet, c: Wallet
  let staking01: JuiceStaking01
  let depositedAmount: number

  beforeEach(async () => {
    ({ balancePerUser: depositedAmount, oracles, tokens, staking01, accounts: { deployer, users: [a, b, c] } } = await loadFixture(initializeExternalContracts))
  })

  it("migration refunds the positions back to user", async () => {
    // execute a stake and verify the roundId error
    let [token, token2] = tokens
    await staking01.connect(a).deposit(depositedAmount)
    await staking01.connect(a).modifyStakes([{
      token: token,
      amount: depositedAmount / 4,
      sentiment: true,
    }])
    await staking01.connect(b).deposit(depositedAmount)
    await staking01.connect(b).modifyStakes([{
      token: token2,
      amount: depositedAmount / 2,
      sentiment: false,
    }])
    await staking01.connect(c).deposit(depositedAmount)
    await staking01.connect(c).modifyStakes([{
      token: token,
      amount: depositedAmount / 4,
      sentiment: false,
    }, {
      token: token2,
      amount: depositedAmount * 3 / 4,
      sentiment: true,
    }])
    expect(await staking01.unstakedBalanceOf(a.address)).to.equal(depositedAmount - depositedAmount / 4)
    expect(await staking01.unstakedBalanceOf(b.address)).to.equal(depositedAmount - depositedAmount / 2)
    expect(await staking01.unstakedBalanceOf(c.address)).to.equal(0)
    await expect(staking01.currentStake(a.address, token)).to.be.revertedWith("Array accessed at an out-of-bounds or negative index")
    await expect(staking01.currentStake(b.address, token2)).to.be.revertedWith("Array accessed at an out-of-bounds or negative index")
    await expect(staking01.currentStake(c.address, token)).to.be.revertedWith("Array accessed at an out-of-bounds or negative index")
    await expect(staking01.currentStake(c.address, token2)).to.be.revertedWith("Array accessed at an out-of-bounds or negative index")
    let { longTokens: signalBefore } = await staking01.normalizedAggregateSignal()
    expect(signalBefore.length).to.equal(1)
    let [{ token: longToken, weight }] = signalBefore
    expect(longToken).to.equal(token2)
    expect(weight).to.equal(14)

    // deploy the second version and upgrade proxy
    let staking02Factory = new MockJuiceStaking__factory(deployer)
    let staking02Logic = await staking02Factory.deploy()

    let stakingState = await ReadStakePositions01(staking01)
    let openPositions = Object.entries(stakingState.accounts).map(([owner, x]) => {
      return { owner, tokens: Object.keys(x.tokenPositions) }
    })

    let migration = staking02Logic.interface.encodeFunctionData("migrateFrom01", [openPositions])

    let upgradeTx = staking01.upgradeToAndCall(staking02Logic.address, migration)

    let tx = await upgradeTx
    let staking02 = staking02Factory.attach(staking01.address)

    // verify that events are emitted, aggregate signal is reset, and all stakes are refunded
    await expect(upgradeTx).to.emit(staking02, "StakeRemoved").withArgs(a.address, token, true, 0, depositedAmount / 4)
    await expect(upgradeTx).to.emit(staking02, "StakeRemoved").withArgs(b.address, token2, false, 0, depositedAmount / 2)
    await expect(upgradeTx).to.emit(staking02, "StakeRemoved").withArgs(c.address, token, false, 0, depositedAmount / 4)
    await expect(upgradeTx).to.emit(staking02, "StakeRemoved").withArgs(c.address, token2, true, 0, depositedAmount * 3 / 4)
    let currentStake = CurrentStake(staking02)
    expect(await staking02.unstakedBalanceOf(a.address)).to.equal(depositedAmount)
    expect(await staking02.unstakedBalanceOf(b.address)).to.equal(depositedAmount)
    expect(await staking02.unstakedBalanceOf(c.address)).to.equal(depositedAmount)
    let { longTokens: signalAfter } = await staking02.normalizedAggregateSignal()
    expect(signalAfter).to.eql([])
    console.log({ signalBefore, signalAfter })
    expect(await currentStake(a.address, token)).to.include({ juiceStake: 0, juiceValue: 0 })
    expect(await currentStake(b.address, token2)).to.include({ juiceStake: 0, juiceValue: 0 })
    expect(await currentStake(c.address, token)).to.include({ juiceStake: 0, juiceValue: 0 })
    expect(await currentStake(c.address, token2)).to.include({ juiceStake: 0, juiceValue: 0 })
  })
})
