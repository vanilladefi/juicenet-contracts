/* eslint-disable camelcase */
import { expect, use } from "chai"
import {
  IPriceOracle__factory,
  JuiceStaking,
  JuiceStaking__factory,
  MockPriceOracle,
  MockPriceOracle__factory,
  MockSignalAggregator,
  MockSignalAggregator__factory,
} from "../typechain/juicenet"

import { ethers, waffle } from "hardhat"
import { SignerWithAddress } from "hardhat-deploy-ethers/dist/src/signers"
import { BigNumber, BigNumberish, Contract, ContractTransaction, Wallet } from "ethers"
import { deployMockContract, solidity } from "ethereum-waffle"
import { Decimal } from "decimal.js"
import { randomBytes } from "crypto"
import { JsonRpcProvider } from "@ethersproject/providers"
import { SigningHelper } from "./Signing.util"
import exp from "constants"

use(solidity)

const { provider, deployContract, createFixtureLoader } = waffle
const { provider: networkProvider } = ethers
const loadFixture = createFixtureLoader(provider.getWallets(), provider)

const value = (p: BigNumberish) => BigInt(p.toString())

const initializeJuicenet = async ([deployer, a, b, noDeposit, withDeposit]: Wallet[]) => {
  let stakingContract = await new JuiceStaking__factory(deployer).deploy()

  const createRandomEthereumAddress = () => ethers.utils.getAddress(ethers.utils.hexZeroPad("0x" + randomBytes(20).toString("hex"), 20))
  let tokens = [...Array(3)].map(createRandomEthereumAddress)
  let tokenWithoutPriceOracle = createRandomEthereumAddress()

  const DECIMALS = 10 ** 8
  const setPrice = (price: BigNumberish) => async (oracle: MockPriceOracle) => {
    await oracle.setPrice(price)
    return oracle
  }
  let oracles = [await new MockPriceOracle__factory(deployer).deploy().then(setPrice(10 * DECIMALS)),
    await new MockPriceOracle__factory(deployer).deploy().then(setPrice(20 * DECIMALS)),
    await new MockPriceOracle__factory(deployer).deploy().then(setPrice(50 * DECIMALS))]

  let signalAggregator = await new MockSignalAggregator__factory(deployer).deploy()

  await stakingContract.connect(deployer).mintJuice([noDeposit.address, withDeposit.address], [1000000, 1000000])
  await stakingContract.connect(withDeposit).deposit(1000000)
  await stakingContract.connect(deployer).updatePriceOracles(tokens, oracles.map(x => x.address))
  return {
    stakingContract,
    deployer,
    signalAggregator,
    accounts: [a, b],
    tokenWithoutPriceOracle,
    users: { noJuice: a, noDeposit, withDeposit },
    tokens,
    oracles,
  }
}

