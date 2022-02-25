/* eslint-disable camelcase */
import hardhatConfig from "./hardhat.base"
import { task } from "hardhat/config"
import mintJuice from "./hardhat/MintJuice.action"
import fetchJuiceOwners from "./hardhat/FetchJuiceOwners.action"

task("airdrop", "Mints the Juice for receivers defined in 'premine.json'", mintJuice)
task("fetch-airdrop", "Fetches the airdrop receivers and writes the 'premine.json'", fetchJuiceOwners)

export default hardhatConfig
