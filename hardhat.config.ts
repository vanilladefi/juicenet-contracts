/* eslint-disable camelcase */
import hardhatConfig from "./hardhat.base"
import { task } from "hardhat/config"
import mintJuice from "./hardhat/MintJuice.action"
import fetchAirdropData from "./hardhat/FetchAirdropData.action"
import deployJuicenet from "./hardhat/DeployJuicenet.action"
import createDeployment from "./hardhat/CreateDeployment.action"
import updatePriceFeeds from "./hardhat/UpdatePriceFeeds.action"

task("airdrop", "Mints the Juice for receivers defined in 'premine.json'", mintJuice)
task("fetch-airdrop-data", "Fetches the airdrop receivers and writes the 'JUICE-airdrop.json'").addParam("to", "Target network", "").setAction(fetchAirdropData)
task("deploy-juicenet", "Deploys the Juicenet logic and proxy contract").addOptionalParam("logic", "Optional Logic address, deploys proxy if set", "").setAction(deployJuicenet)
task("create-deployment", "Creates local deployment files").addParam("tx", "Deployment tx hash", "").addParam("proxy", "Proxy contract address", "").setAction(createDeployment)
task("update-pricefeeds", "Reads token-feed pairs from token-feeds.json and updates the Juicenet", updatePriceFeeds)
export default hardhatConfig
