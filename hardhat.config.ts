/* eslint-disable camelcase */
import hardhatConfig from "./hardhat.base"
import { task } from "hardhat/config"
import mintJuice from "./hardhat/MintJuice.action"
import fetchJuiceOwners from "./hardhat/FetchJuiceOwners.action"
import deployJuicenet from "./hardhat/DeployJuicenet.action"

task("airdrop", "Mints the Juice for receivers defined in 'premine.json'", mintJuice)
task("fetch-airdrop", "Fetches the airdrop receivers and writes the 'premine.json'", fetchJuiceOwners)
task("deploy-juicenet", "").addOptionalParam("logic", "Optional Logic address, deploys proxy if set", "").setAction(deployJuicenet)
export default hardhatConfig
