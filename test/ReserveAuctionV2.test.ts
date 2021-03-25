import { expect } from 'chai';
import { JsonRpcProvider } from '@ethersproject/providers';
import {
  MarketFactory,
  MediaFactory,
  ReserveAuctionV2Factory,
} from '../typechain';
import { generatedWallets } from '../utils/generatedWallets';
import { Wallet } from '@ethersproject/wallet';

const provider = new JsonRpcProvider();

let marketAddress: string;
let mediaAddress: string;
let auctionAddress: string;

const [deployerWallet] = generatedWallets(provider);

async function deploy() {
  const market = await (
    await new MarketFactory(deployerWallet).deploy()
  ).deployed();

  marketAddress = market.address;

  const media = await (
    await new MediaFactory(deployerWallet).deploy(marketAddress)
  ).deployed();

  mediaAddress = media.address;

  await market.configure(mediaAddress);

  const auction = await (
    await new ReserveAuctionV2Factory(deployerWallet).deploy(mediaAddress)
  ).deployed();

  auctionAddress = auction.address;
}

async function auctionAs(wallet: Wallet) {
  return ReserveAuctionV2Factory.connect(auctionAddress, wallet);
}

describe('ReserveAuctionV2', () => {
  before(async () => {
    await deploy();
  });

  describe('#constructor', () => {
    describe('when the passed in address does not meet the NFT standard', () => {
      it.skip('should revert', async () => {
        await expect(
          new ReserveAuctionV2Factory(deployerWallet).deploy(marketAddress)
        ).rejectedWith('Derp');
      });
    });

    describe('when the passed in address does meet the NFT standard', () => {
      it('should set the zora address', async () => {
        const auction = await auctionAs(deployerWallet);
        expect(await auction.zora()).eq(mediaAddress);
      });
    });
  });

  describe('#updateZora', () => {
    describe('when the passed in address does meet the NFT standard', () => {
      it('should set the zora address', async () => {
        const auction = await auctionAs(deployerWallet);

        expect(await auction.zora()).eq(mediaAddress);

        const newMediaContract = await (
          await new MediaFactory(deployerWallet).deploy(marketAddress)
        ).deployed();

        await auction.updateZora(newMediaContract.address);

        expect(await auction.zora()).eq(newMediaContract.address);
      });
    });
  });
});
