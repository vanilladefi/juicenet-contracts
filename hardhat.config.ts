/* eslint-disable camelcase */
import hardhatConfig from "./hardhat.base"
import mintJuice from "./hardhat/MintJuice.action"
import { task } from "hardhat/config"

task("airdrop", "Mints the Juice for receivers defined in 'premine.json'", mintJuice)

export default hardhatConfig
