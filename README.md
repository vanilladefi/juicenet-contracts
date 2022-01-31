# Vanilla Juicenet contracts
This repository contains the Solidity smart contracts for the Vanilla Juicenet.

See [`contracts/README.md`](contracts/README.md) for more detailed documentation.

## Install PNPM

We use [pnpm](https://pnpm.io/) instead of npm. Use npm to install pnpm:

```shell
npm install -g pnpm
```

## Build and Test

We use [Hardhat](https://hardhat.org/) as a build tool.

To build, generate Typechain bindings, and run unit tests:
```
pnpm install ## will warn about missing artifacts, which will created in the next step :)
pnpm run compile:sol
pnpm run generate:typechain
pnpm test
```

To run coverage reports
```
pnpm run coverage:sol
```

## Deploy contracts to a local mainnet fork

Set the `ALCHEMY_POLYGON_APIKEY` in `.secrets.env` (use `.secrets.env.example` as a template) and execute:

```shell
pnpm run node:mainnet-fork
```

which starts a localhost node, which acts like a mainnet node during deployment. Other archive node providers for mainnet forks besides Alchemy (Infura etc) are not currently supported.

# License
GPL.
