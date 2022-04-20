/* eslint-disable camelcase */
import { expect, use } from "chai"
import chaiAsPromised from "chai-as-promised"

import {
  IPriceOracle__factory,
  JuiceStaking01__factory,
  JuiceStaking02,
  MockJuiceStaking,
  MockJuiceStaking__factory,
  MockJuiceStakingUpgrade,
  MockJuiceStakingUpgrade__factory,
  MockPriceOracle,
  MockPriceOracle__factory,
  MockSignalAggregator,
  MockSignalAggregator__factory,
  MockSignatureVerifier,
  MockSignatureVerifier__factory,
} from "../typechain/juicenet"
import { UpgradeableContract } from "@openzeppelin/upgrades-core"
import { artifacts, ethers, waffle } from "hardhat"
import { BigNumber, BigNumberish, Contract, ContractTransaction, Wallet } from "ethers"
import { deployMockContract, solidity } from "ethereum-waffle"
import { SigningHelper } from "./Signing.util"
import { ERC1967Proxy__factory } from "../typechain/openzeppelin"
import { jestSnapshotPlugin } from "mocha-chai-jest-snapshot"
import { createRandomEthereumAddress, CurrentStake, CurrentStakeHelper } from "./Utils"

use(solidity)
use(chaiAsPromised)
use(jestSnapshotPlugin())

const { provider, deployContract, createFixtureLoader } = waffle
const { provider: networkProvider } = ethers
const loadFixture = createFixtureLoader(provider.getWallets(), provider)

const value = (p: BigNumberish) => BigInt(p.toString())
const INIT_JUICE_SUPPLY = 2000000
const TOKEN_DECIMALS = 8
const startingTimeStamp = 1750000000
const callTimeDiff = 10

const deployProxy = async (deployer: Wallet) => {
  // deploy the first version and proxy
  let staking01Factory = new JuiceStaking01__factory(deployer)
  let staking01Logic = await call(staking01Factory.deploy())
  let initializerData = staking01Logic.interface.encodeFunctionData("initialize")
  let proxy = await call(new ERC1967Proxy__factory(deployer).deploy(staking01Logic.address, initializerData))

  // deploy the second version and upgrade proxy
  let staking02Factory = new MockJuiceStaking__factory(deployer)
  let staking02Logic = await call(staking02Factory.deploy())

  await call(staking01Factory.attach(proxy.address).upgradeTo(staking02Logic.address))

  return staking02Factory.attach(proxy.address)
}

const getStateChanges = async ({ hash }: ContractTransaction) => {
  const trace = await ethers.provider.send("debug_traceTransaction", [
    hash,
    {
      disableMemory: true,
      disableStack: true,
      disableStorage: false,
    },
  ])
  let lastTrace = trace.structLogs[trace.structLogs.length - 1]
  return lastTrace.storage
}

const call = async <T> (ethersCall: Promise<T>) => {
  return ethersCall.then(async (r) => {
    let latest = await ethers.provider.getBlock("latest").then(b => b.timestamp)
    let timestamp = latest + callTimeDiff - (latest % callTimeDiff)
    await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp])
    return r
  })
}

const initializeJuicenet = async ([deployer, a, b, noDeposit, withDeposit]: Wallet[]) => {
  await ethers.provider.send("evm_setNextBlockTimestamp", [startingTimeStamp])
  let stakingContract = await deployProxy(deployer)

  let addressGenerator = createRandomEthereumAddress()
  let tokens = [...Array(3)].map(addressGenerator)
  let tokenWithoutPriceOracle = addressGenerator()

  const DECIMALS = 10 ** 8
  const setPrice = (price: BigNumberish) => async (oracle: MockPriceOracle) => {
    await call(oracle.setPrice(price))
    await call(oracle.setPhaseId(1))
    return oracle
  }

  let oracles = [await call(new MockPriceOracle__factory(deployer).deploy()).then(setPrice(10 * DECIMALS)),
    await call(new MockPriceOracle__factory(deployer).deploy()).then(setPrice(20 * DECIMALS)),
    await call(new MockPriceOracle__factory(deployer).deploy()).then(setPrice(50 * DECIMALS))]

  let signalAggregator = await call(new MockSignalAggregator__factory(deployer).deploy())
  let signatureVerifier = await call(new MockSignatureVerifier__factory(deployer).deploy())

  await call(stakingContract.connect(deployer).mintJuice([noDeposit.address, withDeposit.address], [INIT_JUICE_SUPPLY / 2, INIT_JUICE_SUPPLY / 2]))
  await call(stakingContract.connect(withDeposit).deposit(INIT_JUICE_SUPPLY / 2))
  await call(stakingContract.connect(deployer).updatePriceOracles(tokens, oracles.map(x => x.address)))
  return {
    stakingContract,
    deployer,
    signalAggregator,
    accounts: [a, b],
    tokenWithoutPriceOracle,
    users: { noJuice: a, noDeposit, withDeposit },
    tokens,
    oracles,
    signatureVerifier,
  }
}

const getUpgradeableContract = async (name: string) => {
  let { sourceName, contractName } = await artifacts.readArtifact(name)
  let fqName = `${sourceName}:${contractName}`
  let buildInfo = await artifacts.getBuildInfo(fqName)
  if (!buildInfo) {
    throw new Error(`No build info for ${fqName}`)
  }
  let { input, output } = buildInfo
  let contractInfo = new UpgradeableContract(contractName, input, output, { kind: "uups" })
  return contractInfo
}

