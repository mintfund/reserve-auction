import fs from 'fs-extra';
import { JsonRpcProvider } from '@ethersproject/providers';
import { Wallet } from '@ethersproject/wallet';
import { NftFactoryFactory } from '../typechain/NftFactoryFactory';
import { ReserveAuctionFactory } from '../typechain/ReserveAuctionFactory';

const CHAIN_ID = 4

async function start() {
  //   const args = require('minimist')(process.argv.slice(2));
  const args = { chainId: CHAIN_ID };

  if (!args.chainId) {
    throw new Error('--chainId chain ID is required');
  }
  const path = `${process.cwd()}/.env${
    args.chainId === 1 ? '.prod' : args.chainId === 4 ? '.dev' : '.local'
  }`;
  await require('dotenv').config({ path });
  const provider = new JsonRpcProvider(process.env.RPC_ENDPOINT);
  const wallet = new Wallet(`0x${process.env.PRIVATE_KEY}`, provider);
  const sharedAddressPath = `${process.cwd()}/addresses/${args.chainId}.json`;
  // @ts-ignore
  const addressBook = JSON.parse(await fs.readFileSync(sharedAddressPath));

  const ZORA_MEDIA_CONTRACT_ADDRESS = addressBook.media

  console.log('Deploying NFTFactory...');
  const deployTx = await new NftFactoryFactory(wallet).deploy(
    ZORA_MEDIA_CONTRACT_ADDRESS
  );
  console.log('Deploy TX: ', deployTx.deployTransaction.hash);
  await deployTx.deployed();
  console.log('NFTFactory deployed at ', deployTx.address);
  addressBook.NFTFactory = deployTx.address;

  console.log('Deploying ReserveAuction...');
  const reserveAuctionDeployTx = await new ReserveAuctionFactory(wallet).deploy(
    ZORA_MEDIA_CONTRACT_ADDRESS
  );
  console.log(`Deploy TX: ${reserveAuctionDeployTx.deployTransaction.hash}`);
  await reserveAuctionDeployTx.deployed();
  console.log(`ReserveAuction deployed at ${reserveAuctionDeployTx.address}`);

  addressBook.ReserveAuction = reserveAuctionDeployTx.address;

  await fs.writeFile(sharedAddressPath, JSON.stringify(addressBook, null, 2));
  console.log(`Contracts deployed and configured.`);

  process.exit();
}

start().catch((e: Error) => {
  console.error(e);
  process.exit(1);
});
