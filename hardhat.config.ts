/* eslint-disable camelcase */
import hardhatConfig from "./hardhat.base"
import { task } from "hardhat/config"
import mintJuice from "./hardhat/MintJuice.action"
import fetchAirdropData from "./hardhat/FetchAirdropData.action"
import deployJuicenet01 from "./hardhat/deployment/DeployJuicenet01.action"
import deployJuicenet02 from "./hardhat/deployment/DeployJuicenet02.action"
import createDeployment from "./hardhat/deployment/CreateDeployment.action"
import updatePriceFeeds from "./hardhat/UpdatePriceFeeds.action"

task("airdrop", "Mints the Juice for receivers defined in 'premine.json'", mintJuice)
task("fetch-airdrop-data", "Fetches the airdrop receivers and writes the 'JUICE-airdrop.json'").addParam("to", "Target network", "").setAction(fetchAirdropData)
task("deploy-juicenet01", "Deploys the Juicenet 01 logic and proxy contract").addOptionalParam("logic", "Optional Logic address, deploys proxy if set", "").setAction(deployJuicenet01)
task("deploy-juicenet02", "Deploys the Juicenet 02 logic and upgrades proxy contract").addOptionalParam("logic", "Optional Logic address, upgrades proxy if set", "").setAction(deployJuicenet02)
task("create-deployment", "Creates local deployment files").addParam("tx", "Deployment tx hash", "").addParam("proxy", "Proxy contract address", "").setAction(createDeployment)
task("update-pricefeeds", "Reads token-feed pairs from token-feeds.json and updates the Juicenet", updatePriceFeeds)
export default hardhatConfig