describe("Staking", () => {
  let deployer: Wallet, noJuice: Wallet, noDeposit: Wallet, withDeposit

  describe("Basic ERC-20 functionality", () => {
    let erc20: JuiceStaking
    let withJuice: Wallet
    beforeEach(async () => {
      ({ stakingContract: erc20, deployer, users: { noJuice, noDeposit: withJuice } } = await loadFixture(initializeJuicenet))
    })

    it("symbol() == 'Juice'", async () => {
      expect(await erc20.symbol()).to.equal("JUICE")
    })

    it("decimals() == 8", async () => {
      expect(await erc20.decimals()).to.equal(8)
    })

    it("totalSupply()", async () => {
      expect(await erc20.totalSupply()).to.equal(2000000)
    })

    it("balanceOf()", async () => {
      expect(await erc20.balanceOf(withJuice.address)).to.equal(1000000)
    })

    it("transfer() ok", async () => {
      await expect(() => erc20.connect(withJuice).transfer(noJuice.address, 50000)).to.changeTokenBalances(
        erc20,
        [withJuice, noJuice],
        [-50000, 50000])
    })

    it("transferFrom() ok", async () => {
      await erc20.connect(withJuice).approve(noJuice.address, 10000)
      await expect(() => erc20.connect(noJuice).transferFrom(withJuice.address, noJuice.address, 5000)).to.changeTokenBalances(
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
    let stakingContract: JuiceStaking
    let user: Wallet
    beforeEach(async () => {
      ({ stakingContract, users: { noJuice, noDeposit: user } } = await loadFixture(initializeJuicenet))
      stakingContract = stakingContract.connect(user)
    })

    it("works when depositing all JUICE", async () => {
      await expect(() => stakingContract.deposit(1000000)).to.changeTokenBalances(
        stakingContract,
        [user, stakingContract],
        [-1000000, 1000000])
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(1000000)
    })

    it("works when depositing a portion of JUICE", async () => {
      await expect(() => stakingContract.deposit(500000)).to.changeTokenBalances(
        stakingContract,
        [user, stakingContract],
        [-500000, 500000])
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(500000)
    })

    it("fails when depositing more than current balance", async () => {
      await expect(stakingContract.deposit(1500000)).to.revertedWith("InsufficientJUICE(1500000, 1000000)")
    })

    it("fails when paused", async () => {
      await stakingContract.connect(deployer).emergencyPause(true)
      await expect(stakingContract.deposit(150)).to.revertedWith("Pausable: paused")
    })
  })

  describe("Withdraws", () => {
    let stakingContract: JuiceStaking
    let user: Wallet
    beforeEach(async () => {
      ({ stakingContract, users: { withDeposit: user, noDeposit } } = await loadFixture(initializeJuicenet))
      stakingContract = stakingContract.connect(user)
    })

    it("works when withdrawing all", async () => {
      let tx = stakingContract.withdraw(1000000)
      await expect(tx).to.emit(stakingContract, "JUICEWithdrawn").withArgs(user.address, 1000000)
      expect(await stakingContract.balanceOf(user.address)).to.equal(1000000)
      expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(0)
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0)
    })

    it("works when withdrawing a portion", async () => {
      let tx = stakingContract.withdraw(250000)
      await expect(tx).to.emit(stakingContract, "JUICEWithdrawn").withArgs(user.address, 250000)
      expect(await stakingContract.balanceOf(user.address)).to.equal(250000)
      expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(750000)
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(750000)
    })

    it("fails when withdrawing non-deposited JUICE", async () => {
      await expect(stakingContract.connect(noDeposit).withdraw(150)).to.revertedWith("InsufficientJUICE(150, 0)")
    })

    it("fails when paused", async () => {
      await stakingContract.connect(deployer).emergencyPause(true)
      await expect(stakingContract.withdraw(100)).to.revertedWith("Pausable: paused")
    })
  })

  type StakingParam = {
    token: string;
    amount: BigNumberish;
    sentiment: boolean;
  }

  type StakeHelper = { long: (amount: BigNumberish) => StakingParam; short: (amount: BigNumberish) => StakingParam }
  describe("Modifying Stakes", () => {
    let stakingContract: JuiceStaking
    let oracles: MockPriceOracle[], oracle: MockPriceOracle
    let tokens: string[]
    let token1: string, token2: string, token3: string, tokenWithoutPriceOracle: string
    let oracleAddresses: string[]
    let stake: StakeHelper
    let user: Wallet, user2: Wallet
    beforeEach(async () => {
      ({ stakingContract, oracles, tokenWithoutPriceOracle, tokens, users: { withDeposit: user, noDeposit: user2 } } = await loadFixture(initializeJuicenet));
      ([token1, token2, token3] = tokens)
      oracleAddresses = oracles.map(x => x.address)
      stake = Stakes(token1)
      oracle = oracles[0]
    })
    const Stakes = (token: string) => ({
      long: (amount: BigNumberish): StakingParam => ({ token, amount, sentiment: true }),
      short: (amount: BigNumberish): StakingParam => ({ token, amount, sentiment: false }),
    })

    describe("When no existing stake", () => {
      for (const expectedSentiment of [true, false]) {
        for (const [firstStake, testType] of [[0, "zero"], [1, "smallest possible"], [250000, "partial"], [1000000, "100%"], [1500000, "over 100%"]]) {
          let oraclePrice = 10 * (10 ** 8)
          let juiceAmount = firstStake as number
          // overstaking is limited to total unstaked balance
          let expectedJuiceAmountSpent = Math.min(juiceAmount, 1000000)
          let preUnstakedBalance = 1000000

          // this isn't very readable but just want to verify that for same set of params, both the normal and delegated versions end up in the same state
          const verifySameEndResult = async (tx: Promise<ContractTransaction>) => {
            (await tx)
            let { amount, sentiment } = await stakingContract.currentStake(user.address, token1)

            let expectedAmountWithMultiplier = expectedJuiceAmountSpent * (10 ** 16) / oraclePrice
            expect(amount).to.equal(expectedAmountWithMultiplier)
            expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(1000000 - expectedJuiceAmountSpent)
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
            await verifySameEndResult(stakingContract.connect(user).modifyStakes(stakes))
          })

          it(`delegateModifyStakes() adds ${testType} ${stakeType} stake`, async () => {
            let stakes = [expectedSentiment ? stake.long(juiceAmount) : stake.short(juiceAmount)]
            let signedPermission = await SigningHelper(ethers.provider, stakingContract).signModifyStakes(stakes, user, 0)
            await verifySameEndResult(stakingContract.connect(deployer).delegateModifyStakes(stakes, signedPermission))
          })
        }
      }
    })

    describe("Given single long and short position", () => {
      let stake1: StakeHelper, stake2: StakeHelper
      beforeEach(async () => {
        await stakingContract.connect(user).modifyStakes([stake.long(500000), Stakes(token2).short(500000)])
        stake1 = Stakes(token1)
        stake2 = Stakes(token2)
      })

      describe("When price stays the same", () => {
        let oraclePrice = 10 * (10 ** 8)
        let oracle2Price = 20 * (10 ** 8)
        it("closing the long position mints no rewards", async () => {
          let tx = stakingContract.connect(user).modifyStakes([stake1.long(0)])
          await tx
          let { amount: a1 } = await stakingContract.currentStake(user.address, token1)
          let { amount: a2 } = await stakingContract.currentStake(user.address, token2)
          expect(a1).to.equal(0 * (10 ** 16) / oraclePrice)
          expect(a2).to.equal(500000 * (10 ** 16) / oracle2Price)

          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(500000)
          expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(1000000)
          expect(await stakingContract.totalSupply()).to.equal(2000000)

          let { longTokens } = await stakingContract.normalizedAggregateSignal()
          expect(longTokens.length).to.equal(0)
          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token1, true, oraclePrice, 500000)
        })

        it("closing the short position mints no rewards", async () => {
          let tx = stakingContract.connect(user).modifyStakes([stake2.short(0)])
          await tx
          let { amount: a1 } = await stakingContract.currentStake(user.address, token1)
          let { amount: a2 } = await stakingContract.currentStake(user.address, token2)
          expect(a1).to.equal(500000 * (10 ** 16) / oraclePrice)
          expect(a2).to.equal(0 * (10 ** 16) / oracle2Price)

          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(500000)
          expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(1000000)
          expect(await stakingContract.totalSupply()).to.equal(2000000)

          let { longTokens } = await stakingContract.normalizedAggregateSignal()
          expect(longTokens.length).to.equal(1)
          expect(longTokens.map(x => x.token)).to.eql([token1])
          expect(longTokens.map(x => x.weight.toNumber())).to.eql([100])
          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token2, false, oracle2Price, 500000)
        })

        it("switching long to short mints no rewards", async () => {
          let tx = stakingContract.connect(user).modifyStakes([stake1.short(500000)])
          await tx
          let { amount: a1, sentiment } = await stakingContract.currentStake(user.address, token1)
          let { amount: a2 } = await stakingContract.currentStake(user.address, token2)

          expect(sentiment).to.equal(false)
          expect(a1).to.equal(500000 * (10 ** 16) / oraclePrice)
          expect(a2).to.equal(500000 * (10 ** 16) / oracle2Price)

          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0)
          let { longTokens } = await stakingContract.normalizedAggregateSignal()
          expect(longTokens.length).to.equal(0)

          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token1, true, oraclePrice, 500000)
          await expect(tx).to.emit(stakingContract, "StakeAdded").withArgs(user.address, token1, false, oraclePrice, -500000)
        })
        it("switching short to long mints no rewards", async () => {
          let tx = stakingContract.connect(user).modifyStakes([stake2.long(500000)])
          await tx
          let { amount: a1 } = await stakingContract.currentStake(user.address, token1)
          let { amount: a2, sentiment } = await stakingContract.currentStake(user.address, token2)

          expect(sentiment).to.equal(true)
          expect(a1).to.equal(500000 * (10 ** 16) / oraclePrice)
          expect(a2).to.equal(500000 * (10 ** 16) / oracle2Price)

          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0)
          let { longTokens } = await stakingContract.normalizedAggregateSignal()
          expect(longTokens.length).to.equal(2)
          expect(longTokens.map(x => x.token)).to.eql([token1, token2])
          expect(longTokens.map(x => x.weight.toNumber())).to.eql([50, 50])

          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token2, false, oracle2Price, 500000)
          await expect(tx).to.emit(stakingContract, "StakeAdded").withArgs(user.address, token2, true, oracle2Price, -500000)
        })
      })

      describe("When price goes up 50%", () => {
        let newPrice1 = 15 * (10 ** 8)
        let newPrice2 = 30 * (10 ** 8)
        beforeEach(async () => {
          await oracles[0].connect(deployer).setPrice(15 * (10 ** 8))
          await oracles[1].connect(deployer).setPrice(30 * (10 ** 8))
        })

        it("closing long position mints rewards", async () => {
          let tx = stakingContract.connect(user).modifyStakes([stake1.long(0)])
          await tx
          let { amount } = await stakingContract.currentStake(user.address, token1)

          expect(amount).to.equal(0)
          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(750000) // 500k back + 250k extra
          expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(1250000)
          expect(await stakingContract.totalSupply()).to.equal(2250000)
          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token1, true, newPrice1, 750000)
        })

        it("closing short position burns rewards", async () => {
          let tx = stakingContract.connect(user).modifyStakes([stake2.short(0)])
          await tx
          let { amount } = await stakingContract.currentStake(user.address, token2)

          expect(amount).to.equal(0)
          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(250000) // 500k - 250k loss
          expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(750000)
          expect(await stakingContract.totalSupply()).to.equal(1750000)
          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token2, false, newPrice2, 250000)
        })
      })

      describe("When price goes down 50%", () => {
        let newPrice1 = 5 * (10 ** 8)
        let newPrice2 = 10 * (10 ** 8)
        beforeEach(async () => {
          await oracles[0].connect(deployer).setPrice(newPrice1)
          await oracles[1].connect(deployer).setPrice(newPrice2)
        })

        it("closing long position burns rewards", async () => {
          let tx = stakingContract.connect(user).modifyStakes([stake1.long(0)])
          await tx
          let { amount } = await stakingContract.currentStake(user.address, token1)

          expect(amount).to.equal(0)
          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(250000) // 500k back - 250k loss
          expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(750000)
          expect(await stakingContract.totalSupply()).to.equal(1750000)
          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token1, true, newPrice1, 250000)
        })

        it("closing short position mints rewards", async () => {
          let tx = stakingContract.connect(user).modifyStakes([stake2.short(0)])
          await tx
          let { amount } = await stakingContract.currentStake(user.address, token2)

          expect(amount).to.equal(0)
          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(750000) // 500k + 250k extra
          expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(1250000)
          expect(await stakingContract.totalSupply()).to.equal(2250000)
          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token2, false, newPrice2, 750000)
        })
      })

      describe("When price goes down 100%", () => {
        let newPrice1 = 0
        let newPrice2 = 0
        beforeEach(async () => {
          await oracles[0].connect(deployer).setPrice(newPrice1)
          await oracles[1].connect(deployer).setPrice(newPrice2)
        })

        it("closing long position goes worthless", async () => {
          let tx = stakingContract.connect(user).modifyStakes([stake1.long(0)])
          await tx
          let { amount } = await stakingContract.currentStake(user.address, token1)

          expect(amount).to.equal(0)
          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0) // 500k back - 500k loss
          expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(500000)
          expect(await stakingContract.totalSupply()).to.equal(1500000)
          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token1, true, newPrice1, 0)
        })

        it("closing short position doubles the stake", async () => {
          let tx = stakingContract.connect(user).modifyStakes([stake2.short(0)])
          await tx
          let { amount } = await stakingContract.currentStake(user.address, token2)

          expect(amount).to.equal(0)
          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(1000000) // 500k + 500k extra
          expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(1500000)
          expect(await stakingContract.totalSupply()).to.equal(2500000)
          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token2, false, newPrice2, 1000000)
        })
      })

      describe("When price goes up 200%", () => {
        let newPrice1 = 30 * (10 ** 8)
        let newPrice2 = 60 * (10 ** 8)
        beforeEach(async () => {
          await oracles[0].connect(deployer).setPrice(newPrice1)
          await oracles[1].connect(deployer).setPrice(newPrice2)
        })

        it("closing long position triples", async () => {
          let tx = stakingContract.connect(user).modifyStakes([stake1.long(0)])
          await tx
          let { amount } = await stakingContract.currentStake(user.address, token1)

          expect(amount).to.equal(0)
          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(1500000) // 500k back + 1000k extra
          expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(2000000)
          expect(await stakingContract.totalSupply()).to.equal(3000000)
          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token1, true, newPrice1, 1500000)
        })

        it("closing short position is worthless but doesn't go negative", async () => {
          let tx = stakingContract.connect(user).modifyStakes([stake2.short(0)])
          await tx
          let { amount } = await stakingContract.currentStake(user.address, token2)

          expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0) // 500k back - 500k loss
          expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(500000)
          expect(await stakingContract.totalSupply()).to.equal(1500000)
          await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token2, false, newPrice2, 0)
        })
      })
    })

    it("whitepaper example works", async () => {
      await stakingContract.connect(user2).deposit(1000000)

      for (const oracle of oracles) {
        await oracle.setPrice(100000000)
      }
      let token1Stake = Stakes(token1)
      let token2Stake = Stakes(token2)
      let token3Stake = Stakes(token3)
      await stakingContract.connect(user).modifyStakes([
        token1Stake.long(100),
        token2Stake.long(50),
      ])
      await stakingContract.connect(user2).modifyStakes([
        token1Stake.short(50),
        token3Stake.short(25),
      ])
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(999850)
      expect(await stakingContract.unstakedBalanceOf(user2.address)).to.equal(999925)

      let { longTokens } = await stakingContract.normalizedAggregateSignal()
      expect(longTokens.length).to.equal(2)
      expect(longTokens.map(x => x.token)).to.eql([token1, token2])
      expect(longTokens.map(x => x.weight.toNumber())).to.eql([25, 8])
    })

    it("adding second stake removes the first", async () => {
      let [priceOracle] = oracles
      let price = 314252688830
      await priceOracle.setPrice(price)
      {
        let tx = stakingContract.connect(user).modifyStakes([stake.long(500000)])
        await expect(tx).to.emit(stakingContract, "StakeAdded").withArgs(user.address, token1, true, price, -500000)
      }

      {
        let tx = stakingContract.connect(user).modifyStakes([stake.long(1000000)])
        await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token1, true, price, 500000)
        await expect(tx).to.emit(stakingContract, "StakeAdded").withArgs(user.address, token1, true, price, -1000000)
      }

      let { amount, sentiment } = await stakingContract.currentStake(user.address, token1)
      expect(amount).to.equal(31821525655)
      expect(sentiment).to.equal(true)
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0)
    })

    it("adding second stake removes the first also in shorts", async () => {
      let [priceOracle] = oracles
      let price = 314252688830
      await priceOracle.setPrice(price)
      {
        let tx = stakingContract.connect(user).modifyStakes([stake.short(500000)])
        await expect(tx).to.emit(stakingContract, "StakeAdded").withArgs(user.address, token1, false, price, -500000)
      }

      {
        let tx = stakingContract.connect(user).modifyStakes([stake.short(1000000)])
        await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token1, false, price, 500000)
        await expect(tx).to.emit(stakingContract, "StakeAdded").withArgs(user.address, token1, false, price, -1000000)
      }

      let { amount, sentiment } = await stakingContract.currentStake(user.address, token1)
      expect(amount).to.equal(31821525655)
      expect(sentiment).to.equal(false)
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0)
    })

    it("shorts can only lose the staked amount", async () => {
      let totalAmount = 1000000
      let [priceOracle] = oracles
      let price = 314252688830n
      let stakedAmount = 500000
      // to have totalsupply amounts match with a fixture that creates multiple users
      let nonUserTotalAmount = 1000000

      await priceOracle.setPrice(price)
      await stakingContract.connect(user).modifyStakes([stake.short(stakedAmount)])
      let { amount, sentiment } = await stakingContract.currentStake(user.address, token1)
      expect(amount).to.equal(15910762827)
      expect(sentiment).to.equal(false)
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(totalAmount - stakedAmount)
      expect(await stakingContract.totalSupply()).to.equal(nonUserTotalAmount + totalAmount)
      expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(totalAmount)

      // hike the price up 200%
      price = 3n * price
      await priceOracle.setPrice(price)
      let tx = stakingContract.connect(user).modifyStakes([stake.short(0)])
      await expect(tx).to.emit(stakingContract, "StakeRemoved").withArgs(user.address, token1, false, price, 0);
      ({ amount, sentiment } = await stakingContract.currentStake(user.address, token1))
      expect(amount).to.equal(0)
      expect(sentiment).to.equal(false)
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(totalAmount - stakedAmount)
      // closing position at loss burns Juice
      expect(await stakingContract.totalSupply()).to.equal(nonUserTotalAmount + totalAmount - stakedAmount)
      expect(await stakingContract.balanceOf(stakingContract.address)).to.equal(totalAmount - stakedAmount)
    })

    it("fails when removing a stake when token no longer has an oracle", async () => {
      let [priceOracle] = oracles
      let price = 314252688830
      await priceOracle.setPrice(price)
      await stakingContract.connect(user).modifyStakes([stake.long(500000)])
      await stakingContract.connect(deployer).updatePriceOracles([token1], [ethers.constants.AddressZero])
      await expect(stakingContract.connect(user).modifyStakes([stake.long(0)])).to.be.revertedWith(`UnsupportedToken("${token1}")`)
    })

    it("fails when paused", async () => {
      await stakingContract.connect(deployer).emergencyPause(true)
      let tx = stakingContract.connect(user).modifyStakes([
        stake.long(100),
      ])
      await expect(tx).to.revertedWith("Pausable: paused")
    })

    it("fails when staking token without price oracle", async () => {
      let tx = stakingContract.connect(user).modifyStakes([Stakes(tokenWithoutPriceOracle).long(100)])
      await expect(tx).to.revertedWith(`InvalidToken("${tokenWithoutPriceOracle}")`)
    })

    it("no-op when staking 0", async () => {
      let [priceOracle] = oracles
      await priceOracle.setPrice(100000000)
      let tx = stakingContract.connect(user).modifyStakes([stake.long(0)])
      await expect(tx).to.not.emit(stakingContract, "StakeAdded")
      let { amount, sentiment } = await stakingContract.currentStake(user.address, token1)
      expect(amount).to.equal(0)
      expect(sentiment).to.equal(false)
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(1000000)
    })

    it("stake is limited when overstaking", async () => {
      let [priceOracle] = oracles
      await priceOracle.setPrice(100000000)
      await stakingContract.connect(user).modifyStakes([stake.long(1500000)])
      let { amount, sentiment } = await stakingContract.currentStake(user.address, token1)
      expect(amount).to.equal(100000000000000)
      expect(sentiment).to.equal(true)
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0)
    })
  })

  describe("Updating Price Oracles", () => {
    let stakingContract: JuiceStaking
    let oracles: Contract[]
    let tokens: string[]
    let token1: string, token2: string
    let oracle1: string, oracle2: string
    let nonOwner: Wallet
    beforeEach(async () => {
      ({ stakingContract, oracles, tokens, accounts: [nonOwner] } = await loadFixture(initializeJuicenet));
      ([token1, token2] = tokens);
      ([oracle1, oracle2] = oracles.map(x => x.address))
    })

    describe("when executed by owner", () => {
      let priceOracles

      beforeEach(async () => {
        stakingContract = stakingContract.connect(deployer)
      })

      it("works", async () => {
        await stakingContract.updatePriceOracles([token1, token2], [oracle1, oracle2])
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
    let stakingContract: JuiceStaking
    let a:Wallet, b: Wallet
    beforeEach(async () => {
      ({ stakingContract, accounts: [a, b] } = await loadFixture(initializeJuicenet))
    })

    describe("when executed by owner", () => {
      it("minting any amount to any address works", async () => {
        await stakingContract.connect(deployer).mintJuice([b.address], [100])
        expect(await stakingContract.balanceOf(b.address)).to.equal(BigNumber.from(100))
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
    let stakingContract: JuiceStaking
    let signalAggregator: MockSignalAggregator
    let nonOwner: Wallet
    beforeEach(async () => {
      ({ stakingContract, signalAggregator, accounts: [nonOwner] } = await loadFixture(initializeJuicenet))
    })

    describe("when executed by owner", () => {
      it("sets the signal aggregator", async () => {
        expect(await stakingContract.signalAggregator()).to.equal(ethers.constants.AddressZero)

        await stakingContract.connect(deployer).authorizeSignalAggregator(signalAggregator.address)
        expect(await stakingContract.signalAggregator()).to.equal(signalAggregator.address)

        await stakingContract.connect(deployer).authorizeSignalAggregator(ethers.constants.AddressZero)
        expect(await stakingContract.signalAggregator()).to.equal(ethers.constants.AddressZero)
      })
    })

    describe("when executed by non-owner", () => {
      it("fails always", async () => {
        expect(stakingContract.connect(nonOwner).authorizeSignalAggregator(signalAggregator.address)).to.be.revertedWith("Ownable: caller is not the owner")
      })
    })
  })

  describe("Pausing", () => {
    let stakingContract: JuiceStaking
    let a: Wallet, b: Wallet
    beforeEach(async () => {
      ({ stakingContract, deployer, users: { noDeposit: a, noJuice: b } } = await loadFixture(initializeJuicenet))
    })

    describe("when executed by owner", () => {
      it("pausing and unpausing works", async () => {
        await stakingContract.connect(deployer).emergencyPause(true)
        await expect(stakingContract.connect(a).transfer(b.address, 50)).to.revertedWith("JUICE is temporarily disabled")
        await expect(stakingContract.connect(a).deposit(150)).to.revertedWith("Pausable: paused")
        await stakingContract.connect(deployer).emergencyPause(false)
        await expect(() => stakingContract.connect(a).transfer(b.address, 50)).to.changeTokenBalances(
          stakingContract,
          [a, b],
          [-50, 50])
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
    let stakingContract: JuiceStaking
    let user: Wallet
    let helper: { signDeposit: any; signWithdraw: any; domain?: () => Promise<{ name: string; version: string; chainId: number; verifyingContract: string }>; signModifyStakes?: (stakes: { sentiment: boolean; token: string; amount: BigNumberish }[], user: Wallet, nonce: number, deadline?: number) => Promise<{ data: { sender: string; deadline: number; nonce: number }; signature: string }> }
    beforeEach(async () => {
      ({ stakingContract, users: { noDeposit: user } } = await loadFixture(initializeJuicenet))
      helper = SigningHelper(ethers.provider, stakingContract)
      stakingContract = stakingContract.connect(deployer)
    })

    it("makes single deposit", async () => {
      let amount = 1000000
      await stakingContract.delegateDeposit(amount, await helper.signDeposit(amount, user, 0))
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(amount)
    })

    it("makes two deposits with subsequent nonces", async () => {
      let amount = 100000
      await stakingContract.delegateDeposit(amount, await helper.signDeposit(amount, user, 0))
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(amount)

      await stakingContract.delegateDeposit(amount, await helper.signDeposit(amount, user, 1))
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(amount * 2)
    })

    it("makes deposit and withdraw with subsequent nonces", async () => {
      let amount = 100000
      await stakingContract.delegateDeposit(amount, await helper.signDeposit(amount, user, 0))
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(amount)

      await stakingContract.delegateWithdraw(amount, await helper.signWithdraw(amount, user, 1))
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0)
    })

    it("makes deposit and two withdraws with subsequent nonces", async () => {
      let amount = 100000
      await stakingContract.delegateDeposit(amount, await helper.signDeposit(amount, user, 0))
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(amount)

      await stakingContract.delegateWithdraw(amount / 2, await helper.signWithdraw(amount / 2, user, 1))
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(amount / 2)

      await stakingContract.delegateWithdraw(amount / 2, await helper.signWithdraw(amount / 2, user, 2))
      expect(await stakingContract.unstakedBalanceOf(user.address)).to.equal(0)
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
  })
})
