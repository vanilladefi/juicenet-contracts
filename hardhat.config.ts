/* eslint-disable camelcase */
import hardhatConfig from "./hardhat.base"
import { task } from "hardhat/config"
import mintJuice from "./hardhat/MintJuice.action"
import fetchJuiceOwners from "./hardhat/FetchJuiceOwners.action"
import deployJuicenet from "./hardhat/DeployJuicenet.action"
import createDeployment from "./hardhat/CreateDeployment.action"

task("airdrop", "Mints the Juice for receivers defined in 'premine.json'", mintJuice)
task("fetch-airdrop", "Fetches the airdrop receivers and writes the 'premine.json'", fetchJuiceOwners)
task("deploy-juicenet", "Deploys the Juicenet logic and proxy contract").addOptionalParam("logic", "Optional Logic address, deploys proxy if set", "").setAction(deployJuicenet)
task("create-deployment").addParam("tx", "Deployment tx hash", "").addParam("proxy", "Proxy contract address", "").setAction(createDeployment)
export default hardhatConfig