describe("Staking", () => {
  let deployer: Wallet, noJuice: Wallet, noDeposit: Wallet, withDeposit

  describe("Basic ERC-20 functionality", () => {
    let erc20: JuiceStaking02
    let withJuice: Wallet
    beforeEach(async () => {
      ({ stakingContract: erc20, deployer, users: { noJuice, noDeposit: withJuice } } = await loadFixture(initializeJuicenet))
    })

    it("symbol() == 'Juice'", async () => {
      expect(await erc20.symbol()).to.equal("JUICE")
    })

    it("decimals() == 8", async () => {
      expect(await erc20.decimals()).to.equal(TOKEN_DECIMALS)
    })

    it("totalSupply()", async () => {
      expect(await erc20.totalSupply()).to.equal(INIT_JUICE_SUPPLY)
    })

    it("balanceOf()", async () => {
      expect(await erc20.balanceOf(withJuice.address)).to.equal(INIT_JUICE_SUPPLY / 2)
    })

    it("transfer() ok", async () => {
      const transferAmount = INIT_JUICE_SUPPLY / 4
      let transfer = call(erc20.connect(withJuice).transfer(noJuice.address, transferAmount))
      await expect(() => transfer).to.changeTokenBalances(
        erc20,
        [withJuice, noJuice],
        [-transferAmount, transferAmount])
    })

    it("transferFrom() ok", async () => {
      await call(erc20.connect(withJuice).approve(noJuice.address, 10000))
      let transferFrom = call(erc20.connect(noJuice).transferFrom(withJuice.address, noJuice.address, 5000))
      await expect(() => transferFrom).to.changeTokenBalances(
        erc20,
        [withJuice, noJuice],
        [-5000, 5000])
    })

    it("transfer() reverts", async () => {
      await expect(erc20.connect(withJuice).transfer(noJuice.address, 1500000)).to.revertedWith("ERC20: transfer amount exceeds balance")
    })

    it("transferFrom() exceeds allowance", async () => {
      await expect(erc20.connect(noJuice).transferFrom(withJuice.address, noJuice.address, 50)).to.revertedWith("ERC20: transfer amount exceeds allowance")
    })

    it("transferFrom() exceeds balance", async () => {
      await erc20.connect(withJuice).approve(noJuice.address, 1000000)
      await expect(erc20.connect(noJuice).transferFrom(withJuice.address, noJuice.address, 1500000)).to.revertedWith("ERC20: transfer amount exceeds balance")
    })

    it("transfers fails when paused", async () => {
      await erc20.connect(deployer).emergencyPause(true)

      await expect(erc20.connect(withJuice).transfer(noJuice.address, 50)).to.revertedWith("JUICE is temporarily disabled")
      await erc20.connect(withJuice).approve(noJuice.address, 100)
      await expect(erc20.connect(noJuice).transferFrom(withJuice.address, noJuice.address, 50)).to.revertedWith("JUICE is temporarily disabled")
    })
  })

  describe("Deposits", () => {
    let stakingContract: JuiceStaking02
    let user: Wallet
    beforeEach(async () => {
      ({ stakingContract, users: { noJuice, noDeposit: user } } = await loadFixture(initializeJuicenet))
      stakingContract = stakingContract.connect(user)
    })

    it("works when depositing all JUICE", async () => {
      const deposit = INIT_JUICE_SUPPLY / 2
      let depositTx = call(stakingContract.deposit(deposit))
      await expect(() => depositTx).to.changeTokenBalances(
        stakingContract,
        [user, stakingContract],
        [-deposit, deposit])
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(deposit)
      expect(await getStateChanges(await depositTx)).to.matchSnapshot()
    })

    it("works when depositing a portion of JUICE", async () => {
      const deposit = INIT_JUICE_SUPPLY / 4
      let depositTx = call(stakingContract.deposit(deposit))
      await expect(() => depositTx).to.changeTokenBalances(
        stakingContract,
        [user, stakingContract],
        [-deposit, deposit])
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(deposit)
      expect(await getStateChanges(await depositTx)).to.matchSnapshot()
    })

    it("fails when depositing more than current balance", async () => {
      const deposit = INIT_JUICE_SUPPLY / 4 * 3
      const max = INIT_JUICE_SUPPLY / 2
      await expect(stakingContract.deposit(INIT_JUICE_SUPPLY / 4 * 3)).to.revertedWith(`InsufficientJUICE(${deposit}, ${max})`)
    })

    it("fails when paused", async () => {
      await stakingContract.connect(deployer).emergencyPause(true)
      await expect(stakingContract.deposit(150)).to.revertedWith("Pausable: paused")
    })
  })

  describe("Withdraws", () => {
    let stakingContract: JuiceStaking02
    let user: Wallet
    beforeEach(async () => {
      ({ stakingContract, users: { withDeposit: user, noDeposit } } = await loadFixture(initializeJuicenet))
      stakingContract = stakingContract.connect(user)
    })

    it("works when withdrawing all", async () => {
      const withdrawAmount = INIT_JUICE_SUPPLY / 2
      let tx = call(stakingContract.withdraw(withdrawAmount))
      await expect(tx).to.emit(stakingContract, "JUICEWithdrawn").withArgs(user.address, withdrawAmount)
      expect(await stakingContract.balanceOf(user.address)).to.equal(withdrawAmount)
      expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(0)
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0)
      expect(await getStateChanges(await tx)).to.matchSnapshot()
    })

    it("works when withdrawing a portion", async () => {
      const withdrawAmount = INIT_JUICE_SUPPLY / 8
      const max = INIT_JUICE_SUPPLY / 2
      let tx = call(stakingContract.withdraw(withdrawAmount))
      await expect(tx).to.emit(stakingContract, "JUICEWithdrawn").withArgs(user.address, withdrawAmount)
      expect(await stakingContract.balanceOf(user.address)).to.equal(withdrawAmount)
      expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(max - withdrawAmount)
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(max - withdrawAmount)
      expect(await getStateChanges(await tx)).to.matchSnapshot()
    })

    it("fails when withdrawing non-deposited JUICE", async () => {
      const withdrawAmount = INIT_JUICE_SUPPLY / 10
      await expect(stakingContract.connect(noDeposit).withdraw(withdrawAmount)).to.revertedWith(`InsufficientJUICE(${withdrawAmount}, 0)`)
    })

    it("fails when paused", async () => {
      await stakingContract.connect(deployer).emergencyPause(true)
      await expect(stakingContract.withdraw(INIT_JUICE_SUPPLY / 10)).to.revertedWith("Pausable: paused")
    })
  })

  type StakingParam = {
    token: string;
    amount: BigNumberish;
    sentiment: boolean;
  }

  type StakeHelper = { long: (amount: BigNumberish) => StakingParam; short: (amount: BigNumberish) => StakingParam }
  describe("Modifying Stakes", () => {
    let stakingContract: MockJuiceStaking
    let oracles: MockPriceOracle[], oracle: MockPriceOracle
    let tokens: string[]
    let token1: string, token2: string, token3: string, tokenWithoutPriceOracle: string
    let oracleAddresses: string[]
    let stake: StakeHelper
    let user: Wallet, user2: Wallet
    let currentStake: CurrentStakeHelper

    beforeEach(async () => {
      ({ stakingContract, oracles, tokenWithoutPriceOracle, tokens, users: { withDeposit: user, noDeposit: user2 } } = await loadFixture(initializeJuicenet));
      ([token1, token2, token3] = tokens)
      oracleAddresses = oracles.map(x => x.address)
      stake = Stakes(token1)
      oracle = oracles[0]
      currentStake = CurrentStake(stakingContract)
    })
    const Stakes = (token: string) => ({
      long: (amount: BigNumberish): StakingParam => ({ token, amount, sentiment: true }),
      short: (amount: BigNumberish): StakingParam => ({ token, amount, sentiment: false }),
    })

    describe("When no existing stake", () => {
      for (const expectedSentiment of [true, false]) {
        for (const [firstStake, testType] of [[0, "zero"], [1, "smallest possible"], [INIT_JUICE_SUPPLY / 10, "partial"], [INIT_JUICE_SUPPLY / 2, "100%"], [INIT_JUICE_SUPPLY / 4 * 3, "over 100%"]]) {
          let oraclePrice = 10 * (10 ** 8)
          let juiceAmount = firstStake as number
          // overstaking is limited to total unstaked balance
          const maxJuiceAmountSpent = INIT_JUICE_SUPPLY / 2
          let expectedJuiceAmountSpent = Math.min(juiceAmount, maxJuiceAmountSpent)

          // this isn't very readable but just want to verify that for same set of params, both the normal and delegated versions end up in the same state
          const verifySameEndResult = async (tx: Promise<ContractTransaction>) => {
            (await tx)
            let { juiceStake, juiceValue, currentPrice, sentiment } = await stakingContract.currentStake(user.address, token1)

            expect(juiceStake).to.equal(expectedJuiceAmountSpent)
            expect(juiceValue).to.equal(expectedJuiceAmountSpent) // equal to original stake because no price change
            expect(currentPrice).to.equal(oraclePrice)
            expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(maxJuiceAmountSpent - expectedJuiceAmountSpent)
            let { longTokens } = await stakingContract.normalizedAggregateSignal()
            if (firstStake > 0) {
              await expect(tx).to.emit(stakingContract, "StakeAdded").withArgs(user.address, token1, expectedSentiment, oraclePrice, -expectedJuiceAmountSpent)
              expect(sentiment).to.equal(expectedSentiment)

              if (expectedSentiment) {
                expect(longTokens.length).to.equal(1)
                let [{ token, weight }] = longTokens
                expect(token).to.equal(token1)
                expect(weight).to.equal(100)
              } else {
                expect(longTokens.length).to.equal(0)
              }
            } else {
              await expect(tx).to.not.emit(stakingContract, "StakeAdded")
              expect(sentiment).to.equal(false) // if stake amount is 0, it doesn't really exist in contract state so sentiment will be false always
              expect(longTokens.length).to.equal(0)
            }
          }

          let stakeType = expectedSentiment ? "long" : "short"
          it(`modifyStakes() adds a ${testType} ${stakeType} stake`, async () => {
            let stakes = [expectedSentiment ? stake.long(juiceAmount) : stake.short(juiceAmount)]
            let tx = call(stakingContract.connect(user).modifyStakes(stakes))
            await verifySameEndResult(tx)
            expect(await getStateChanges(await tx)).to.matchSnapshot()
          })

          it(`delegateModifyStakes() adds ${testType} ${stakeType} stake`, async () => {
            let stakes = [expectedSentiment ? stake.long(juiceAmount) : stake.short(juiceAmount)]
            let signedPermission = await SigningHelper(ethers.provider, stakingContract).signModifyStakes(stakes, user, 0)
            let tx = call(stakingContract.connect(deployer).delegateModifyStakes(stakes, signedPermission))
            await verifySameEndResult(tx)
            expect(await getStateChanges(await tx)).to.matchSnapshot()
          })
        }
      }
    })

    describe("Given single long and short position", () => {
      let stake1: StakeHelper, stake2: StakeHelper
      const initLongStakeAmount = INIT_JUICE_SUPPLY / 20 * 6
      const initShortStakeAmount = INIT_JUICE_SUPPLY / 20 * 4
      beforeEach(async () => {
        await call(stakingContract.connect(user).modifyStakes([stake.long(initLongStakeAmount), Stakes(token2).short(initShortStakeAmount)]))
        stake1 = Stakes(token1)
        stake2 = Stakes(token2)
      })

      describe("When price stays the same", () => {
        let oraclePrice = 10 * (10 ** 8)
        let oracle2Price = 20 * (10 ** 8)
        it("closing the long position mints no rewards", async () => {
          let tx = call(stakingContract.connect(user).modifyStakes([stake1.long(0)]))
          await tx
          let { juiceValue: a1 } = await stakingContract.currentStake(user.address, token1)
          let { juiceValue: a2 } = await stakingContract.currentStake(user.address, token2)
          expect(a1).to.equal(0)
          expect(a2).to.equal(initShortStakeAmount)

          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(initLongStakeAmount)
          expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(initLongStakeAmount + initShortStakeAmount)
          expect(await stakingContract.totalSupply()).to.equal(INIT_JUICE_SUPPLY)

          let { longTokens } = await stakingContract.normalizedAggregateSignal()
          expect(longTokens.length).to.equal(0)
          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token1, true, oraclePrice, initLongStakeAmount)
          expect(await getStateChanges(await tx)).to.matchSnapshot()
        })

        it("closing the short position mints no rewards", async () => {
          let tx = call(stakingContract.connect(user).modifyStakes([stake2.short(0)]))
          await tx
          let { juiceValue: a1 } = await stakingContract.currentStake(user.address, token1)
          let { juiceValue: a2 } = await stakingContract.currentStake(user.address, token2)
          expect(a1).to.equal(initLongStakeAmount)
          expect(a2).to.equal(0)

          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(initShortStakeAmount)
          expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(initLongStakeAmount + initShortStakeAmount)
          expect(await stakingContract.totalSupply()).to.equal(INIT_JUICE_SUPPLY)

          let { longTokens } = await stakingContract.normalizedAggregateSignal()
          expect(longTokens.length).to.equal(1)
          expect(longTokens.map(x => x.token)).to.eql([token1])
          expect(longTokens.map(x => x.weight.toNumber())).to.eql([100])
          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token2, false, oracle2Price, initShortStakeAmount)
          expect(await getStateChanges(await tx)).to.matchSnapshot()
        })

        it("switching long to short mints no rewards", async () => {
          let tx = call(stakingContract.connect(user).modifyStakes([stake1.short(initLongStakeAmount)]))
          await tx
          let { juiceValue: a1, sentiment } = await stakingContract.currentStake(user.address, token1)
          let { juiceValue: a2 } = await stakingContract.currentStake(user.address, token2)

          expect(sentiment).to.equal(false)
          expect(a1).to.equal(initLongStakeAmount)
          expect(a2).to.equal(initShortStakeAmount)

          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0)
          let { longTokens } = await stakingContract.normalizedAggregateSignal()
          expect(longTokens.length).to.equal(0)

          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token1, true, oraclePrice, initLongStakeAmount)
          await expect(tx).to.emit(stakingContract, "StakeAdded").withArgs(user.address, token1, false, oraclePrice, -initLongStakeAmount)
          expect(await getStateChanges(await tx)).to.matchSnapshot()
        })
        it("switching short to long mints no rewards", async () => {
          const token1Ratio = Math.round(initLongStakeAmount ** 2 / (initLongStakeAmount ** 2 + initShortStakeAmount ** 2) * 100)
          const token2Ratio = Math.round(initShortStakeAmount ** 2 / (initLongStakeAmount ** 2 + initShortStakeAmount ** 2) * 100)
          let tx = call(stakingContract.connect(user).modifyStakes([stake2.long(initShortStakeAmount)]))
          await tx
          let { juiceValue: a1 } = await stakingContract.currentStake(user.address, token1)
          let { juiceValue: a2, sentiment } = await stakingContract.currentStake(user.address, token2)

          expect(sentiment).to.equal(true)
          expect(a1).to.equal(initLongStakeAmount)
          expect(a2).to.equal(initShortStakeAmount)

          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0)
          let { longTokens } = await stakingContract.normalizedAggregateSignal()
          expect(longTokens.length).to.equal(2)
          expect(longTokens.map(x => x.token)).to.eql([token1, token2])
          expect(longTokens.map(x => x.weight.toNumber())).to.eql([token1Ratio, token2Ratio])

          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token2, false, oracle2Price, initShortStakeAmount)
          await expect(tx).to.emit(stakingContract, "StakeAdded").withArgs(user.address, token2, true, oracle2Price, -initShortStakeAmount)
          expect(await getStateChanges(await tx)).to.matchSnapshot()
        })
      })

      describe("When price goes up 50%", () => {
        let newPrice1 = 15 * (10 ** 8)
        let newPrice2 = 30 * (10 ** 8)
        beforeEach(async () => {
          await call(oracles[0].connect(deployer).setPrice(newPrice1))
          await call(oracles[1].connect(deployer).setPrice(newPrice2))
        })

        it("closing long position mints rewards", async () => {
          const juiceAmountChange = initLongStakeAmount * 1.5 - initLongStakeAmount
          expect(await currentStake(user.address, token1)).to.include({ juiceValue: initLongStakeAmount + juiceAmountChange, juiceStake: initLongStakeAmount, currentPrice: newPrice1 })

          let tx = call(stakingContract.connect(user).modifyStakes([stake1.long(0)]))
          await tx

          expect(await currentStake(user.address, token1)).to.include({ juiceValue: 0, juiceStake: 0 })
          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(initLongStakeAmount + juiceAmountChange)
          expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(initLongStakeAmount + juiceAmountChange + initShortStakeAmount)
          expect(await stakingContract.totalSupply()).to.equal(INIT_JUICE_SUPPLY + juiceAmountChange)
          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token1, true, newPrice1, initLongStakeAmount + juiceAmountChange)
          expect(await getStateChanges(await tx)).to.matchSnapshot()
        })

        it("closing short position burns rewards", async () => {
          const juiceAmountChange = -initShortStakeAmount / 2
          expect(await currentStake(user.address, token2)).to.include({ juiceValue: initShortStakeAmount + juiceAmountChange, juiceStake: initShortStakeAmount, currentPrice: newPrice2 })

          let tx = call(stakingContract.connect(user).modifyStakes([stake2.short(0)]))
          await tx

          expect(await currentStake(user.address, token2)).to.include({ juiceValue: 0, juiceStake: 0 })
          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(initShortStakeAmount + juiceAmountChange)
          expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(initLongStakeAmount + initShortStakeAmount + juiceAmountChange)
          expect(await stakingContract.totalSupply()).to.equal(INIT_JUICE_SUPPLY + juiceAmountChange)
          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token2, false, newPrice2, -juiceAmountChange)
          expect(await getStateChanges(await tx)).to.matchSnapshot()
        })
      })

      describe("When price goes down 50%", () => {
        let newPrice1 = 5 * (10 ** 8)
        let newPrice2 = 10 * (10 ** 8)
        beforeEach(async () => {
          await call(oracles[0].connect(deployer).setPrice(newPrice1))
          await call(oracles[1].connect(deployer).setPrice(newPrice2))
        })

        it("closing long position burns rewards", async () => {
          const juiceAmountChange = -initLongStakeAmount / 2
          expect(await currentStake(user.address, token1)).to.include({ juiceValue: initLongStakeAmount + juiceAmountChange, juiceStake: initLongStakeAmount, currentPrice: newPrice1 })

          let tx = call(stakingContract.connect(user).modifyStakes([stake1.long(0)]))
          await tx

          expect(await currentStake(user.address, token1)).to.include({ juiceValue: 0, juiceStake: 0 })
          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(initLongStakeAmount + juiceAmountChange)
          expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(initLongStakeAmount + initShortStakeAmount + juiceAmountChange)
          expect(await stakingContract.totalSupply()).to.equal(INIT_JUICE_SUPPLY + juiceAmountChange)
          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token1, true, newPrice1, -juiceAmountChange)
          expect(await getStateChanges(await tx)).to.matchSnapshot()
        })

        it("closing short position mints rewards", async () => {
          const juiceAmountChange = initShortStakeAmount / 2
          expect(await currentStake(user.address, token2)).to.include({ juiceValue: initShortStakeAmount + juiceAmountChange, juiceStake: initShortStakeAmount, currentPrice: newPrice2 })

          let tx = call(stakingContract.connect(user).modifyStakes([stake2.short(0)]))
          await tx

          expect(await currentStake(user.address, token2)).to.include({ juiceValue: 0, juiceStake: 0 })
          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(initShortStakeAmount + juiceAmountChange)
          expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(initLongStakeAmount + initShortStakeAmount + juiceAmountChange)
          expect(await stakingContract.totalSupply()).to.equal(INIT_JUICE_SUPPLY + juiceAmountChange)
          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token2, false, newPrice2, initShortStakeAmount + juiceAmountChange)
          expect(await getStateChanges(await tx)).to.matchSnapshot()
        })
      })

      describe("When price goes down 100%", () => {
        let newPrice1 = 0
        let newPrice2 = 0
        beforeEach(async () => {
          await call(oracles[0].connect(deployer).setPrice(newPrice1))
          await call(oracles[1].connect(deployer).setPrice(newPrice2))
        })

        it("closing long position goes worthless", async () => {
          expect(await currentStake(user.address, token1)).to.include({ juiceValue: 0, juiceStake: initLongStakeAmount, currentPrice: newPrice1 })

          let tx = call(stakingContract.connect(user).modifyStakes([stake1.long(0)]))
          await tx

          expect(await currentStake(user.address, token1)).to.include({ juiceValue: 0, juiceStake: 0 })
          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0)
          expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(initShortStakeAmount)
          expect(await stakingContract.totalSupply()).to.equal(INIT_JUICE_SUPPLY - initLongStakeAmount)
          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token1, true, newPrice1, 0)
          expect(await getStateChanges(await tx)).to.matchSnapshot()
        })

        it("closing short position doubles the stake", async () => {
          expect(await currentStake(user.address, token2)).to.include({ juiceValue: initShortStakeAmount * 2, juiceStake: initShortStakeAmount, currentPrice: newPrice2 })

          let tx = call(stakingContract.connect(user).modifyStakes([stake2.short(0)]))
          await tx

          expect(await currentStake(user.address, token2)).to.include({ juiceValue: 0, juiceStake: 0 })
          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(initShortStakeAmount * 2)
          expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(initShortStakeAmount * 2 + initLongStakeAmount)
          expect(await stakingContract.totalSupply()).to.equal(INIT_JUICE_SUPPLY + initShortStakeAmount)
          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token2, false, newPrice2, initShortStakeAmount * 2)
          expect(await getStateChanges(await tx)).to.matchSnapshot()
        })
      })

      describe("When price goes up 200%", () => {
        let newPrice1 = 30 * (10 ** 8)
        let newPrice2 = 60 * (10 ** 8)
        beforeEach(async () => {
          await call(oracles[0].connect(deployer).setPrice(newPrice1))
          await call(oracles[1].connect(deployer).setPrice(newPrice2))
        })

        it("closing long position triples", async () => {
          expect(await currentStake(user.address, token1)).to.include({ juiceValue: initLongStakeAmount * 3, juiceStake: initLongStakeAmount, currentPrice: newPrice1 })

          let tx = call(stakingContract.connect(user).modifyStakes([stake1.long(0)]))
          await tx

          expect(await currentStake(user.address, token1)).to.include({ juiceValue: 0, juiceStake: 0 })
          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(initLongStakeAmount * 3)
          expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(initLongStakeAmount * 3 + initShortStakeAmount)
          expect(await stakingContract.totalSupply()).to.equal(INIT_JUICE_SUPPLY + initLongStakeAmount * 2)
          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token1, true, newPrice1, initLongStakeAmount * 3)
          expect(await getStateChanges(await tx)).to.matchSnapshot()
        })

        it("closing short position is worthless but doesn't go negative", async () => {
          expect(await currentStake(user.address, token2)).to.include({ juiceValue: 0, juiceStake: initShortStakeAmount, currentPrice: newPrice2 })

          let tx = call(stakingContract.connect(user).modifyStakes([stake2.short(0)]))
          await tx

          expect(await currentStake(user.address, token2)).to.include({ juiceValue: 0, juiceStake: 0 })
          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0)
          expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(initLongStakeAmount)
          expect(await stakingContract.totalSupply()).to.equal(INIT_JUICE_SUPPLY - initShortStakeAmount)
          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token2, false, newPrice2, 0)
          expect(await getStateChanges(await tx)).to.matchSnapshot()
        })
      })
    })

    it("whitepaper example works", async () => {
      await call(stakingContract.connect(user2).deposit(1000000))

      for (const oracle of oracles) {
        await oracle.setPrice(100000000)
      }
      let token1Stake = Stakes(token1)
      let token2Stake = Stakes(token2)
      let token3Stake = Stakes(token3)
      let tx1 = await call(stakingContract.connect(user).modifyStakes([
        token1Stake.long(100),
        token2Stake.long(50),
      ]))
      let tx2 = await call(stakingContract.connect(user2).modifyStakes([
        token1Stake.short(50),
        token3Stake.short(25),
      ]))

      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(999850)
      expect(await stakingContract.unstakedBalanceOf(user2.address)).to.equal(999925)

      let { longTokens } = await stakingContract.normalizedAggregateSignal()
      expect(longTokens.length).to.equal(2)
      expect(longTokens.map(x => x.token)).to.eql([token1, token2])
      expect(longTokens.map(x => x.weight.toNumber())).to.eql([25, 8])
      expect(await getStateChanges(tx1)).to.matchSnapshot()
      expect(await getStateChanges(tx2)).to.matchSnapshot()
    })

    it.skip("stakes in the same block with price change always get the changed price", async () => {
      // helper function to extract the transaction ordering data
      const txOrder = async (tx: ContractTransaction) => {
        let { transactionIndex, blockNumber } = await tx.wait()
        return {
          transactionIndex, blockNumber,
        }
      }
      let [priceOracle] = oracles
      try {
        const oldPrice = 10 * (10 ** 8)
        const newPrice = 20 * (10 ** 8)
        // just ensure that current price isn't equal to the new price
        expect(await priceOracle.latestPrice()).to.equal(oldPrice)
        const firstStake = INIT_JUICE_SUPPLY / 4

        // set automine off to control the tx ordering
        await ethers.provider.send("evm_setAutomine", [false])
        let openTx = await stakingContract.connect(user).modifyStakes([stake.long(firstStake)])
        let priceChangeTx = await priceOracle.setPrice(newPrice)
        await ethers.provider.send("evm_mine", [])
        await ethers.provider.send("evm_setNextBlockTimestamp", [await ethers.provider.getBlock("latest").then(b => b.timestamp + callTimeDiff)])

        // make sure that staking tx happened before the price change tx
        let openReceipt = await txOrder(openTx)
        let priceChangeReceipt = await txOrder(priceChangeTx)
        expect(openReceipt.blockNumber).to.be.equal(priceChangeReceipt.blockNumber)
        expect(openReceipt.transactionIndex).to.be.lessThan(priceChangeReceipt.transactionIndex)
        expect(await currentStake(user.address, token1)).to.include({ juiceStake: firstStake, juiceValue: firstStake, currentPrice: newPrice, sentiment: true })

        let closeTx = await stakingContract.connect(user).modifyStakes([stake.long(0)])
        await ethers.provider.send("evm_mine", [])
        await expect(closeTx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token1, true, newPrice, firstStake)

        expect(await getStateChanges(openTx)).to.matchSnapshot()
        expect(await getStateChanges(closeTx)).to.matchSnapshot()
      } finally {
        await ethers.provider.send("evm_setAutomine", [true])
      }
    })

    it("adding second stake removes the first", async () => {
      let [priceOracle] = oracles
      let price = 314252688830
      const firstStake = INIT_JUICE_SUPPLY / 4
      const secondStake = INIT_JUICE_SUPPLY / 2
      await call(priceOracle.setPrice(price))

      let tx1 = call(stakingContract.connect(user).modifyStakes([stake.long(firstStake)]))
      await expect(tx1).to.emit(stakingContract, "StakeAdded").withArgs(user.address, token1, true, price, -firstStake)

      let tx2 = call(stakingContract.connect(user).modifyStakes([stake.long(secondStake)]))
      await expect(tx2).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token1, true, price, firstStake)
      await expect(tx2).to.emit(stakingContract, "StakeAdded").withArgs(user.address, token1, true, price, -secondStake)

      let { juiceValue, sentiment } = await stakingContract.currentStake(user.address, token1)
      expect(juiceValue).to.equal(secondStake)
      expect(sentiment).to.equal(true)
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0)

      expect(await getStateChanges(await tx1)).to.matchSnapshot()
      expect(await getStateChanges(await tx2)).to.matchSnapshot()
    })

    it("adding second stake removes the first also in shorts", async () => {
      let [priceOracle] = oracles
      let price = 314252688830
      const firstStake = INIT_JUICE_SUPPLY / 4
      const secondStake = INIT_JUICE_SUPPLY / 2
      await call(priceOracle.setPrice(price))

      let tx1 = call(stakingContract.connect(user).modifyStakes([stake.short(firstStake)]))
      await expect(tx1).to.emit(stakingContract, "StakeAdded").withArgs(user.address, token1, false, price, -firstStake)

      let tx2 = call(stakingContract.connect(user).modifyStakes([stake.short(secondStake)]))
      await expect(tx2).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token1, false, price, firstStake)
      await expect(tx2).to.emit(stakingContract, "StakeAdded").withArgs(user.address, token1, false, price, -secondStake)

      let { juiceValue, currentPrice, sentiment } = await stakingContract.currentStake(user.address, token1)
      expect(juiceValue).to.equal(secondStake)
      expect(currentPrice).to.equal(price)
      expect(sentiment).to.equal(false)
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0)

      expect(await getStateChanges(await tx1)).to.matchSnapshot()
      expect(await getStateChanges(await tx2)).to.matchSnapshot()
    })

    it("shorts can only lose the staked amount", async () => {
      let totalAmount = INIT_JUICE_SUPPLY / 2
      let [priceOracle] = oracles
      let price = 314252688830n
      let stakedAmount = totalAmount / 2
      // to have totalsupply amounts match with a fixture that creates multiple users
      let nonUserTotalAmount = INIT_JUICE_SUPPLY / 2

      await call(priceOracle.setPrice(price))
      let tx1 = await call(stakingContract.connect(user).modifyStakes([stake.short(stakedAmount)]))
      let { juiceValue, sentiment } = await stakingContract.currentStake(user.address, token1)
      expect(juiceValue).to.equal(stakedAmount)
      expect(sentiment).to.equal(false)
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(totalAmount - stakedAmount)
      expect(await stakingContract.totalSupply()).to.equal(nonUserTotalAmount + totalAmount)
      expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(totalAmount)

      // hike the price up 200%
      price = 3n * price
      await call(priceOracle.setPrice(price))
      let tx2 = call(stakingContract.connect(user).modifyStakes([stake.short(0)]))
      await expect(tx2).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token1, false, price, 0);

      ({ juiceValue, sentiment } = await stakingContract.currentStake(user.address, token1))
      expect(juiceValue).to.equal(0)
      expect(sentiment).to.equal(false)
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(totalAmount - stakedAmount)
      // closing position at loss burns Juice
      expect(await stakingContract.totalSupply()).to.equal(nonUserTotalAmount + totalAmount - stakedAmount)
      expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(totalAmount - stakedAmount)

      expect(await getStateChanges(tx1)).to.matchSnapshot()
      expect(await getStateChanges(await tx2)).to.matchSnapshot()
    })

    it("refunds the original amount when closing a stake after price oracle has been removed", async () => {
      let [priceOracle] = oracles
      let price = 314252688830
      const depositAmount = INIT_JUICE_SUPPLY / 8
      const user1Stake = 500000
      const user2Stake = 250000
      await call(stakingContract.connect(user2).deposit(depositAmount))
      await call(priceOracle.setPrice(price))
      let [expectedUser1Balance, expectedUser2Balance] = await Promise.all([
        stakingContract.unstakedBalanceOf(user.address),
        stakingContract.unstakedBalanceOf(user2.address)])
      let tx1 = await call(stakingContract.connect(user).modifyStakes([stake.long(user1Stake)]))

      let tx2 = await call(stakingContract.connect(user2).modifyStakes([stake.short(user2Stake)]))
      let { totalLongs: longsBefore, totalShorts: shortsBefore } = await stakingContract.getTokenSignal(token1)
      expect(longsBefore).to.equal(user1Stake)
      expect(shortsBefore).to.equal(user2Stake)
      {
        let {
          netSentiment,
          totalVolume,
          totalLongSentiment,
        } = await stakingContract.getInternalAggregate()
        expect(netSentiment).to.equal(user1Stake - user2Stake)
        expect(totalVolume).to.equal(user1Stake + user2Stake)
        expect(totalLongSentiment).to.equal(3333)
      }

      // make price go up 50% to verify that removing price oracle will affect in juice value calculations in both long and short positions
      let newPrice = Math.floor(price * 1.5)
      await call(priceOracle.setPrice(newPrice))
      expect(await currentStake(user.address, token1)).to.include({ juiceStake: user1Stake, juiceValue: user1Stake * 1.5, currentPrice: newPrice, sentiment: true })
      expect(await currentStake(user2.address, token1)).to.include({ juiceStake: user2Stake, juiceValue: user2Stake / 2, currentPrice: newPrice, sentiment: false })

      await call(stakingContract.connect(deployer).updatePriceOracles([token1], [ethers.constants.AddressZero]))

      expect(await currentStake(user.address, token1)).to.include({ juiceStake: user1Stake, juiceValue: user1Stake, currentPrice: 0, sentiment: true })
      expect(await currentStake(user2.address, token1)).to.include({ juiceStake: user2Stake, juiceValue: user2Stake, currentPrice: 0, sentiment: false })

      let tx3 = await call(stakingContract.connect(user).modifyStakes([stake.long(0)]))
      let tx4 = await call(stakingContract.connect(user2).modifyStakes([stake.short(0)]))

      await expect(tx3).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token1, true, 0, user1Stake)
      await expect(tx4).to.emit(stakingContract, "StakeRemoved").withArgs(user2.address, token1, false, 0, user2Stake)
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(expectedUser1Balance)
      expect(await stakingContract.unstakedBalanceOf(user2.address)).to.equal(expectedUser2Balance)
      let { totalLongs, totalShorts } = await stakingContract.getTokenSignal(token1)
      expect(totalLongs).to.equal(0)
      expect(totalShorts).to.equal(0)
      let { netSentiment, totalVolume, totalLongSentiment } = await stakingContract.getInternalAggregate()
      expect(netSentiment).to.equal(0)
      expect(totalVolume).to.equal(0)
      expect(totalLongSentiment).to.equal(0)

      expect(await getStateChanges(tx1)).to.matchSnapshot()
      expect(await getStateChanges(tx2)).to.matchSnapshot()
      expect(await getStateChanges(tx3)).to.matchSnapshot()
      expect(await getStateChanges(tx4)).to.matchSnapshot()
    })

    it("fails when paused", async () => {
      await stakingContract.connect(deployer).emergencyPause(true)
      let tx = stakingContract.connect(user).modifyStakes([
        stake.long(INIT_JUICE_SUPPLY / 10),
      ])
      await expect(tx).to.revertedWith("Pausable: paused")
    })

    it("fails when staking token without price oracle", async () => {
      let tx = stakingContract.connect(user).modifyStakes([Stakes(tokenWithoutPriceOracle).long(INIT_JUICE_SUPPLY / 10)])
      await expect(tx).to.revertedWith(`InvalidToken("${tokenWithoutPriceOracle}")`)
    })

    it("no-op when staking 0", async () => {
      let [priceOracle] = oracles
      const price = 100000000
      await priceOracle.setPrice(100000000)
      let tx = call(stakingContract.connect(user).modifyStakes([stake.long(0)]))
      await expect(tx).to.not.emit(stakingContract, "StakeAdded")

      let { juiceValue, sentiment } = await stakingContract.currentStake(user.address, token1)
      expect(juiceValue).to.equal(0)
      expect(sentiment).to.equal(false)
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(INIT_JUICE_SUPPLY / 2)
      expect(await getStateChanges(await tx)).to.matchSnapshot()
    })

    it("stake is limited when overstaking", async () => {
      let [priceOracle] = oracles
      await priceOracle.setPrice(100000000)
      let tx = await call(stakingContract.connect(user).modifyStakes([stake.long(INIT_JUICE_SUPPLY / 2 * 1.5)]))
      let { juiceValue, sentiment } = await stakingContract.currentStake(user.address, token1)
      expect(juiceValue).to.equal(INIT_JUICE_SUPPLY / 2)
      expect(sentiment).to.equal(true)
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0)
      expect(await getStateChanges(tx)).to.matchSnapshot()
    })

    it("Staking max of one token leaves zero for the other token", async () => {
      let tx = await call(stakingContract.connect(user).modifyStakes([Stakes(token1).long(INIT_JUICE_SUPPLY * 2), Stakes(token2).long(INIT_JUICE_SUPPLY / 4)]))
      let { juiceValue: a1 } = await stakingContract.currentStake(user.address, token1)
      let { juiceValue: a2, sentiment } = await stakingContract.currentStake(user.address, token2)

      expect(sentiment).to.equal(false)
      expect(a1).to.equal(INIT_JUICE_SUPPLY / 2)
      expect(a2).to.equal(0)
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0)
      expect(await getStateChanges(tx)).to.matchSnapshot()
    })

    it("Staking one token atomically twice uses the latter stake", async () => {
      const realStake = INIT_JUICE_SUPPLY / 20 * 6
      let tx = await call(stakingContract.connect(user).modifyStakes([Stakes(token1).long(INIT_JUICE_SUPPLY / 4), Stakes(token1).short(realStake)]))
      let { juiceValue: a1, sentiment } = await stakingContract.currentStake(user.address, token1)
      expect(sentiment).to.equal(false)
      expect(a1).to.equal(realStake)
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal((INIT_JUICE_SUPPLY / 2) - realStake)
      expect(await getStateChanges(tx)).to.matchSnapshot()
    })
  })

  describe("Updating Price Oracles", () => {
    let stakingContract: MockJuiceStaking
    let oracles: Contract[]
    let tokens: string[]
    let token1: string, token2: string, token3: string
    let oracle1: string, oracle2: string, oracle3: string
    let nonOwner: Wallet, arbitrary: Wallet
    let zero_address = "0x0000000000000000000000000000000000000000"
    let tokenWithoutPriceOracle: string
    beforeEach(async () => {
      ({ stakingContract, oracles, tokens, tokenWithoutPriceOracle, accounts: [nonOwner, arbitrary] } = await loadFixture(initializeJuicenet));
      ([token1, token2, token3] = tokens);
      ([oracle1, oracle2, oracle3] = oracles.map(x => x.address))
    })

    describe("when executed by owner", () => {
      let priceOracles

      beforeEach(async () => {
        stakingContract = stakingContract.connect(deployer)
      })

      it("doesn't revert", async () => {
        await stakingContract.updatePriceOracles([token1, token2], [oracle1, oracle2])
      })
      it("adds an oracle", async () => {
        let mock = await call(deployMockContract(deployer, IPriceOracle__factory.abi))
        await mock.mock.decimals.returns(8)
        let tx = await call(stakingContract.updatePriceOracles([arbitrary.address], [mock.address]))
        expect(await stakingContract.hasRegisteredToken(arbitrary.address)).to.equal(true)
        expect(await stakingContract.getPriceOracle(arbitrary.address)).to.equal(mock.address)
        expect(await getStateChanges(tx)).to.matchSnapshot()
      })
      it("removes a single token and its oracle", async () => {
        let tx = await call(stakingContract.updatePriceOracles([token1, token2], [zero_address, oracle2]))
        expect(await stakingContract.hasRegisteredToken(token1)).to.equal(false)
        expect(await stakingContract.hasRegisteredToken(token2)).to.equal(true)
        expect(await stakingContract.getPriceOracle(token1)).to.equal(zero_address)
        expect(await stakingContract.getPriceOracle(token2)).to.equal(oracle2)
        expect(await getStateChanges(tx)).to.matchSnapshot()
      })
      it("removes multiple tokens and their oracles", async () => {
        let tx = await call(stakingContract.updatePriceOracles([token1, token2, token3], [zero_address, oracle2, zero_address]))
        expect(await stakingContract.hasRegisteredToken(token1)).to.equal(false)
        expect(await stakingContract.hasRegisteredToken(token2)).to.equal(true)
        expect(await stakingContract.hasRegisteredToken(token3)).to.equal(false)
        expect(await stakingContract.getPriceOracle(token1)).to.equal(zero_address)
        expect(await stakingContract.getPriceOracle(token2)).to.equal(oracle2)
        expect(await stakingContract.getPriceOracle(token3)).to.equal(zero_address)
        expect(await getStateChanges(tx)).to.matchSnapshot()
      })
      it("changes oracle on re-register", async () => {
        let [{ token, oracle: previousOracle }] = await stakingContract.getRegisteredTokensAndOracles()
        expect(previousOracle).to.not.equal(oracle2)
        let tx = await call(stakingContract.updatePriceOracles([token], [oracle2]))
        let [{ token: newToken, oracle }] = await stakingContract.getRegisteredTokensAndOracles()
        expect(newToken).to.equal(token)
        expect(oracle).to.equal(oracle2)
        expect(await getStateChanges(tx)).to.matchSnapshot()
      })
      it("does nothing when re-registering same token-oracle pair", async () => {
        let expected = await stakingContract.getRegisteredTokensAndOracles()
        let [{ token: expectedToken, oracle: expectedOracle }] = expected

        let tx = await call(stakingContract.updatePriceOracles([expectedToken], [expectedOracle]))

        let actual = await stakingContract.getRegisteredTokensAndOracles()
        expect(actual.length).to.equal(expected.length)
        expect(actual[0].token).to.equal(expectedToken)
        expect(actual[0].oracle).to.equal(expectedOracle)
        expect(await getStateChanges(tx)).to.matchSnapshot()
      })

      it("does nothing when removing a non-existent token", async () => {
        let expected = await stakingContract.getRegisteredTokensAndOracles()
        let tx = await call(stakingContract.updatePriceOracles([tokenWithoutPriceOracle], [ethers.constants.AddressZero]))
        expect(await stakingContract.getRegisteredTokensAndOracles()).to.eql(expected)
        expect(await getStateChanges(tx)).to.matchSnapshot()
      })

      it("fails when input array lengths mismatch", async () => {
        await expect(stakingContract.updatePriceOracles([token1], [oracle1, oracle2])).to.revertedWith("TokenOracleMismatch(1, 2)")
        await expect(stakingContract.updatePriceOracles([token1, token2], [oracle1])).to.revertedWith("TokenOracleMismatch(2, 1)")
      })
      it("fails when price oracle has wrong decimals", async () => {
        let mock = await deployMockContract(deployer, IPriceOracle__factory.abi)
        await mock.mock.decimals.returns(18)

        await expect(stakingContract.updatePriceOracles([token1, token2], [oracle1, mock.address])).to.revertedWith("OracleDecimalMismatch(8, 18)")
      })
    })

    describe("when executed by non-owner", () => {
      it("fails always", async () => {
        await expect(stakingContract.connect(nonOwner).updatePriceOracles([token1, token2], [oracle1, oracle2])).to.revertedWith("Ownable: caller is not the owner")
      })
    })
  })

  describe("Minting", () => {
    let stakingContract: JuiceStaking02
    let a:Wallet, b: Wallet
    beforeEach(async () => {
      ({ stakingContract, accounts: [a, b] } = await loadFixture(initializeJuicenet))
    })

    describe("when executed by owner", () => {
      it("minting any amount to any address works", async () => {
        let tx = await call(stakingContract.connect(deployer).mintJuice([b.address], [100]))
        expect(await stakingContract.balanceOf(b.address)).to.equal(BigNumber.from(100))
        expect(await getStateChanges(tx)).to.matchSnapshot()
      })

      it("minting fails if input array lengths differ", async () => {
        await expect(stakingContract.connect(deployer).mintJuice([a.address, b.address], [100])).to.be.revertedWith("MintTargetMismatch(2, 1)")
        await expect(stakingContract.connect(deployer).mintJuice([a.address], [100, 200, 300])).to.be.revertedWith("MintTargetMismatch(1, 3)")
      })
    })

    describe("when executed by non-owner", () => {
      it("minting any amount to any address reverts", async () => {
        await expect(stakingContract.connect(a).mintJuice([a.address], [100])).to.revertedWith("Ownable: caller is not the owner")
      })
    })
  })

  describe("Aggregating signal", () => {
    let stakingContract: JuiceStaking02
    let signalAggregator: MockSignalAggregator
    let nonOwner: Wallet
    beforeEach(async () => {
      ({ stakingContract, signalAggregator, accounts: [nonOwner] } = await loadFixture(initializeJuicenet))
    })

    describe("when executed by owner", () => {
      it("sets the signal aggregator", async () => {
        expect(await stakingContract.signalAggregator()).to.equal(ethers.constants.AddressZero)

        let tx1 = await call(stakingContract.connect(deployer).authorizeSignalAggregator(signalAggregator.address))
        expect(await stakingContract.signalAggregator()).to.equal(signalAggregator.address)

        let tx2 = await call(stakingContract.connect(deployer).authorizeSignalAggregator(ethers.constants.AddressZero))
        expect(await stakingContract.signalAggregator()).to.equal(ethers.constants.AddressZero)

        expect(await getStateChanges(tx1)).to.matchSnapshot()
        expect(await getStateChanges(tx2)).to.matchSnapshot()
      })
    })

    describe("when executed by non-owner", () => {
      it("fails always", async () => {
        expect(stakingContract.connect(nonOwner).authorizeSignalAggregator(signalAggregator.address)).to.be.revertedWith("Ownable: caller is not the owner")
      })
    })
  })

  describe("Pausing", () => {
    let stakingContract: JuiceStaking02
    let a: Wallet, b: Wallet
    beforeEach(async () => {
      ({ stakingContract, deployer, users: { noDeposit: a, noJuice: b } } = await loadFixture(initializeJuicenet))
    })

    describe("when executed by owner", () => {
      it("pausing and unpausing works", async () => {
        let tx1 = await call(stakingContract.connect(deployer).emergencyPause(true))
        await expect(stakingContract.connect(a).transfer(b.address, 50)).to.revertedWith("JUICE is temporarily disabled")
        await expect(stakingContract.connect(a).deposit(150)).to.revertedWith("Pausable: paused")
        let tx2 = await call(stakingContract.connect(deployer).emergencyPause(false))
        await expect(() => stakingContract.connect(a).transfer(b.address, 50)).to.changeTokenBalances(
          stakingContract,
          [a, b],
          [-50, 50])

        expect(await getStateChanges(tx1)).to.matchSnapshot()
        expect(await getStateChanges(tx2)).to.matchSnapshot()
      })
      it("fails if pausing when already paused", async () => {
        await stakingContract.connect(deployer).emergencyPause(true)
        await expect(stakingContract.connect(deployer).emergencyPause(true)).to.be.revertedWith("Pausable: paused")
      })

      it("fails if unpausing when already unpaused", async () => {
        await expect(stakingContract.connect(deployer).emergencyPause(false)).to.be.revertedWith("Pausable: not paused")
      })
    })

    describe("when executed by non-owner", () => {
      it("fails always", async () => {
        await expect(stakingContract.connect(a).emergencyPause(true)).to.be.revertedWith("Ownable: caller is not the owner")
      })
    })
  })

  describe("Delegating deposit and withdraw", () => {
    let stakingContract: JuiceStaking02
    let signatureVerifier: MockSignatureVerifier
    let user: Wallet
    let helper: { signDeposit: any; signWithdraw: any; domain?: () => Promise<{ name: string; version: string; chainId: number; verifyingContract: string }>; signModifyStakes?: (stakes: { sentiment: boolean; token: string; amount: BigNumberish }[], user: Wallet, nonce: number, deadline?: number) => Promise<{ data: { sender: string; deadline: number; nonce: number }; signature: string }> }
    beforeEach(async () => {
      ({ stakingContract, signatureVerifier, users: { noDeposit: user } } = await loadFixture(initializeJuicenet))
      helper = SigningHelper(ethers.provider, stakingContract)
      stakingContract = stakingContract.connect(deployer)
    })

    it("makes single deposit", async () => {
      let amount = 1000000
      let tx = await call(stakingContract.delegateDeposit(amount, await helper.signDeposit(amount, user, 0)))
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(amount)
      expect(await getStateChanges(tx)).to.matchSnapshot()
    })

    it("makes two deposits with subsequent nonces", async () => {
      let amount = 100000
      let tx = await call(stakingContract.delegateDeposit(amount, await helper.signDeposit(amount, user, 0)))
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(amount)

      let tx2 = await call(stakingContract.delegateDeposit(amount, await helper.signDeposit(amount, user, 1)))
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(amount * 2)

      expect(await getStateChanges(tx)).to.matchSnapshot()
      expect(await getStateChanges(tx2)).to.matchSnapshot()
    })

    it("makes deposit and withdraw with subsequent nonces", async () => {
      let amount = 100000
      let tx = await call(stakingContract.delegateDeposit(amount, await helper.signDeposit(amount, user, 0)))
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(amount)

      let tx2 = await call(stakingContract.delegateWithdraw(amount, await helper.signWithdraw(amount, user, 1)))
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0)

      expect(await getStateChanges(tx)).to.matchSnapshot()
      expect(await getStateChanges(tx2)).to.matchSnapshot()
    })

    it("makes deposit and two withdraws with subsequent nonces", async () => {
      let amount = 100000
      let tx = await call(stakingContract.delegateDeposit(amount, await helper.signDeposit(amount, user, 0)))
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(amount)

      let tx1 = await call(stakingContract.delegateWithdraw(amount / 2, await helper.signWithdraw(amount / 2, user, 1)))
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(amount / 2)

      let tx2 = await call(stakingContract.delegateWithdraw(amount / 2, await helper.signWithdraw(amount / 2, user, 2)))
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0)

      expect(await getStateChanges(tx)).to.matchSnapshot()
      expect(await getStateChanges(tx1)).to.matchSnapshot()
      expect(await getStateChanges(tx2)).to.matchSnapshot()
    })

    it("fails when nonce not the latest", async () => {
      await expect(stakingContract.delegateDeposit(1, await helper.signDeposit(1, user, 100))).to.be.revertedWith("InvalidNonce()")
      await expect(stakingContract.delegateWithdraw(1, await helper.signWithdraw(1, user, 100))).to.be.revertedWith("InvalidNonce()")
    })

    it("fails when reusing nonce", async () => {
      await stakingContract.delegateDeposit(100, await helper.signDeposit(100, user, 0))
      await expect(stakingContract.delegateDeposit(100, await helper.signDeposit(100, user, 0))).to.be.revertedWith("InvalidNonce()")
    })

    it("fails when signature doesn't match the arguments", async () => {
      let amount = 100
      let forgedAmount = amount * 2
      await expect(stakingContract.delegateDeposit(forgedAmount, await helper.signDeposit(amount, user, 0))).to.be.revertedWith("InvalidSignature()")
    })

    it("fails when depositing with withdraw permission", async () => {
      let amount = 100
      await expect(stakingContract.delegateDeposit(amount, await helper.signWithdraw(amount, user, 0))).to.be.revertedWith("InvalidSignature()")
    })

    it("fails when permission expires", async () => {
      await ethers.provider.send("evm_mine", [])
      let amount = 100
      let oneDay = 24 * 60 * 60
      let permissionExpiringAfter10Mins = await helper.signDeposit(amount, user, 0, 600)
      await ethers.provider.send("evm_increaseTime", [oneDay])
      await ethers.provider.send("evm_mine", [])
      await expect(stakingContract.delegateDeposit(amount, permissionExpiringAfter10Mins)).to.be.revertedWith("PermissionExpired()")
    })

    it("fails when leaving sender out of permission object", async () => {
      let amount = 100
      let permission = await helper.signDeposit(amount, user, 0)
      permission.data.sender = ethers.constants.AddressZero
      await expect(stakingContract.delegateDeposit(amount, permission)).to.be.revertedWith("InvalidSender()")
    })

    it("fails when paused", async () => {
      await stakingContract.emergencyPause(true)
      let amount = 100
      await expect(stakingContract.delegateDeposit(amount, await helper.signDeposit(amount, user, 0))).to.be.revertedWith("Pausable: paused")
      await expect(stakingContract.delegateWithdraw(amount, await helper.signWithdraw(amount, user, 0))).to.be.revertedWith("Pausable: paused")
    })

    const getDummyContractPermission = async () => {
      const deadline : number = await ethers.provider.getBlock("latest").then(b => b.timestamp + 10000)

      let permission = {
        sender: signatureVerifier.address,
        deadline: deadline,
        nonce: 0,
      }

      let signature = "0xabab" // dummy
      let signedPermission = { data: permission, signature }
      return signedPermission
    }

    it("contract signature checking succeeds", async () => {
      let amount = 100
      await stakingContract.mintJuice([signatureVerifier.address], [amount])
      const sign = await getDummyContractPermission()
      await stakingContract.delegateDeposit(amount, sign)
      expect(await stakingContract.unstakedBalanceOf(signatureVerifier.address)).to.equal(amount)
    })

    it("contract signature checking fails", async () => {
      let amount = 100
      await stakingContract.mintJuice([signatureVerifier.address], [amount])
      const sign = await getDummyContractPermission()
      await signatureVerifier.setIsValidSignature(false)
      await expect(stakingContract.delegateDeposit(amount, sign)).to.be.revertedWith("InvalidSignature()")
    })
  })

  describe("Upgrades", () => {
    let stakingContract: JuiceStaking02
    let a: Wallet, b: Wallet
    let contractInfo: UpgradeableContract
    let tokens: string[]
    let oracles: MockPriceOracle[]
    beforeEach(async () => {
      ({
        stakingContract,
        deployer,
        users: {
          noDeposit: a,
          noJuice: b,
        },
        tokens,
        oracles,
      } = await loadFixture(initializeJuicenet))
      contractInfo = await getUpgradeableContract("JuiceStaking02")
    })

    describe("when executed by owner", () => {
      it("upgrades proxy while retaining the old state", async () => {
        let balanceBeforeUpgrade = await stakingContract.balanceOf(a.address)

        let upgradeInfo = await getUpgradeableContract("MockJuiceStakingUpgrade")
        let storageUpgradeReport = contractInfo.getStorageUpgradeReport(upgradeInfo)
        expect(upgradeInfo.getErrorReport().ok).to.equal(true)
        expect(storageUpgradeReport.ok).to.equal(true)

        const upgradeFactory = new MockJuiceStakingUpgrade__factory(deployer)
        let upgrade = await upgradeFactory.deploy()
        const ADDED_FIELD_VALUE = 127
        await stakingContract.upgradeToAndCall(upgrade.address, upgrade.interface.encodeFunctionData("initializeOnUpgrade", [ADDED_FIELD_VALUE]))
        const newVersion = upgradeFactory.attach(stakingContract.address)

        expect(await newVersion.balanceOf(a.address)).to.equal(balanceBeforeUpgrade)
        expect(await newVersion.addedField()).to.equal(ADDED_FIELD_VALUE)
      })

      it("fails to upgrade proxy if logic contract has bad layout", async () => {
        let upgradeInfo = await getUpgradeableContract("MockBadJuiceStakingUpgrade")
        expect(upgradeInfo.getErrorReport().ok).to.equal(true)
        let upgrade = contractInfo.getStorageUpgradeReport(upgradeInfo)
        expect(upgrade.ok).to.equal(false)
        expect(upgrade.explain(false)).to.contain("Replaced `stakes02` with `addedField` of incompatible type")
      })

      it("fails to upgrade proxy if logic contract is not UUPSUpgradeable", async () => {
        let upgradeInfo = await getUpgradeableContract("MockNonUUPSJuiceStakingUpgrade")
        expect(upgradeInfo.getErrorReport().ok).to.equal(false)
        expect(upgradeInfo.getErrorReport().explain(false)).to.contain("Implementation is missing a public `upgradeTo(address)` function")
        let upgrade = contractInfo.getStorageUpgradeReport(upgradeInfo)
        expect(upgrade.ok).to.equal(false)
        expect(upgrade.explain(false)).to.contain("Replaced `stakes02` with `addedField` of incompatible type")
      })
    })

    describe("when executed by non-owner", () => {
      it("fails always", async () => {
        const upgradeFactory = new MockJuiceStakingUpgrade__factory(a)
        let upgrade = await upgradeFactory.deploy()
        const ADDED_FIELD_VALUE = 127
        let initCall = upgrade.interface.encodeFunctionData("initializeOnUpgrade", [ADDED_FIELD_VALUE])
        await expect(stakingContract.connect(a).upgradeToAndCall(upgrade.address, initCall)).to.be.revertedWith("Ownable: caller is not the owner")
      })

      it("initialization after proxy upgrade fails", async () => {
        const upgradeFactory = new MockJuiceStakingUpgrade__factory(a)
        let upgrade = await upgradeFactory.deploy()
        const ADDED_FIELD_VALUE = 127
        // fwiw, the initialization calls will be executed in the single upgrade tx for sure, but verifying the access control here nevertheless
        let initCall = upgrade.interface.encodeFunctionData("initializeOnUpgrade", [ADDED_FIELD_VALUE])
        await stakingContract.upgradeToAndCall(upgrade.address, initCall)
        const newVersion = upgradeFactory.attach(stakingContract.address)

        await expect(newVersion.connect(a).initializeOnUpgrade(123)).to.be.revertedWith("Ownable: caller is not the owner")
      })
    })
  })
})
